import 'dotenv/config';
import { WebSocketServer, WebSocket } from 'ws';
import { networkInterfaces } from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as pty from 'node-pty';
import * as voiceService from './voice-service';
import * as tmuxService from './tmux-service';

const PORT = parseInt(process.env.PORT || '8765');
const PROJECTS_DIR = process.env.PROJECTS_DIR || path.join(__dirname, '../../projects');
const LOGS_DIR = path.join(__dirname, '../../logs');

// Ensure directories exist
if (!fs.existsSync(PROJECTS_DIR)) {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
}
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// Logging system
const getTimestamp = () => new Date().toISOString();

const serverLogFile = path.join(LOGS_DIR, 'bridge-server.log');
const terminalLogFile = path.join(LOGS_DIR, 'terminal.log');

function logToFile(file: string, level: string, message: string, data?: any) {
  const timestamp = getTimestamp();
  const logLine = `[${timestamp}] [${level}] ${message}${data ? ' ' + JSON.stringify(data) : ''}\n`;
  fs.appendFileSync(file, logLine);
}

function serverLog(message: string, data?: any) {
  console.log(message);
  logToFile(serverLogFile, 'INFO', message, data);
}

function serverError(message: string, data?: any) {
  const logMessage = data !== undefined ? `${message} ${typeof data === 'string' ? data : JSON.stringify(data)}` : message;
  console.error(logMessage);
  logToFile(serverLogFile, 'ERROR', message, data);
}

function terminalLog(terminalId: string, event: string, data?: any) {
  const message = `[${terminalId}] ${event}`;
  logToFile(terminalLogFile, 'TERMINAL', message, data);
}

// Clear old logs on startup
fs.writeFileSync(serverLogFile, `=== Bridge Server Started at ${getTimestamp()} ===\n`);
fs.writeFileSync(terminalLogFile, `=== Terminal Logs Started at ${getTimestamp()} ===\n`);

interface Message {
  type: 'ping' | 'create_project' | 'delete_project' | 'list_projects' | 'get_files' | 'get_file_content' | 'save_file' | 'terminal_create' | 'terminal_input' | 'terminal_resize' | 'terminal_close' | 'set_sandbox' | 'voice_create' | 'voice_audio' | 'voice_text' | 'voice_close' | 'voice_status' | 'voice_terminal_enable' | 'voice_terminal_disable' | 'voice_terminal_audio';
  projectName?: string;
  projectId?: string;
  filePath?: string;
  content?: string; // For save_file
  terminalId?: string;
  input?: string;
  cols?: number;
  rows?: number;
  sandbox?: boolean; // true = sandboxed to project, false = full filesystem access
  autoStartClaude?: boolean; // Auto-start claude code on terminal creation
  killSession?: boolean; // For terminal_close - also kill tmux session (default: preserve)
  // Voice-related fields
  voiceSessionId?: string;
  audioData?: string; // Base64 encoded audio
  audioMimeType?: string; // e.g., 'audio/wav', 'audio/m4a'
  text?: string; // For voice_text (text input instead of audio)
}

interface ProjectInfo {
  id: string;
  name: string;
  path: string;
  createdAt: string;
}

interface FileInfo {
  path: string;
  name: string;
  isDirectory: boolean;
}

interface StreamResponse {
  type: 'pong' | 'connected' | 'projects' | 'files' | 'file_content' | 'file_saved' | 'project_created' | 'project_deleted' | 'terminal_created' | 'terminal_output' | 'terminal_closed' | 'error' | 'voice_created' | 'voice_transcription' | 'voice_response' | 'voice_audio' | 'voice_progress' | 'voice_closed' | 'voice_status' | 'voice_terminal_enabled' | 'voice_terminal_disabled' | 'voice_terminal_speaking';
  content?: string;
  error?: string;
  projects?: ProjectInfo[];
  files?: FileInfo[];
  fileContent?: string;
  filePath?: string; // For save confirmation
  project?: ProjectInfo;
  terminalId?: string;
  projectId?: string; // For delete confirmation
  // Voice-related fields
  voiceSessionId?: string;
  transcription?: string; // STT result
  responseText?: string; // Claude's text response (summarized for voice)
  audioData?: string; // Base64 encoded TTS audio
  audioMimeType?: string; // e.g., 'audio/mp3'
  voiceAvailable?: { stt: boolean; tts: boolean; agent: boolean }; // Service availability
  voiceEnabled?: boolean; // Voice mode status for terminal
}

// Terminal session management (hybrid: tmux for commands, PTY for output)
interface TerminalSession {
  id: string;
  projectId: string;
  tmuxSessionName: string;  // tmux session name (e.g., "lora-project-123")
  projectPath: string;
  sandbox: boolean;
  // PTY attached to tmux for real-time output streaming
  pty: pty.IPty;
  // Voice-terminal integration
  voiceMode: boolean;
  voiceAwaitingResponse: boolean;
  voiceAccumulatedOutput: string;
  voiceLastOutputTime: number;
  // Idle state: true when waiting for user to speak next (after we respond)
  // This prevents processing silence/noise as commands
  voiceIdleWaiting: boolean;
  // Cooldown: timestamp when we last sent TTS - ignore audio for a few seconds after
  voiceLastTTSTime: number;
}

// Home directory for non-sandboxed access
const HOME_DIR = process.env.HOME || '/home';

// Claude Session Registry (global - persists across WebSocket reconnections)
// Stores history of Claude sessions per project, ordered by creation time (newest first)
// This allows reconnecting to existing sessions and viewing session history
interface ClaudeSessionInfo {
  tmuxSessionName: string;
  createdAt: number;
  isActive: boolean;  // Whether tmux session is still alive
}

// Maps projectId → array of session info (ordered newest first)
const claudeSessionRegistry: Map<string, ClaudeSessionInfo[]> = new Map();

/**
 * Register a Claude session for a project
 */
function registerClaudeSession(projectId: string, tmuxSessionName: string): void {
  const sessions = claudeSessionRegistry.get(projectId) || [];

  // Add new session at the beginning (newest first)
  sessions.unshift({
    tmuxSessionName,
    createdAt: Date.now(),
    isActive: true
  });

  claudeSessionRegistry.set(projectId, sessions);
  serverLog(`📝 Registered Claude session for project ${projectId}: ${tmuxSessionName}`);
}

/**
 * Mark a Claude session as inactive (tmux session was killed)
 */
function markSessionInactive(projectId: string, tmuxSessionName: string): void {
  const sessions = claudeSessionRegistry.get(projectId);
  if (sessions) {
    const session = sessions.find(s => s.tmuxSessionName === tmuxSessionName);
    if (session) {
      session.isActive = false;
      serverLog(`📝 Marked session inactive for project ${projectId}: ${tmuxSessionName}`);
    }
  }
}

/**
 * Get session history for a project
 */
function getSessionHistory(projectId: string): ClaudeSessionInfo[] {
  return claudeSessionRegistry.get(projectId) || [];
}

/**
 * Get the most recent active Claude session for a project (if any)
 * Returns the newest session that still has a running tmux session
 */
async function getActiveClaudeSession(projectId: string): Promise<string | undefined> {
  const sessions = claudeSessionRegistry.get(projectId) || [];

  // Find the first (newest) session that's still active in tmux
  for (const session of sessions) {
    if (session.isActive && await tmuxService.sessionExists(session.tmuxSessionName)) {
      return session.tmuxSessionName;
    } else if (session.isActive) {
      // Session was marked active but tmux is gone - update it
      session.isActive = false;
    }
  }

  return undefined;
}

/**
 * Process terminal output and generate voice response
 * Used when voice mode is enabled on a terminal
 */
async function processTerminalVoiceResponse(ws: WebSocket, terminalId: string, response: string, session?: TerminalSession): Promise<void> {
  try {
    // Summarize for voice with session context
    const voiceText = await voiceService.summarizeForVoice(response, terminalId, 'brief');

    console.log('\n💬 VOICE RESPONSE:');
    console.log(`   "${voiceText}"`);

    if (voiceText && voiceText.length > 10) {
      // Generate TTS
      const audioBuffer = await voiceService.textToSpeech(voiceText);

      console.log(`\n🔊 TTS GENERATED: ${audioBuffer.length} bytes`);
      console.log('   Sending audio to mobile app...');

      // Send to client
      const audioResponse: StreamResponse = {
        type: 'voice_terminal_speaking',
        terminalId,
        responseText: voiceText,
        audioData: audioBuffer.toString('base64'),
        audioMimeType: 'audio/mp3'
      };
      ws.send(JSON.stringify(audioResponse));

      // Set TTS cooldown timestamp if session provided
      if (session) {
        session.voiceLastTTSTime = Date.now();
      }

      console.log('✅ RESPONSE SENT TO USER');
      console.log('='.repeat(60) + '\n');
    } else {
      console.log('   ⚠️ Response too short for TTS, skipping');
    }
  } catch (err) {
    console.log(`\n❌ TTS ERROR: ${err instanceof Error ? err.message : 'Unknown error'}`);
    serverError('[Voice-Terminal] TTS error:', err);
  }
}

function getLocalIP(): string {
  const interfaces = networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const wss = new WebSocketServer({ port: PORT });

serverLog('╔════════════════════════════════════════════════════════════╗');
serverLog('║           LORA BRIDGE SERVER                               ║');
serverLog('╠════════════════════════════════════════════════════════════╣');
serverLog(`║  Local:   ws://localhost:${PORT}`);
serverLog(`║  Network: ws://${getLocalIP()}:${PORT}`);
serverLog('╠════════════════════════════════════════════════════════════╣');
serverLog('║  Waiting for Lora iOS app connection...                    ║');
serverLog('╚════════════════════════════════════════════════════════════╝');

// Helper functions for project management
function createProjectId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const timestamp = Date.now().toString(36);
  return `${slug}-${timestamp}`;
}

function getProjectPath(projectId: string): string {
  return path.join(PROJECTS_DIR, projectId);
}

function listProjects(): ProjectInfo[] {
  if (!fs.existsSync(PROJECTS_DIR)) return [];

  const projects: ProjectInfo[] = [];
  const entries = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const projectPath = path.join(PROJECTS_DIR, entry.name);
      const metaPath = path.join(projectPath, '.lora.json');

      let meta = { name: entry.name, createdAt: new Date().toISOString() };
      if (fs.existsSync(metaPath)) {
        try {
          meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        } catch {}
      }

      projects.push({
        id: entry.name,
        name: meta.name,
        path: projectPath,
        createdAt: meta.createdAt
      });
    }
  }

  return projects.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function getProjectFiles(projectId: string, subPath: string = ''): FileInfo[] {
  const projectPath = getProjectPath(projectId);
  const targetPath = subPath ? path.join(projectPath, subPath) : projectPath;

  if (!fs.existsSync(targetPath)) return [];

  const files: FileInfo[] = [];
  const entries = fs.readdirSync(targetPath, { withFileTypes: true });

  for (const entry of entries) {
    // Skip hidden files and node_modules
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

    const relativePath = subPath ? path.join(subPath, entry.name) : entry.name;
    files.push({
      path: relativePath,
      name: entry.name,
      isDirectory: entry.isDirectory()
    });
  }

  return files;
}

function getFileContent(projectId: string, filePath: string): string | null {
  const fullPath = path.join(getProjectPath(projectId), filePath);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath, 'utf-8');
}

function saveFileContent(projectId: string, filePath: string, content: string): boolean {
  const fullPath = path.join(getProjectPath(projectId), filePath);
  const projectPath = getProjectPath(projectId);

  // Ensure the file is within the project directory (security check)
  if (!fullPath.startsWith(projectPath)) {
    serverError(`Security: Attempted to save outside project: ${fullPath}`);
    return false;
  }

  try {
    // Create parent directories if they don't exist
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(fullPath, content, 'utf-8');
    serverLog(`💾 Saved file: ${filePath} in ${projectId}`);
    return true;
  } catch (err) {
    serverError(`Failed to save file ${filePath}:`, err);
    return false;
  }
}

function deleteProject(projectId: string): boolean {
  const projectPath = getProjectPath(projectId);
  if (!fs.existsSync(projectPath)) return false;

  // Recursively delete directory
  fs.rmSync(projectPath, { recursive: true, force: true });
  serverLog(`🗑️  Deleted project: ${projectId}`);
  return true;
}

// Create a new project with Expo template for easy previews
function createProjectWithTemplate(projectId: string, projectName: string): void {
  const projectPath = getProjectPath(projectId);

  // Create project directory
  fs.mkdirSync(projectPath, { recursive: true });

  // Create .lora.json metadata
  const meta = {
    name: projectName,
    createdAt: new Date().toISOString()
  };
  fs.writeFileSync(path.join(projectPath, '.lora.json'), JSON.stringify(meta, null, 2));

  // Create package.json with Expo dependencies
  const packageJson = {
    name: projectId,
    version: '1.0.0',
    main: 'App.tsx',
    scripts: {
      start: 'expo start',
      android: 'expo start --android',
      ios: 'expo start --ios',
      web: 'expo start --web'
    },
    dependencies: {
      'expo': '~54.0.0',
      'expo-status-bar': '~3.0.0',
      'react': '19.1.0',
      'react-native': '0.81.5',
      'react-native-safe-area-context': '^5.0.0',
      '@react-navigation/native': '^7.0.0'
    },
    devDependencies: {
      '@types/react': '~19.1.0',
      'typescript': '~5.9.0'
    }
  };
  fs.writeFileSync(path.join(projectPath, 'package.json'), JSON.stringify(packageJson, null, 2));

  // Create app.json for Expo
  const appJson = {
    expo: {
      name: projectName,
      slug: projectId,
      version: '1.0.0',
      orientation: 'portrait',
      userInterfaceStyle: 'light',
      splash: {
        backgroundColor: '#ffffff'
      },
      ios: {
        supportsTablet: true
      },
      android: {
        adaptiveIcon: {
          backgroundColor: '#ffffff'
        }
      }
    }
  };
  fs.writeFileSync(path.join(projectPath, 'app.json'), JSON.stringify(appJson, null, 2));

  // Create babel.config.js
  const babelConfig = `module.exports = function(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
`;
  fs.writeFileSync(path.join(projectPath, 'babel.config.js'), babelConfig);

  // Create tsconfig.json
  const tsConfig = {
    extends: 'expo/tsconfig.base',
    compilerOptions: {
      strict: true
    }
  };
  fs.writeFileSync(path.join(projectPath, 'tsconfig.json'), JSON.stringify(tsConfig, null, 2));

  // Create App.tsx with a simple starter template
  const appTsx = `import React from 'react';
import { StyleSheet, Text, View, SafeAreaView, StatusBar } from 'react-native';

export default function App() {
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.content}>
        <Text style={styles.title}>Welcome to ${projectName}</Text>
        <Text style={styles.subtitle}>Start building your app!</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
  },
});
`;
  fs.writeFileSync(path.join(projectPath, 'App.tsx'), appTsx);

  // Create .gitignore
  const gitignore = `node_modules/
.expo/
dist/
*.log
`;
  fs.writeFileSync(path.join(projectPath, '.gitignore'), gitignore);

  serverLog(`📁 Created project with template: ${projectName} (${projectId})`);
}

wss.on('connection', (ws: WebSocket) => {
  serverLog('✅ Lora iOS app connected');

  // Terminal sessions for this connection
  const terminals: Map<string, TerminalSession> = new Map();

  // Send connection confirmation with projects list
  const connectedMsg: StreamResponse = {
    type: 'connected',
    projects: listProjects()
  };
  ws.send(JSON.stringify(connectedMsg));

  ws.on('message', async (data: Buffer) => {
    try {
      const message: Message = JSON.parse(data.toString());

      if (message.type === 'ping') {
        const pongMsg: StreamResponse = { type: 'pong' };
        ws.send(JSON.stringify(pongMsg));
        return;
      }

      if (message.type === 'create_project' && message.projectName) {
        const projectId = createProjectId(message.projectName);
        const projectPath = getProjectPath(projectId);

        // Create project with Expo template for easy previews
        createProjectWithTemplate(projectId, message.projectName);

        const response: StreamResponse = {
          type: 'project_created',
          project: {
            id: projectId,
            name: message.projectName,
            path: projectPath,
            createdAt: new Date().toISOString()
          }
        };
        ws.send(JSON.stringify(response));
        return;
      }

      if (message.type === 'delete_project' && message.projectId) {
        const success = deleteProject(message.projectId);
        if (success) {
          const response: StreamResponse = {
            type: 'project_deleted',
            projectId: message.projectId
          };
          ws.send(JSON.stringify(response));
        } else {
          const response: StreamResponse = {
            type: 'error',
            error: `Project not found: ${message.projectId}`
          };
          ws.send(JSON.stringify(response));
        }
        return;
      }

      if (message.type === 'list_projects') {
        const response: StreamResponse = {
          type: 'projects',
          projects: listProjects()
        };
        ws.send(JSON.stringify(response));
        return;
      }

      if (message.type === 'get_files' && message.projectId) {
        serverLog(`📂 get_files request: projectId=${message.projectId}, subPath=${message.filePath || '(root)'}`);
        const files = getProjectFiles(message.projectId, message.filePath);
        serverLog(`📂 get_files response: ${files.length} files found`);
        const response: StreamResponse = {
          type: 'files',
          files
        };
        ws.send(JSON.stringify(response));
        return;
      }

      if (message.type === 'get_file_content' && message.projectId && message.filePath) {
        const content = getFileContent(message.projectId, message.filePath);
        const response: StreamResponse = {
          type: 'file_content',
          fileContent: content || '',
          error: content === null ? 'File not found' : undefined
        };
        ws.send(JSON.stringify(response));
        return;
      }

      if (message.type === 'save_file' && message.projectId && message.filePath && message.content !== undefined) {
        const success = saveFileContent(message.projectId, message.filePath, message.content);
        const response: StreamResponse = success
          ? { type: 'file_saved', filePath: message.filePath }
          : { type: 'error', error: `Failed to save file: ${message.filePath}` };
        ws.send(JSON.stringify(response));
        return;
      }

      // Terminal management (hybrid: tmux for commands, PTY for output)
      if (message.type === 'terminal_create' && message.projectId) {
        const projectId = message.projectId;  // Capture for closure
        const projectPath = getProjectPath(projectId);

        if (!fs.existsSync(projectPath)) {
          fs.mkdirSync(projectPath, { recursive: true });
        }

        const terminalId = `term-${Date.now().toString(36)}`;

        try {
          // Check if tmux is available
          const tmuxAvailable = await tmuxService.isTmuxAvailable();
          if (!tmuxAvailable) {
            throw new Error('tmux is not installed. Please install tmux to use Lora voice features.');
          }

          // Check if we already have a terminal for this project in this connection
          // If yes, user wants a NEW terminal (not reuse existing)
          // If no, check for existing Claude session to reconnect to
          const existingTerminalsForProject = Array.from(terminals.values()).filter(
            t => t.projectId === projectId
          );
          const hasTerminalForProject = existingTerminalsForProject.length > 0;

          serverLog(`[DEBUG] Terminal count for project ${projectId}: ${existingTerminalsForProject.length}, hasTerminal: ${hasTerminalForProject}`);

          let tmuxSessionName: string;
          let isReusingSession = false;

          if (hasTerminalForProject) {
            // User already has a terminal for this project - create a NEW unique one
            serverLog(`🖥️  Creating additional terminal ${terminalId} for project ${projectId}`);
            const tmuxSession = await tmuxService.createSession(terminalId, projectPath, {
              autoStartClaude: false
            });
            tmuxSessionName = tmuxSession.sessionName;
          } else {
            // No terminal for this project yet - check for existing Claude session to reconnect
            const existingSessionName = await getActiveClaudeSession(projectId);

            if (existingSessionName) {
              // Reconnect to existing Claude session (app was closed and reopened)
              tmuxSessionName = existingSessionName;
              isReusingSession = true;
              serverLog(`♻️  Reconnecting terminal ${terminalId} to existing Claude session: ${tmuxSessionName}`);
            } else {
              // No existing session - create new tmux session
              serverLog(`🖥️  Creating new terminal ${terminalId} for project ${projectId}`);
              const tmuxSession = await tmuxService.createSession(terminalId, projectPath, {
                autoStartClaude: false
              });
              tmuxSessionName = tmuxSession.sessionName;
            }
          }

          terminalLog(terminalId, 'CREATED', { projectPath, tmuxSessionName, isReusingSession });

          // Terminal dimensions - smaller for mobile
          const cols = message.cols || 60;
          const rows = message.rows || 24;

          // Spawn PTY that attaches to tmux session for real-time output streaming
          const shell = pty.spawn('tmux', ['attach', '-t', tmuxSessionName], {
            name: 'xterm-256color',
            cols,
            rows,
            cwd: projectPath,
            env: {
              ...process.env,
              TERM: 'xterm-256color',
              COLORTERM: 'truecolor'
            }
          });

          const session: TerminalSession = {
            id: terminalId,
            projectId,
            tmuxSessionName,
            projectPath,
            sandbox: message.sandbox !== false,
            pty: shell,
            voiceMode: false,
            voiceAwaitingResponse: false,
            voiceAccumulatedOutput: '',
            voiceLastOutputTime: Date.now(),
            voiceIdleWaiting: false,
            voiceLastTTSTime: 0
          };
          terminals.set(terminalId, session);

          // Stream PTY output to client (real-time, with ANSI codes)
          shell.onData((data: string) => {
            const outputResponse: StreamResponse = {
              type: 'terminal_output',
              terminalId,
              content: data
            };
            ws.send(JSON.stringify(outputResponse));

            // Voice mode: accumulate output for response detection
            if (session.voiceMode && session.voiceAwaitingResponse) {
              session.voiceAccumulatedOutput += data;
              session.voiceLastOutputTime = Date.now();
            }

            // Log output (truncated)
            const truncated = data.length > 200 ? data.substring(0, 200) + '...' : data;
            terminalLog(terminalId, 'OUTPUT', { length: data.length, preview: truncated.replace(/\n/g, '\\n') });
          });

          shell.onExit(({ exitCode }) => {
            serverLog(`🖥️  Terminal ${terminalId} exited with code ${exitCode}`);
            const closeResponse: StreamResponse = {
              type: 'terminal_closed',
              terminalId
            };
            ws.send(JSON.stringify(closeResponse));
            terminals.delete(terminalId);
          });

          // Start Claude Code only if:
          // 1. autoStartClaude is true (or not specified - defaults to true)
          // 2. We're NOT reusing an existing session (Claude already running there)
          setTimeout(async () => {
            if (message.autoStartClaude !== false && !isReusingSession) {
              serverLog(`🤖 Starting Claude Code in terminal ${terminalId}`);
              await tmuxService.sendCommand(tmuxSessionName, 'claude');
              await tmuxService.sendEnter(tmuxSessionName);
              // Register this session so we can reconnect later
              registerClaudeSession(projectId, tmuxSessionName);
            } else if (isReusingSession) {
              serverLog(`♻️  Reusing existing Claude Code session in terminal ${terminalId}`);
              // Send Enter to refresh the prompt
              await tmuxService.sendEnter(tmuxSessionName);
            }
          }, 500);

          const response: StreamResponse = {
            type: 'terminal_created',
            terminalId
          };
          ws.send(JSON.stringify(response));

          serverLog(`✅ Terminal ${terminalId} created (tmux: ${tmuxSessionName})`);

        } catch (err) {
          serverError(`Failed to create terminal: ${err}`);
          const response: StreamResponse = {
            type: 'error',
            error: `Failed to create terminal: ${err instanceof Error ? err.message : 'Unknown error'}`
          };
          ws.send(JSON.stringify(response));
        }
        return;
      }

      // Voice-terminal integration handlers
      if (message.type === 'voice_terminal_enable' && message.terminalId) {
        const session = terminals.get(message.terminalId);
        if (session) {
          session.voiceMode = true;
          session.voiceAwaitingResponse = false;
          session.voiceAccumulatedOutput = '';
          session.voiceLastOutputTime = Date.now();
          serverLog(`🎤 Voice mode enabled for terminal ${message.terminalId}`);

          const response: StreamResponse = {
            type: 'voice_terminal_enabled',
            terminalId: message.terminalId,
            voiceEnabled: true
          };
          ws.send(JSON.stringify(response));
        } else {
          const response: StreamResponse = {
            type: 'error',
            error: `Terminal not found: ${message.terminalId}`
          };
          ws.send(JSON.stringify(response));
        }
        return;
      }

      if (message.type === 'voice_terminal_disable' && message.terminalId) {
        const session = terminals.get(message.terminalId);
        if (session) {
          session.voiceMode = false;
          session.voiceAwaitingResponse = false;
          session.voiceAccumulatedOutput = '';
          serverLog(`🔇 Voice mode disabled for terminal ${message.terminalId}`);

          const response: StreamResponse = {
            type: 'voice_terminal_disabled',
            terminalId: message.terminalId,
            voiceEnabled: false
          };
          ws.send(JSON.stringify(response));
        }
        return;
      }

      if (message.type === 'voice_terminal_audio' && message.terminalId && message.audioData) {
        const session = terminals.get(message.terminalId);
        if (!session) {
          const response: StreamResponse = {
            type: 'error',
            error: `Terminal not found: ${message.terminalId}`
          };
          ws.send(JSON.stringify(response));
          return;
        }

        try {
          // Decode and transcribe audio
          const audioBuffer = Buffer.from(message.audioData, 'base64');
          const mimeType = message.audioMimeType || 'audio/wav';

          console.log('\n' + '='.repeat(60));
          console.log('📥 VOICE INPUT RECEIVED');
          console.log('='.repeat(60));
          console.log(`   Audio size: ${audioBuffer.length} bytes`);
          console.log(`   MIME type: ${mimeType}`);
          console.log(`   Idle waiting: ${session.voiceIdleWaiting}`);

          // Cooldown check - ignore audio that comes too soon after we sent TTS
          // This prevents picking up our own audio playback
          const TTS_COOLDOWN_MS = 3000; // 3 seconds after TTS before accepting new audio
          const timeSinceTTS = Date.now() - session.voiceLastTTSTime;
          if (session.voiceLastTTSTime > 0 && timeSinceTTS < TTS_COOLDOWN_MS) {
            console.log(`   ⏳ Cooldown active (${timeSinceTTS}ms < ${TTS_COOLDOWN_MS}ms), waiting for user...`);
            console.log('='.repeat(60) + '\n');
            return;
          }

          // Minimum audio size check - very small files are likely noise/silence
          // M4A typically needs at least ~20KB for a second of speech
          const MIN_AUDIO_SIZE = 15000; // 15KB minimum
          if (audioBuffer.length < MIN_AUDIO_SIZE) {
            console.log(`   ⚠️ Audio too small (${audioBuffer.length} < ${MIN_AUDIO_SIZE}), likely noise`);
            console.log('='.repeat(60) + '\n');
            return;
          }

          const transcription = await voiceService.transcribeAudio(audioBuffer, mimeType);

          console.log('\n📝 TRANSCRIPTION:');
          console.log(`   "${transcription}"`);

          if (!transcription || !transcription.trim()) {
            console.log('   ⚠️ Empty transcription, ignoring');
            return;
          }

          // If the transcription is very short (1-2 words) and we're in idle waiting,
          // require more substantial input
          const wordCount = transcription.trim().split(/\s+/).length;
          if (session.voiceIdleWaiting && wordCount <= 2) {
            console.log(`   ⚠️ Short input while idle (${wordCount} words), waiting for more speech`);
            console.log('='.repeat(60) + '\n');
            return;
          }

          // Send transcription to client (what the user said)
          const transcriptionResponse: StreamResponse = {
            type: 'voice_transcription',
            terminalId: message.terminalId,
            transcription
          };
          ws.send(JSON.stringify(transcriptionResponse));

          // Process with Voice Agent LLM - it decides what to do
          const projectMeta = listProjects().find(p => p.id === session.projectId);
          const agentResponse = await voiceService.processVoiceInput(
            transcription,
            message.terminalId,  // sessionId for conversation memory
            {
              projectName: projectMeta?.name,
              recentOutput: session.voiceAccumulatedOutput.slice(-500)
            }
          );

          console.log(`\n🤖 VOICE AGENT: ${agentResponse.type}`);
          console.log(`   Content: "${agentResponse.content}"`);

          // Handle IGNORE - transcription artifacts, noise
          if (agentResponse.type === 'ignore') {
            console.log('   ⚠️ Voice agent says ignore (artifact/noise)');
            console.log('='.repeat(60) + '\n');
            return;
          }

          // Handle CONVERSATIONAL - greetings, thanks, etc.
          if (agentResponse.type === 'conversational') {
            console.log('\n💬 CONVERSATIONAL RESPONSE:');
            console.log(`   "${agentResponse.content}"`);

            const ttsAudioBuffer = await voiceService.textToSpeech(agentResponse.content);
            console.log(`\n🔊 TTS GENERATED: ${ttsAudioBuffer.length} bytes`);

            const audioResponse: StreamResponse = {
              type: 'voice_terminal_speaking',
              terminalId: message.terminalId,
              responseText: agentResponse.content,
              audioData: ttsAudioBuffer.toString('base64'),
              audioMimeType: 'audio/mp3'
            };
            ws.send(JSON.stringify(audioResponse));

            // Set TTS cooldown and enter idle state
            session.voiceLastTTSTime = Date.now();
            session.voiceIdleWaiting = true;
            console.log('   🛋️ Entering idle state - waiting for user input');
            console.log('='.repeat(60) + '\n');
            return;
          }

          // Handle CONTROL - terminal/Claude Code control commands
          if (agentResponse.type === 'control') {
            const controlAction = agentResponse.content;
            console.log(`\n🎮 CONTROL COMMAND: ${controlAction}`);

            let responseText = '';

            switch (controlAction) {
              case 'CTRL_C':
                await tmuxService.sendControlKey(session.tmuxSessionName, 'c');
                responseText = 'Interrupted. The current operation has been cancelled.';
                break;
              case 'ESCAPE':
                await tmuxService.sendSpecialKey(session.tmuxSessionName, 'Escape');
                responseText = 'Cancelled.';
                break;
              case 'SLASH_CLEAR':
                await tmuxService.sendCommand(session.tmuxSessionName, '/clear');
                await tmuxService.sendEnter(session.tmuxSessionName);
                responseText = 'Conversation cleared. Starting fresh.';
                break;
              case 'SLASH_HELP':
                await tmuxService.sendCommand(session.tmuxSessionName, '/help');
                await tmuxService.sendEnter(session.tmuxSessionName);
                responseText = 'Showing help.';
                break;
              case 'RESTART':
                await tmuxService.restartClaude(session.tmuxSessionName);
                responseText = 'Restarting Claude Code.';
                break;
              default:
                responseText = `Control action: ${controlAction}`;
            }

            // Generate voice response for control action
            const ttsAudio = await voiceService.textToSpeech(responseText);
            const audioResponse: StreamResponse = {
              type: 'voice_terminal_speaking',
              terminalId: message.terminalId,
              responseText,
              audioData: ttsAudio.toString('base64'),
              audioMimeType: 'audio/mp3'
            };
            ws.send(JSON.stringify(audioResponse));

            // Set TTS cooldown and enter idle state
            session.voiceLastTTSTime = Date.now();
            session.voiceIdleWaiting = true;
            console.log(`   ✓ Control action executed: ${responseText}`);
            console.log('   🛋️ Entering idle state - waiting for user input');
            console.log('='.repeat(60) + '\n');
            return;
          }

          // PROMPT type - send natural language to Claude Code
          // Clear idle state - user is actively commanding
          session.voiceIdleWaiting = false;
          const promptText = agentResponse.content;

          // Send progress to client
          const progressResponse: StreamResponse = {
            type: 'voice_progress',
            terminalId: message.terminalId,
            responseText: `Sending to Claude: "${promptText.substring(0, 50)}${promptText.length > 50 ? '...' : ''}"`
          };
          ws.send(JSON.stringify(progressResponse));

          // Set up to capture Claude's response
          session.voiceAwaitingResponse = true;

          // Send the translated command to Claude Code via tmux
          console.log('\n⌨️ SENDING TO TMUX:');
          console.log(`   Session: ${session.tmuxSessionName}`);
          console.log(`   Prompt: "${promptText}"`);

          // Use tmux send-keys for reliable command execution
          await tmuxService.sendCommand(session.tmuxSessionName, promptText);
          await new Promise(resolve => setTimeout(resolve, 50)); // Small delay
          await tmuxService.sendEnter(session.tmuxSessionName);

          console.log('   ✓ Command sent with Enter key');
          console.log('\n⏳ WAITING FOR CLAUDE CODE RESPONSE...');

          // Wait for Claude's response using polling
          const claudeResponse = await tmuxService.waitForResponse(session.tmuxSessionName, {
            timeoutMs: 30000,
            stabilityMs: 2000,
            pollIntervalMs: 500
          });

          session.voiceAwaitingResponse = false;

          if (claudeResponse && claudeResponse.length > 50) {
            console.log('\n' + '='.repeat(60));
            console.log('📤 CLAUDE CODE RESPONSE DETECTED');
            console.log('='.repeat(60));
            console.log(`   Length: ${claudeResponse.length} chars`);
            console.log(`   Content preview:`);
            console.log('   ' + claudeResponse.substring(0, 300).replace(/\n/g, '\n   '));
            console.log('\n🔄 SUMMARIZING FOR VOICE...');

            // Generate voice response
            await processTerminalVoiceResponse(ws, message.terminalId, claudeResponse, session);

            // Enter idle state - wait for user to speak next
            session.voiceIdleWaiting = true;
            console.log('   🛋️ Entering idle state - waiting for user input');
          } else {
            console.log('\n⚠️ No substantial response from Claude Code');
            // Still enter idle state
            session.voiceIdleWaiting = true;
          }

          console.log('='.repeat(60) + '\n');

        } catch (err) {
          serverError('[Voice-Terminal] Processing error:', err);
          console.log(`\n❌ ERROR: ${err instanceof Error ? err.message : 'Unknown error'}`);
          const response: StreamResponse = {
            type: 'error',
            error: `Voice processing failed: ${err instanceof Error ? err.message : 'Unknown error'}`
          };
          ws.send(JSON.stringify(response));
        }
        return;
      }

      if (message.type === 'terminal_input' && message.terminalId && message.input !== undefined) {
        const session = terminals.get(message.terminalId);
        if (session) {
          // Filter out OSC escape sequence responses (terminal color/title queries)
          // These are responses FROM the terminal, not user input
          const input = message.input;
          if (
            input === '' ||  // Empty string
            input.startsWith('\x1b]') ||  // OSC sequences (color queries)
            (input.includes(']') && (input.includes('rgb:') || input.includes('10;') || input.includes('11;')))
          ) {
            // Silently ignore OSC responses
            return;
          }

          // Log input (escape special chars for readability)
          const escapedInput = input.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\x03/g, '[Ctrl+C]').replace(/\x04/g, '[Ctrl+D]');
          terminalLog(message.terminalId, 'INPUT', { input: escapedInput });

          // Handle special control characters
          if (input === '\x03') {
            // Ctrl+C
            await tmuxService.sendControlKey(session.tmuxSessionName, 'c');
          } else if (input === '\x04') {
            // Ctrl+D
            await tmuxService.sendControlKey(session.tmuxSessionName, 'd');
          } else if (input === '\r' || input === '\n') {
            // Enter key
            await tmuxService.sendEnter(session.tmuxSessionName);
          } else {
            // Regular text input
            await tmuxService.sendCommand(session.tmuxSessionName, input);
          }
        }
        return;
      }

      if (message.type === 'terminal_resize' && message.terminalId && message.cols && message.rows) {
        const session = terminals.get(message.terminalId);
        if (session && session.pty) {
          // Resize the PTY (which is attached to tmux)
          session.pty.resize(message.cols, message.rows);
        }
        return;
      }

      if (message.type === 'terminal_close' && message.terminalId) {
        const session = terminals.get(message.terminalId);
        if (session) {
          // Kill the PTY (detaches from tmux)
          if (session.pty) {
            session.pty.kill();
          }

          // PRESERVE tmux session for reconnection (session persistence)
          // Only kill if explicitly requested with killSession: true
          if (message.killSession) {
            await tmuxService.killSession(session.tmuxSessionName);
            serverLog(`🖥️  Killed terminal ${message.terminalId} and tmux session`);
          } else {
            serverLog(`🖥️  Closed terminal ${message.terminalId} (tmux session preserved: ${session.tmuxSessionName})`);
          }
          terminals.delete(message.terminalId);

          const response: StreamResponse = {
            type: 'terminal_closed',
            terminalId: message.terminalId
          };
          ws.send(JSON.stringify(response));
        }
        return;
      }

      // Voice session management
      serverLog(`[DEBUG] Message type: ${message.type}, projectId: ${message.projectId}, voiceSessionId: ${message.voiceSessionId}`);

      if (message.type === 'voice_status') {
        const response: StreamResponse = {
          type: 'voice_status',
          voiceAvailable: voiceService.isVoiceServiceAvailable()
        };
        ws.send(JSON.stringify(response));
        return;
      }

      if (message.type === 'voice_create' && message.projectId) {
        const projectPath = getProjectPath(message.projectId);

        if (!fs.existsSync(projectPath)) {
          fs.mkdirSync(projectPath, { recursive: true });
        }

        const voiceSessionId = voiceService.createVoiceSession(message.projectId, projectPath);

        serverLog(`🎤 Created voice session ${voiceSessionId} for project ${message.projectId}`);

        const response: StreamResponse = {
          type: 'voice_created',
          voiceSessionId
        };
        ws.send(JSON.stringify(response));
        return;
      }

      if (message.type === 'voice_audio' && message.voiceSessionId && message.audioData) {
        const session = voiceService.getVoiceSession(message.voiceSessionId);
        if (!session) {
          const response: StreamResponse = {
            type: 'error',
            error: `Voice session not found: ${message.voiceSessionId}`
          };
          ws.send(JSON.stringify(response));
          return;
        }

        try {
          // Decode base64 audio
          const audioBuffer = Buffer.from(message.audioData, 'base64');
          const mimeType = message.audioMimeType || 'audio/wav';

          serverLog(`🎤 Received audio: ${audioBuffer.length} bytes, type: ${mimeType}`);

          // Transcribe audio
          const transcription = await voiceService.transcribeAudio(audioBuffer, mimeType);

          // Send transcription to client
          const transcriptionResponse: StreamResponse = {
            type: 'voice_transcription',
            voiceSessionId: message.voiceSessionId,
            transcription
          };
          ws.send(JSON.stringify(transcriptionResponse));

          // Process the voice command with Claude
          const result = await voiceService.processVoiceCommand(
            message.voiceSessionId,
            transcription,
            // Progress callback
            (progressText: string) => {
              const progressResponse: StreamResponse = {
                type: 'voice_progress',
                voiceSessionId: message.voiceSessionId,
                responseText: progressText
              };
              ws.send(JSON.stringify(progressResponse));
            },
            // Audio callback
            (audio: Buffer) => {
              const audioResponse: StreamResponse = {
                type: 'voice_audio',
                voiceSessionId: message.voiceSessionId,
                audioData: audio.toString('base64'),
                audioMimeType: 'audio/mp3'
              };
              ws.send(JSON.stringify(audioResponse));
            }
          );

          // Send final response (audio already sent via callback, don't duplicate)
          const finalResponse: StreamResponse = {
            type: 'voice_response',
            voiceSessionId: message.voiceSessionId,
            responseText: result.text
          };
          ws.send(JSON.stringify(finalResponse));

        } catch (err) {
          serverError('Voice processing error:', err);
          const response: StreamResponse = {
            type: 'error',
            error: `Voice processing failed: ${err instanceof Error ? err.message : 'Unknown error'}`
          };
          ws.send(JSON.stringify(response));
        }
        return;
      }

      if (message.type === 'voice_text' && message.voiceSessionId && message.text) {
        // Direct text input (for testing or accessibility)
        const session = voiceService.getVoiceSession(message.voiceSessionId);
        if (!session) {
          const response: StreamResponse = {
            type: 'error',
            error: `Voice session not found: ${message.voiceSessionId}`
          };
          ws.send(JSON.stringify(response));
          return;
        }

        try {
          serverLog(`🎤 Voice text input: "${message.text}"`);

          const result = await voiceService.processVoiceCommand(
            message.voiceSessionId,
            message.text,
            (progressText: string) => {
              const progressResponse: StreamResponse = {
                type: 'voice_progress',
                voiceSessionId: message.voiceSessionId,
                responseText: progressText
              };
              ws.send(JSON.stringify(progressResponse));
            },
            (audio: Buffer) => {
              const audioResponse: StreamResponse = {
                type: 'voice_audio',
                voiceSessionId: message.voiceSessionId,
                audioData: audio.toString('base64'),
                audioMimeType: 'audio/mp3'
              };
              ws.send(JSON.stringify(audioResponse));
            }
          );

          // Send final response (audio already sent via callback, don't duplicate)
          const finalResponse: StreamResponse = {
            type: 'voice_response',
            voiceSessionId: message.voiceSessionId,
            responseText: result.text
          };
          ws.send(JSON.stringify(finalResponse));

        } catch (err) {
          serverError('Voice text processing error:', err);
          const response: StreamResponse = {
            type: 'error',
            error: `Voice processing failed: ${err instanceof Error ? err.message : 'Unknown error'}`
          };
          ws.send(JSON.stringify(response));
        }
        return;
      }

      if (message.type === 'voice_close' && message.voiceSessionId) {
        voiceService.closeVoiceSession(message.voiceSessionId);
        serverLog(`🎤 Closed voice session ${message.voiceSessionId}`);

        const response: StreamResponse = {
          type: 'voice_closed',
          voiceSessionId: message.voiceSessionId
        };
        ws.send(JSON.stringify(response));
        return;
      }

    } catch (err) {
      serverError('❌ Message parsing error:', err);
      const errorMsg: StreamResponse = {
        type: 'error',
        error: 'Invalid message format'
      };
      ws.send(JSON.stringify(errorMsg));
    }
  });

  ws.on('close', () => {
    serverLog('❌ Lora iOS app disconnected');
    // Kill PTY connections but KEEP tmux sessions alive (session persistence)
    for (const [id, session] of terminals) {
      serverLog(`🖥️  Disconnecting from terminal ${id} (tmux session preserved: ${session.tmuxSessionName})`);
      terminalLog(id, 'DISCONNECTED');

      // Kill the PTY (which detaches from tmux) but keep tmux session
      if (session.pty) {
        session.pty.kill();
      }
    }
    terminals.clear();
    // Note: tmux sessions remain alive for reconnection
    serverLog('💾 Tmux sessions preserved for reconnection');
  });

  ws.on('error', (err: Error) => {
    serverError('WebSocket error:', err.message);
  });
});

wss.on('error', (err: Error) => {
  serverError('Server error:', err?.message || String(err) || 'Unknown error');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\nShutting down Lora Bridge Server...');
  wss.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
