import 'dotenv/config';
import { WebSocketServer, WebSocket } from 'ws';
import { networkInterfaces } from 'os';
import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as pty from 'node-pty';
import * as voiceService from './voice-service';
import * as tmuxService from './tmux-service';
import { getTemplate } from './templates';
import { ProjectType } from './templates/types';

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
  type: 'ping' | 'create_project' | 'delete_project' | 'list_projects' | 'get_files' | 'get_file_content' | 'save_file' | 'terminal_create' | 'terminal_input' | 'terminal_resize' | 'terminal_close' | 'set_sandbox' | 'voice_create' | 'voice_audio' | 'voice_text' | 'voice_close' | 'voice_status' | 'voice_terminal_enable' | 'voice_terminal_disable' | 'voice_terminal_audio' | 'voice_interrupt' | 'screenshot_captured' | 'preview_start' | 'preview_stop' | 'preview_status';
  projectName?: string;
  projectId?: string;
  projectType?: ProjectType;
  filePath?: string;
  content?: string; // For save_file
  terminalId?: string;
  input?: string;
  cols?: number;
  rows?: number;
  sandbox?: boolean; // true = sandboxed to project, false = full filesystem access
  autoStartClaude?: boolean; // Auto-start claude code on terminal creation
  killSession?: boolean; // For terminal_close - also kill tmux session (default: preserve)
  initialPrompt?: string; // Initial prompt to send to Claude Code on startup
  // Voice-related fields
  voiceSessionId?: string;
  audioData?: string; // Base64 encoded audio
  audioMimeType?: string; // e.g., 'audio/wav', 'audio/m4a'
  text?: string; // For voice_text (text input instead of audio)
  screenCapture?: string; // Base64 encoded PNG screenshot of the phone screen
  terminalContent?: string; // Recent terminal output for context
  appState?: {  // Current app state for voice agent context
    currentTab: string;
    projectName?: string;
    projectId?: string;
    hasPreview?: boolean;
    fileCount?: number;
    // Multi-terminal support
    terminalCount?: number;        // Total number of open terminals
    activeTerminalIndex?: number;  // Currently active terminal (0-indexed)
    activeTerminalId?: string;     // ID of the active terminal
  };
  model?: string; // Voice agent model selection
}

interface ProjectInfo {
  id: string;
  name: string;
  path: string;
  projectType: ProjectType;
  createdAt: string;
}

interface FileInfo {
  path: string;
  name: string;
  isDirectory: boolean;
}

interface StreamResponse {
  type: 'pong' | 'connected' | 'projects' | 'files' | 'file_content' | 'file_saved' | 'project_created' | 'project_deleted' | 'terminal_created' | 'terminal_output' | 'terminal_closed' | 'error' | 'voice_created' | 'voice_transcription' | 'voice_response' | 'voice_audio' | 'voice_progress' | 'voice_closed' | 'voice_status' | 'voice_terminal_enabled' | 'voice_terminal_disabled' | 'voice_terminal_speaking' | 'voice_app_control' | 'voice_working' | 'voice_background_task_started' | 'voice_background_task_complete' | 'preview_started' | 'preview_stopped' | 'preview_status' | 'preview_error';
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
  // App control from voice agent
  appControl?: {
    action:
      | 'navigate'           // Go to a tab (target: projects, terminal, editor, preview, settings)
      | 'take_screenshot'    // Capture current screen
      | 'send_input'         // Send text to terminal (params.text)
      | 'send_control'       // Send control key (params.key: ESCAPE, CTRL_C, UP, DOWN, etc)
      | 'new_terminal'       // Create new terminal tab
      | 'close_terminal'     // Close current terminal tab
      | 'switch_terminal'    // Switch terminal (params.index or params.direction: next/prev)
      | 'refresh_files'      // Refresh file list in editor
      | 'show_settings'      // Open settings modal
      | 'scroll'             // Scroll terminal (params.direction: up/down, params.count)
      | 'toggle_console'     // Toggle console panel visibility in preview tab
      | 'reload_preview'     // Reload the preview webview
      | 'send_to_claude'     // Send console logs to Claude for analysis
      | 'open_file'          // Open a file in editor (params.filePath)
      | 'close_file'         // Close current file and return to file list
      | 'save_file'          // Save the current file
      | 'set_file_content';  // Replace file content (params.content)
    target?: string; // tab name, button id, etc.
    params?: Record<string, unknown>;
  };
  // Working state from voice agent (agent is still in control, playing waiting sound)
  workingState?: {
    reason: 'screenshot' | 'claude_action' | 'gathering_info' | 'analyzing';
    followUpAction?: 'take_screenshot' | 'wait_for_claude' | 'check_files';
  };
  // Background task notification fields
  backgroundTaskId?: string;
  backgroundTaskDescription?: string;
  backgroundTaskResult?: string;
  // Preview-related fields
  previewUrl?: string;
  previewPort?: number;
  previewRunning?: boolean;
  stopped?: boolean;
  previewError?: string; // Error message from preview server
  previewErrorType?: 'error' | 'warn' | 'info'; // Severity of preview message
}

// Terminal session management (hybrid: tmux for commands, PTY for output)
// Background task that's running while user continues conversation
interface BackgroundTask {
  id: string;
  description: string;
  prompt: string;
  startedAt: number;
  status: 'running' | 'completed' | 'failed';
  result?: string;
}

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
  voiceAgentModel?: string; // Selected model for voice agent (e.g., claude-haiku-4-5-20251001)
  voiceAwaitingResponse: boolean;
  voiceAccumulatedOutput: string;
  voiceLastOutputTime: number;
  // Idle state: true when waiting for user to speak next (after we respond)
  // This prevents processing silence/noise as commands
  voiceIdleWaiting: boolean;
  // Cooldown: timestamp when we last sent TTS - ignore audio for a few seconds after
  voiceLastTTSTime: number;
  // Counter for consecutive WORKING responses - prevents infinite loops
  voiceWorkingLoopCount: number;
  // Background tasks running while user continues conversation
  backgroundTasks: BackgroundTask[];
  // WebSocket for sending notifications (stored for background task callbacks)
  ws?: WebSocket;
  // Pending screenshot resolver for take_screenshot actions
  pendingScreenshotResolver?: (screenshot: string) => void;
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

// ============================================================================
// PREVIEW SERVER MANAGEMENT
// ============================================================================

interface PreviewServer {
  projectId: string;
  process: ChildProcess;
  port: number;
  url: string;
  startedAt: number;
  onError?: (error: string, errorType: 'error' | 'warn' | 'info') => void;
}

// Track running preview servers per project
const previewServers: Map<string, PreviewServer> = new Map();

// Base port for preview servers (each project gets a unique port)
let nextPreviewPort = 19006;

/**
 * Check if a port is available
 */
async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const net = require('net');
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port);
  });
}

/**
 * Find an available port starting from the given port
 */
async function findAvailablePort(startPort: number): Promise<number> {
  let port = startPort;
  while (port < startPort + 100) { // Try up to 100 ports
    if (await isPortAvailable(port)) {
      return port;
    }
    port++;
  }
  throw new Error(`Could not find available port in range ${startPort}-${startPort + 100}`);
}

/**
 * Wait for a URL to respond
 */
async function waitForServer(url: string, timeoutMs: number = 30000): Promise<boolean> {
  const http = require('http');
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      await new Promise<void>((resolve, reject) => {
        const req = http.get(url, (res: any) => {
          res.resume(); // Consume response
          resolve();
        });
        req.on('error', reject);
        req.setTimeout(2000, () => {
          req.destroy();
          reject(new Error('timeout'));
        });
      });
      return true;
    } catch {
      // Server not ready yet, wait and retry
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  return false;
}

/**
 * Start a preview server for a project
 */
async function startPreviewServer(
  projectId: string,
  onError?: (error: string, errorType: 'error' | 'warn' | 'info') => void
): Promise<{ url: string; port: number }> {
  // Check if already running
  const existing = previewServers.get(projectId);
  if (existing) {
    serverLog(`🔄 Preview server already running for ${projectId} at ${existing.url}`);
    return { url: existing.url, port: existing.port };
  }

  const projectPath = getProjectPath(projectId);
  if (!fs.existsSync(projectPath)) {
    throw new Error(`Project not found: ${projectId}`);
  }

  // Check if package.json exists (required for Expo)
  const packageJsonPath = path.join(projectPath, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`No package.json found in project. Please create an Expo project first.`);
  }

  // Check if node_modules exists, if not run npm install first
  const nodeModulesPath = path.join(projectPath, 'node_modules');
  if (!fs.existsSync(nodeModulesPath)) {
    serverLog(`📦 Installing dependencies for ${projectId}...`);
    onError?.(`Installing dependencies... This may take a moment.`, 'info');
    await new Promise<void>((resolve, reject) => {
      const npmInstall = spawn('npm', ['install'], {
        cwd: projectPath,
        stdio: 'pipe'
      });
      npmInstall.on('close', (code) => {
        if (code === 0) {
          onError?.(`Dependencies installed successfully.`, 'info');
          resolve();
        } else {
          onError?.(`npm install failed with code ${code}`, 'error');
          reject(new Error(`npm install failed with code ${code}`));
        }
      });
      npmInstall.on('error', (err) => {
        onError?.(`npm install error: ${err.message}`, 'error');
        reject(err);
      });
    });
  }

  // Detect project type from .lora.json
  let projectType: ProjectType = 'mobile';
  const metaPath = path.join(projectPath, '.lora.json');
  if (fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      projectType = meta.projectType || 'mobile';
    } catch (err) {
      serverError(`Failed to read project type:`, err);
    }
  }

  const template = getTemplate(projectType);

  // Find an available port
  const port = await findAvailablePort(nextPreviewPort);
  nextPreviewPort = port + 1; // Update for next time

  serverLog(`🚀 Starting ${template.name} preview for ${projectId} on port ${port}`);

  // Start dev server with template's command
  const devCmd = template.getDevCommand(port);
  const expoProcess = spawn(devCmd[0], devCmd.slice(1), {
    cwd: projectPath,
    stdio: 'pipe',
    env: { ...process.env, BROWSER: 'none', CI: '1' }  // Don't open browser, run non-interactive
  });

  // Use network IP so mobile app can access it
  const networkIP = getLocalIP();
  const url = `http://${networkIP}:${port}`;

  const server: PreviewServer = {
    projectId,
    process: expoProcess,
    port,
    url,
    startedAt: Date.now(),
    onError
  };

  previewServers.set(projectId, server);

  let serverFailed = false;
  let failureReason = '';

  expoProcess.stdout?.on('data', (data) => {
    const output = data.toString().trim();
    serverLog(`[Preview ${projectId}] ${output}`);
  });

  expoProcess.stderr?.on('data', (data) => {
    const output = data.toString().trim();
    serverError(`[Preview ${projectId}] ${output}`);

    // Determine error type and forward to client
    let errorType: 'error' | 'warn' | 'info' = 'error';
    if (output.includes('warning') || output.includes('deprecated')) {
      errorType = 'warn';
    }

    // Forward significant errors to client console
    if (output.includes('CommandError') || output.includes('Error:') ||
        output.includes('not installed') || output.includes('not found') ||
        output.includes('failed') || output.includes('EADDRINUSE') ||
        output.includes('Input is required')) {
      onError?.(output, errorType);
      serverFailed = true;
      failureReason = output;
    } else if (output.includes('warning')) {
      onError?.(output, 'warn');
    }
  });

  expoProcess.on('close', (code) => {
    serverLog(`[Preview ${projectId}] Server exited with code ${code}`);
    previewServers.delete(projectId);
    if (code !== 0) {
      serverFailed = true;
      onError?.(`Preview server exited with code ${code}`, 'error');
    }
  });

  // Wait for the server to actually respond (use localhost for local check)
  const localUrl = `http://localhost:${port}`;
  serverLog(`[Preview ${projectId}] Waiting for server to be ready...`);
  const serverReady = await waitForServer(localUrl, 30000);

  if (!serverReady || serverFailed) {
    // Clean up if server failed to start
    previewServers.delete(projectId);
    expoProcess.kill();
    throw new Error(failureReason || `Preview server failed to start on port ${port}`);
  }

  serverLog(`✅ Preview server started for ${projectId} at ${url}`);
  return { url, port };
}

/**
 * Stop a preview server for a project
 */
function stopPreviewServer(projectId: string): boolean {
  const server = previewServers.get(projectId);
  if (!server) {
    return false;
  }

  serverLog(`🛑 Stopping preview server for ${projectId}`);
  server.process.kill();
  previewServers.delete(projectId);
  return true;
}

/**
 * Get preview server status for a project
 */
function getPreviewStatus(projectId: string): { running: boolean; url?: string; port?: number } {
  const server = previewServers.get(projectId);
  if (server) {
    return { running: true, url: server.url, port: server.port };
  }
  return { running: false };
}

// ============================================================================
// VOICE PROCESSING
// ============================================================================

/**
 * Process terminal output and generate voice response
 * Used when voice mode is enabled on a terminal
 * @param isComplete - If true, this is the final response and client should return to listening
 */
async function processTerminalVoiceResponse(ws: WebSocket, terminalId: string, response: string, session?: TerminalSession, isComplete: boolean = true, userRequest?: string): Promise<void> {
  try {
    // Use contextual presentation if we have the user's request, otherwise simple summarization
    const voiceText = userRequest
      ? await voiceService.presentClaudeResponse(response, session?.projectId || terminalId, userRequest)
      : await voiceService.summarizeForVoice(response, terminalId, 'brief');

    if (voiceText && voiceText.length > 10) {
      // Generate TTS
      const audioBuffer = await voiceService.textToSpeech(voiceText);

      // Send to client
      const audioResponse: StreamResponse & { isComplete?: boolean } = {
        type: 'voice_terminal_speaking',
        terminalId,
        responseText: voiceText,
        audioData: audioBuffer.toString('base64'),
        audioMimeType: 'audio/mp3',
        isComplete  // Tell client this is the final response
      };
      ws.send(JSON.stringify(audioResponse));

      // Set TTS cooldown timestamp if session provided
      if (session) {
        session.voiceLastTTSTime = Date.now();
      }
    }
  } catch (err) {
    serverError('[Voice-Terminal] TTS error:', err);
  }
}

function getLocalIP(): string {
  const interfaces = networkInterfaces();
  const candidates: { address: string; priority: number }[] = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        // Prioritize: Tailscale (100.x), LAN (192.168.x), then others
        let priority = 0;
        if (iface.address.startsWith('100.')) priority = 3; // Tailscale (highest)
        else if (iface.address.startsWith('192.168.')) priority = 2; // LAN
        else if (iface.address.startsWith('10.') && !iface.address.startsWith('10.255.')) priority = 1; // Other private
        candidates.push({ address: iface.address, priority });
      }
    }
  }

  // Sort by priority (highest first) and return best match
  candidates.sort((a, b) => b.priority - a.priority);
  return candidates.length > 0 ? candidates[0].address : 'localhost';
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
        projectType: (meta as any).projectType || 'mobile', // Default to mobile for backward compatibility
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
function createProjectWithTemplate(projectId: string, projectName: string, projectType: ProjectType = 'mobile'): void {
  const projectPath = getProjectPath(projectId);

  // Create project directory
  fs.mkdirSync(projectPath, { recursive: true });

  // Get template for project type
  const template = getTemplate(projectType);

  // Generate .lora.json metadata
  const metadata = template.generateMetadata(projectName);
  fs.writeFileSync(
    path.join(projectPath, '.lora.json'),
    JSON.stringify(metadata, null, 2)
  );

  // Generate all template files
  const files = template.generateFiles(projectId, projectName);
  for (const file of files) {
    const filePath = path.join(projectPath, file.path);
    const fileDir = path.dirname(filePath);

    // Create directories for nested files (e.g., src/App.tsx)
    if (!fs.existsSync(fileDir)) {
      fs.mkdirSync(fileDir, { recursive: true });
    }

    fs.writeFileSync(filePath, file.content);
  }

  // Set up sandbox configuration for Claude Code isolation
  tmuxService.setupProjectSandbox(projectPath);

  // Generate CLAUDE.md
  const claudeMd = template.generateClaudeMd(projectPath);
  fs.writeFileSync(path.join(projectPath, 'CLAUDE.md'), claudeMd);

  serverLog(`📁 Created ${template.name}: ${projectName} (${projectId})`);

  // Run npm install in background to install dependencies
  serverLog(`📦 Installing dependencies for ${projectId}...`);
  const installCmd = template.getInstallCommand();
  const npmInstall = spawn(installCmd[0], installCmd.slice(1), {
    cwd: projectPath,
    stdio: 'pipe',
    shell: true
  });

  npmInstall.on('close', (code) => {
    if (code === 0) {
      serverLog(`✅ Dependencies installed for ${projectId}`);
    } else {
      serverLog(`⚠️ Install exited with code ${code} for ${projectId}`);
    }
  });

  npmInstall.on('error', (err) => {
    serverLog(`❌ Install failed for ${projectId}: ${err.message}`);
  });
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
        const projectType = message.projectType || 'mobile';
        const projectId = createProjectId(message.projectName);
        const projectPath = getProjectPath(projectId);

        // Create project with template
        createProjectWithTemplate(projectId, message.projectName, projectType);

        const response: StreamResponse = {
          type: 'project_created',
          project: {
            id: projectId,
            name: message.projectName,
            path: projectPath,
            projectType: projectType,
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
        const files = getProjectFiles(message.projectId, message.filePath);
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
              // No registry entry - check if tmux session still exists (server restart case)
              const expectedSessionName = `lora-${projectId}`;
              const tmuxSessionExists = await tmuxService.sessionExists(expectedSessionName);

              if (tmuxSessionExists) {
                // Tmux session exists from before server restart - reuse it
                tmuxSessionName = expectedSessionName;
                isReusingSession = true;
                serverLog(`♻️  Reconnecting terminal ${terminalId} to existing tmux session: ${tmuxSessionName}`);
                // Re-register to claudeSessionRegistry so future reconnects work
                registerClaudeSession(projectId, tmuxSessionName);
              } else {
                // No existing session - create new tmux session using projectId for persistence
                serverLog(`🖥️  Creating new terminal ${terminalId} for project ${projectId}`);
                const tmuxSession = await tmuxService.createSession(projectId, projectPath, {
                  autoStartClaude: false
                });
                tmuxSessionName = tmuxSession.sessionName;
              }
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
            voiceLastTTSTime: 0,
            voiceWorkingLoopCount: 0,
            backgroundTasks: [],
            ws: ws
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

              // If there's an initial prompt, include it in the command
              if (message.initialPrompt) {
                // Prepare prompt for shell command:
                // 1. Replace newlines with literal \n (Claude CLI interprets these)
                // 2. Escape double quotes (since we wrap in double quotes)
                // 3. Escape backticks and $ (shell special chars within double quotes)
                const cleanPrompt = message.initialPrompt
                  .replace(/\\/g, '\\\\')  // Escape backslashes first
                  .replace(/"/g, '\\"')    // Escape double quotes
                  .replace(/\$/g, '\\$')   // Escape dollar signs
                  .replace(/`/g, '\\`')    // Escape backticks
                  .replace(/\n/g, '\\n')   // Convert newlines to literal \n
                  .replace(/\r/g, '');     // Remove carriage returns

                // Start Claude with --dangerously-skip-permissions to avoid permission prompts
                const claudeCommand = `claude --dangerously-skip-permissions "${cleanPrompt}"`;
                serverLog(`📝 With initial prompt: "${message.initialPrompt.substring(0, 50)}${message.initialPrompt.length > 50 ? '...' : ''}"`);
                await tmuxService.sendCommand(tmuxSessionName, claudeCommand);
                await tmuxService.sendEnter(tmuxSessionName);
              } else {
                // Start Claude with --dangerously-skip-permissions
                await tmuxService.sendCommand(tmuxSessionName, 'claude --dangerously-skip-permissions');
                await tmuxService.sendEnter(tmuxSessionName);
              }
              // Register this session so we can reconnect later
              registerClaudeSession(projectId, tmuxSessionName);
            } else if (isReusingSession) {
              serverLog(`♻️  Reusing existing Claude Code session in terminal ${terminalId}`);
              // If there's an initial prompt for a reused session, send it after a delay
              if (message.initialPrompt) {
                // Replace newlines with literal \n for existing session too
                const cleanPrompt = message.initialPrompt
                  .replace(/\n/g, '\\n')
                  .replace(/\r/g, '');
                serverLog(`📝 Sending prompt to existing session: "${message.initialPrompt.substring(0, 50)}..."`);
                await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for prompt to be ready
                await tmuxService.sendCommand(tmuxSessionName, cleanPrompt);
                await tmuxService.sendEnter(tmuxSessionName);
              }
              // Note: Do NOT send any input when reconnecting without an initial prompt.
              // The PTY will display whatever is already on screen from the tmux session.
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
          session.voiceAgentModel = message.model; // Store selected model
          session.voiceAwaitingResponse = false;
          session.voiceAccumulatedOutput = '';
          session.voiceLastOutputTime = Date.now();
          serverLog(`🎤 Voice mode enabled for terminal ${message.terminalId} with model: ${message.model || 'default'}`);

          const response: StreamResponse = {
            type: 'voice_terminal_enabled',
            terminalId: message.terminalId,
            voiceEnabled: true
          };
          ws.send(JSON.stringify(response));
        } else {
          const response: StreamResponse = {
            type: 'error',
            terminalId: message.terminalId,
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

      // Handle voice interruption from user
      if (message.type === 'voice_interrupt' && message.terminalId) {
        const session = terminals.get(message.terminalId);
        if (session) {
          // Reset voice state
          session.voiceAwaitingResponse = false;
          session.voiceAccumulatedOutput = '';
          session.voiceIdleWaiting = false;
          serverLog(`⏹️ Voice session interrupted for terminal ${message.terminalId}`);
          // Log the interrupt for debugging
          voiceService.handleInterrupt(message.terminalId);
        }
        return;
      }

      // Handle screenshot_captured message (sent after take_screenshot action)
      if (message.type === 'screenshot_captured' && message.terminalId) {
        const session = terminals.get(message.terminalId);
        if (session && session.pendingScreenshotResolver) {
          const screenshot = (message as any).screenshot;
          serverLog(`[Voice] Received screenshot_captured for terminal ${message.terminalId}`);
          session.pendingScreenshotResolver(screenshot);
          session.pendingScreenshotResolver = undefined; // Clear resolver
        }
        return;
      }

      if (message.type === 'voice_terminal_audio' && message.terminalId) {
        serverLog(`[Voice] Audio received for terminal: ${message.terminalId}, activeTerminalId: ${message.appState?.activeTerminalId || 'unknown'}`);
        const session = terminals.get(message.terminalId);
        if (!session) {
          const response: StreamResponse = {
            type: 'error',
            terminalId: message.terminalId,
            error: `Terminal not found: ${message.terminalId}`
          };
          ws.send(JSON.stringify(response));
          return;
        }

        try {
          // Check if this is a screenshot-only follow-up (from working state)
          const isScreenshotFollowUp = (!message.audioData || message.audioData.length < 100) && message.screenCapture;

          // Check if this is a terminal output follow-up (Terminal tab uses terminal content instead of screenshot)
          const isTerminalOutputFollowUp = (!message.audioData || message.audioData.length < 100)
            && !message.screenCapture
            && message.terminalContent
            && message.appState?.currentTab === 'terminal';

          let transcription: string;

          if (isScreenshotFollowUp) {
            // This is a screenshot follow-up from working state
            serverLog('[Voice] Processing screenshot follow-up');
            transcription = '[Screenshot captured - please analyze what you see on the screen]';
          } else if (isTerminalOutputFollowUp) {
            // Terminal tab uses terminal output instead of screenshot - this is normal, not an error
            serverLog('[Voice] Processing terminal output follow-up (Terminal tab)');
            transcription = '[Viewing terminal output - please analyze the current terminal state]';
          } else if (!message.audioData) {
            // No audio data and no visual context - nothing to process
            return;
          } else {
            // Normal audio processing
            // Decode and transcribe audio
            const audioBuffer = Buffer.from(message.audioData, 'base64');
            const mimeType = message.audioMimeType || 'audio/wav';


            // Cooldown check - ignore audio that comes too soon after we sent TTS
            // This prevents picking up our own audio playback
            const TTS_COOLDOWN_MS = 3000; // 3 seconds after TTS before accepting new audio
            const timeSinceTTS = Date.now() - session.voiceLastTTSTime;
            if (session.voiceLastTTSTime > 0 && timeSinceTTS < TTS_COOLDOWN_MS) {
              return;
            }

            // Minimum audio size check - very small files are likely noise/silence
            // M4A typically needs at least ~20KB for a second of speech
            const MIN_AUDIO_SIZE = 15000; // 15KB minimum
            if (audioBuffer.length < MIN_AUDIO_SIZE) {
              return;
            }

            transcription = await voiceService.transcribeAudio(audioBuffer, mimeType);
          }

          if (!transcription || !transcription.trim()) {
            serverLog('[Voice] Empty transcription, ignoring');
            return;
          }

          // Reset working loop counter when user speaks (real audio, not a follow-up)
          // This prevents the counter from carrying over between user requests
          if (!isScreenshotFollowUp && !isTerminalOutputFollowUp) {
            session.voiceWorkingLoopCount = 0;
          }

          // Skip audio filtering for follow-ups (they have synthetic transcription)
          if (!isScreenshotFollowUp && !isTerminalOutputFollowUp) {
            // Filter out common Whisper hallucinations on silence/noise
            const WHISPER_HALLUCINATIONS = [
              'thank you for watching',
              'thanks for watching',
              'subscribe',
              'like and subscribe',
              'see you next time',
              'goodbye',
              'thank you',
              'you',
              'bye',
              'the end',
              '...',
              'hmm',
              'um',
              'uh',
            ];
            const lowerTrim = transcription.toLowerCase().trim();
            if (WHISPER_HALLUCINATIONS.some(h => lowerTrim === h || lowerTrim === h + '.')) {
              serverLog(`[Voice] Filtered Whisper hallucination: "${transcription}"`);
              return;
            }

            // Require minimum word count for meaningful input (at least 2 words)
            const wordCount = transcription.trim().split(/\s+/).length;
            if (wordCount < 2) {
              serverLog(`[Voice] Too short (${wordCount} word): "${transcription}"`);
              return;
            }

            // If we're in idle waiting after TTS, require more substantial input (3+ words)
            if (session.voiceIdleWaiting && wordCount < 3) {
              serverLog(`[Voice] Waiting for more substantial input (got ${wordCount} words)`);
              return;
            }
          }

          // Send transcription to client (what the user said)
          serverLog(`[Voice] User said: "${transcription}"`);
          const transcriptionResponse: StreamResponse = {
            type: 'voice_transcription',
            terminalId: message.terminalId,
            transcription
          };
          ws.send(JSON.stringify(transcriptionResponse));

          // Get Claude's current state from hooks for context
          const currentHookState = tmuxService.getClaudeHookState(session.tmuxSessionName);
          const stateDescription = currentHookState.state === 'idle' ? 'ready for input' :
                                   currentHookState.state === 'permission' ? 'waiting for confirmation (y/n)' :
                                   currentHookState.state === 'processing' ? 'still processing' :
                                   currentHookState.state === 'stopped' ? 'session ended' : 'unknown';

          // Smart handling based on Claude's current state
          // If Claude is waiting for confirmation and user says yes/no, handle directly
          if (currentHookState.state === 'permission') {
            const lowerTranscript = transcription.toLowerCase().trim();
            const isYes = /^(yes|yeah|yep|sure|ok|okay|do it|go ahead|proceed|confirm|affirmative)/.test(lowerTranscript);
            const isNo = /^(no|nope|nah|cancel|don't|stop|abort|negative)/.test(lowerTranscript);

            if (isYes || isNo) {
              const response = isYes ? 'y' : 'n';

              // Capture output before sending confirmation
              const outputBeforeConfirm = await tmuxService.captureOutput(session.tmuxSessionName, 100);

              await tmuxService.sendCommand(session.tmuxSessionName, response);
              await tmuxService.sendEnter(session.tmuxSessionName);

              // Wait for Claude to process the confirmation
              const confirmState = await tmuxService.waitForClaudeReadyWithHooks(session.tmuxSessionName, {
                timeoutMs: 60000,
                pollIntervalMs: 300,
                previousOutput: outputBeforeConfirm  // Filter out old content
              });

              const confirmResponse = tmuxService.extractClaudeResponse(confirmState.rawOutput);

              // Generate voice response
              const voiceText = isYes ? 'Got it, proceeding.' : 'Okay, cancelled.';
              const ttsAudio = await voiceService.textToSpeech(voiceText);
              const audioResponse: StreamResponse = {
                type: 'voice_terminal_speaking',
                terminalId: message.terminalId,
                responseText: voiceText,
                audioData: ttsAudio.toString('base64'),
                audioMimeType: 'audio/mp3'
              };
              ws.send(JSON.stringify(audioResponse));
              session.voiceLastTTSTime = Date.now();
              session.voiceIdleWaiting = true;
              return;
            }
          }

          // If Claude is still processing and user wants to interrupt
          if (currentHookState.state === 'processing') {
            const lowerTranscript = transcription.toLowerCase().trim();
            const wantsInterrupt = /^(stop|cancel|interrupt|abort|ctrl.?c|nevermind|never mind)/.test(lowerTranscript);

            if (wantsInterrupt) {

              await tmuxService.sendControlKey(session.tmuxSessionName, 'c');

              const interruptText = 'Interrupted. The operation has been cancelled.';
              const ttsAudio = await voiceService.textToSpeech(interruptText);
              const audioResponse: StreamResponse = {
                type: 'voice_terminal_speaking',
                terminalId: message.terminalId,
                responseText: interruptText,
                audioData: ttsAudio.toString('base64'),
                audioMimeType: 'audio/mp3'
              };
              ws.send(JSON.stringify(audioResponse));
              session.voiceLastTTSTime = Date.now();
              session.voiceIdleWaiting = true;
              return;
            }
          }

          // Process with Voice Agent LLM - it decides what to do
          const projectMeta = listProjects().find(p => p.id === session.projectId);

          // Build comprehensive context for voice agent
          // Use terminal content from mobile app if provided, otherwise use accumulated output
          const terminalContext = message.terminalContent || session.voiceAccumulatedOutput.slice(-500);

          // Build app state description
          let appStateDesc = '';
          if (message.appState) {
            appStateDesc = `\n## App State:\n`;
            appStateDesc += `- Current tab: ${message.appState.currentTab}\n`;
            if (message.appState.projectName) {
              appStateDesc += `- Project: ${message.appState.projectName}\n`;
            }
            // Multi-terminal info
            if (message.appState.terminalCount !== undefined && message.appState.terminalCount > 0) {
              appStateDesc += `- Open terminals: ${message.appState.terminalCount}\n`;
              appStateDesc += `- Active terminal: Terminal ${(message.appState.activeTerminalIndex ?? 0) + 1} of ${message.appState.terminalCount}\n`;
            }
          }

          const agentResponse = await voiceService.processVoiceInput(
            transcription,
            session.projectId,  // sessionId for conversation memory - USE PROJECT ID so all terminals share memory!
            {
              projectName: message.appState?.projectName || projectMeta?.name,
              recentOutput: terminalContext + appStateDesc,
              claudeCodeState: stateDescription,
              screenCapture: message.screenCapture,  // Phone screenshot if provided
              terminalContent: terminalContext,
              appState: message.appState
            },
            session.voiceAgentModel  // Pass selected model
          );

          // Log agent response for debugging
          serverLog(`[Voice] Agent response: type=${agentResponse.type}, voiceResponse="${agentResponse.voiceResponse || ''}", content="${agentResponse.content?.substring(0, 100) || ''}"`);

          // Handle IGNORE - transcription artifacts, noise
          if (agentResponse.type === 'ignore') {
            return;
          }

          // ======================================================================
          // ACTION CLASSIFICATION HELPERS FOR PARALLEL EXECUTION
          // ======================================================================

          interface ActionWithTarget {
            action: any;
            index: number;
            targetTerminalIndex?: number;
            targetTmuxSession: string;
          }

          interface ActionGroup {
            actions: ActionWithTarget[];
            isParallel: boolean;
            description: string;
          }

          /**
           * Classifies actions into groups that can run in parallel vs sequentially.
           *
           * Rules:
           * - Multiple prompt actions with DIFFERENT terminal targets → Parallel group
           * - switch_terminal followed by prompt to SAME terminal → Sequential
           * - take_screenshot → Always sequential (waits for all prompts first)
           * - Other actions → Sequential by default
           */
          function classifyActionGroups(
            actions: any[],
            projectId: string,
            currentTmuxSession: string
          ): ActionGroup[] {
            const groups: ActionGroup[] = [];
            let currentGroup: ActionGroup = {
              actions: [],
              isParallel: false,
              description: ''
            };

            // Get all terminals for this project (ordered by creation)
            const projectTerminals = Array.from(terminals.values())
              .filter(t => t.projectId === projectId);

            // Track which terminal index is currently targeted based on previous switches
            let currentTargetIndex: number | undefined = undefined;

            // Find current terminal's index
            for (let i = 0; i < projectTerminals.length; i++) {
              if (projectTerminals[i].tmuxSessionName === currentTmuxSession) {
                currentTargetIndex = i;
                break;
              }
            }

            for (let i = 0; i < actions.length; i++) {
              const action = actions[i];

              // Determine target terminal for this action based on previous switches
              let targetTerminalIndex = currentTargetIndex;
              let targetTmuxSession = currentTmuxSession;

              // Check if this action is a terminal switch that updates the target
              if (action.type === 'app_control' &&
                  action.appAction?.action === 'switch_terminal' &&
                  action.appAction?.params?.index !== undefined) {
                const switchIndex = action.appAction.params.index as number;
                if (switchIndex >= 0 && switchIndex < projectTerminals.length) {
                  currentTargetIndex = switchIndex;
                  targetTerminalIndex = switchIndex;
                  targetTmuxSession = projectTerminals[switchIndex].tmuxSessionName;
                }
              } else {
                // Use current target from previous switches
                if (currentTargetIndex !== undefined && currentTargetIndex < projectTerminals.length) {
                  targetTmuxSession = projectTerminals[currentTargetIndex].tmuxSessionName;
                }
              }

              const actionWithTarget: ActionWithTarget = {
                action,
                index: i,
                targetTerminalIndex,
                targetTmuxSession
              };

              // RULE 1: switch_terminal creates a new sequential group
              if (action.type === 'app_control' &&
                  action.appAction?.action === 'switch_terminal') {
                // Flush current group if it has actions
                if (currentGroup.actions.length > 0) {
                  groups.push(currentGroup);
                }
                // Start new sequential group with just the switch
                currentGroup = {
                  actions: [actionWithTarget],
                  isParallel: false,
                  description: `Switch to Terminal ${(action.appAction.params?.index ?? 0) + 1}`
                };
                continue;
              }

              // RULE 2: take_screenshot must be sequential (wait for all prompts first)
              if (action.type === 'app_control' &&
                  action.appAction?.action === 'take_screenshot') {
                // Flush current group
                if (currentGroup.actions.length > 0) {
                  groups.push(currentGroup);
                }
                // Screenshot is its own sequential group
                groups.push({
                  actions: [actionWithTarget],
                  isParallel: false,
                  description: 'Capture screenshot'
                });
                currentGroup = { actions: [], isParallel: false, description: '' };
                continue;
              }

              // RULE 3: Multiple prompt actions with DIFFERENT targets = parallel
              if (action.type === 'prompt') {
                if (currentGroup.actions.length === 0) {
                  // First prompt - start a new group
                  currentGroup.actions.push(actionWithTarget);
                  currentGroup.description = action.description || 'Execute command';
                } else {
                  // Check if this prompt targets a different terminal than others in group
                  const existingPromptTargets = new Set(
                    currentGroup.actions
                      .filter(a => a.action.type === 'prompt')
                      .map(a => a.targetTmuxSession)
                  );

                  if (existingPromptTargets.size > 0 && !existingPromptTargets.has(targetTmuxSession)) {
                    // Different target - can run in parallel
                    currentGroup.isParallel = true;
                    currentGroup.actions.push(actionWithTarget);
                    currentGroup.description += ` + ${action.description || 'Execute command'}`;
                  } else {
                    // Same target - must be sequential, flush and start new group
                    groups.push(currentGroup);
                    currentGroup = {
                      actions: [actionWithTarget],
                      isParallel: false,
                      description: action.description || 'Execute command'
                    };
                  }
                }
                continue;
              }

              // RULE 4: All other actions are sequential
              currentGroup.actions.push(actionWithTarget);
              if (!currentGroup.description) {
                currentGroup.description = action.description || 'Execute action';
              }
            }

            // Flush final group
            if (currentGroup.actions.length > 0) {
              groups.push(currentGroup);
            }

            return groups;
          }

          /**
           * Execute a single action sequentially.
           * Handles app_control, prompt, and control action types.
           */
          async function executeSequentialAction(
            actionWithTarget: ActionWithTarget,
            ws: WebSocket,
            session: TerminalSession,
            message: Message,
            results: Array<{ action: string; success: boolean; error?: string; claudeResponse?: string; screenshot?: string; terminalIndex?: number }>
          ): Promise<{ lastClaudeResponse?: string; capturedScreenshot?: string }> {
            const { action, targetTmuxSession, targetTerminalIndex } = actionWithTarget;
            let lastClaudeResponse: string | undefined;
            let capturedScreenshot: string | undefined;

            serverLog(`[Voice] Executing action: ${action.description}`);

            // Send progress update
            ws.send(JSON.stringify({
              type: 'voice_progress',
              terminalId: message.terminalId,
              progress: action.description
            }));

            if (action.type === 'app_control' && action.appAction) {
              // Send app control action
              serverLog(`[Voice] Sending app_control: ${JSON.stringify(action.appAction)}`);
              ws.send(JSON.stringify({
                type: 'voice_app_control',
                terminalId: message.terminalId,
                appControl: action.appAction
              }));

              // Special handling for take_screenshot - wait for screenshot response
              if (action.appAction.action === 'take_screenshot') {
                serverLog(`[Voice] Waiting for screenshot response...`);

                // Wait for screenshot_captured message (with timeout)
                const screenshot = await new Promise<string | undefined>((resolve) => {
                  const timeoutId = setTimeout(() => {
                    serverLog(`[Voice] Screenshot timeout - no response received`);
                    resolve(undefined);
                  }, 5000);

                  session.pendingScreenshotResolver = (screenshot: string) => {
                    clearTimeout(timeoutId);
                    serverLog(`[Voice] Screenshot received (${screenshot.length} chars)`);
                    resolve(screenshot);
                  };
                });

                if (screenshot) {
                  capturedScreenshot = screenshot;
                  results.push({ action: action.description, success: true, screenshot });
                  serverLog(`[Voice] Screenshot captured and stored`);
                } else {
                  results.push({ action: action.description, success: false, error: 'Screenshot capture timed out' });
                }
              } else {
                // Wait for action to complete
                await new Promise(resolve => setTimeout(resolve, 800));
                results.push({ action: action.description, success: true, terminalIndex: targetTerminalIndex });
              }

            } else if (action.type === 'prompt') {
              // Auto-navigate to terminal if needed
              const currentTab = message.appState?.currentTab;
              if (currentTab && currentTab !== 'terminal' && currentTab !== 'chat') {
                serverLog(`[Voice] Auto-navigating to terminal before sending prompt (currently on ${currentTab})`);
                ws.send(JSON.stringify({
                  type: 'voice_app_control',
                  terminalId: message.terminalId,
                  appControl: { action: 'navigate', target: 'terminal' }
                }));
                await new Promise(resolve => setTimeout(resolve, 800));
              }

              // Capture output before sending
              const outputBeforeCommand = await tmuxService.captureOutput(targetTmuxSession, 100);

              // Send prompt to Claude Code with verification
              await tmuxService.sendPromptWithVerification(targetTmuxSession, action.content);

              // Wait for Claude Code to respond
              const claudeResult = await tmuxService.waitForClaudeReadyWithHooks(targetTmuxSession, {
                timeoutMs: 180000,
                pollIntervalMs: 300,
                previousOutput: outputBeforeCommand
              });

              if (claudeResult.isReady) {
                // Extract Claude's response
                const claudeResponse = tmuxService.extractClaudeResponse(claudeResult.rawOutput);
                lastClaudeResponse = claudeResponse;
                results.push({
                  action: action.description,
                  success: true,
                  claudeResponse: claudeResponse?.substring(0, 200),
                  terminalIndex: targetTerminalIndex
                });
                serverLog(`[Voice] Claude responded: ${claudeResponse?.substring(0, 100)}...`);
              } else {
                results.push({
                  action: action.description,
                  success: false,
                  error: 'Claude Code did not respond',
                  terminalIndex: targetTerminalIndex
                });
                throw new Error('Claude Code did not respond');
              }

            } else if (action.type === 'control') {
              // Send control command (placeholder for future implementation)
              results.push({ action: action.description, success: true, terminalIndex: targetTerminalIndex });
            }

            return { lastClaudeResponse, capturedScreenshot };
          }

          /**
           * Execute a group of actions in parallel.
           * Only applies to prompt actions targeting different terminals.
           */
          async function executeParallelActionGroup(
            group: ActionGroup,
            ws: WebSocket,
            session: TerminalSession,
            message: Message,
            results: Array<{ action: string; success: boolean; error?: string; claudeResponse?: string; terminalIndex?: number }>
          ): Promise<{ lastClaudeResponse?: string }> {
            serverLog(`[Voice] Starting parallel execution of ${group.actions.length} prompts`);

            // Send initial progress
            ws.send(JSON.stringify({
              type: 'voice_progress',
              terminalId: message.terminalId,
              progress: `Running commands in ${group.actions.length} terminals...`
            }));

            // Auto-switch to first-mentioned terminal for visual feedback
            const firstTerminalIndex = group.actions[0].targetTerminalIndex;
            if (firstTerminalIndex !== undefined) {
              serverLog(`[Voice] Auto-switching to Terminal ${firstTerminalIndex + 1} (first mentioned)`);
              ws.send(JSON.stringify({
                type: 'voice_app_control',
                terminalId: message.terminalId,
                appControl: {
                  action: 'switch_terminal',
                  params: { index: firstTerminalIndex }
                }
              }));
              await new Promise(resolve => setTimeout(resolve, 600));
            }

            // Prepare sessions for parallel execution
            const parallelSessions: Array<{
              sessionName: string;
              terminalIndex: number;
              previousOutput: string;
              description: string;
              actionIndex: number;
            }> = [];

            // Auto-navigate to terminal if needed (once, before all prompts)
            const currentTab = message.appState?.currentTab;
            if (currentTab && currentTab !== 'terminal' && currentTab !== 'chat') {
              serverLog(`[Voice] Auto-navigating to terminal before parallel prompts`);
              ws.send(JSON.stringify({
                type: 'voice_app_control',
                terminalId: message.terminalId,
                appControl: { action: 'navigate', target: 'terminal' }
              }));
              await new Promise(resolve => setTimeout(resolve, 800));
            }

            // Send all prompts to their respective terminals
            for (const actionWithTarget of group.actions) {
              const { action, targetTmuxSession, targetTerminalIndex } = actionWithTarget;

              if (action.type === 'prompt') {
                // Capture output before command
                const outputBefore = await tmuxService.captureOutput(targetTmuxSession, 100);

                // Send prompt
                await tmuxService.sendPromptWithVerification(targetTmuxSession, action.content);
                serverLog(`[Voice] Sent prompt to Terminal ${(targetTerminalIndex ?? 0) + 1} (${targetTmuxSession}): "${action.content.substring(0, 50)}..."`);

                parallelSessions.push({
                  sessionName: targetTmuxSession,
                  terminalIndex: targetTerminalIndex ?? 0,
                  previousOutput: outputBefore,
                  description: action.description,
                  actionIndex: actionWithTarget.index
                });
              }
            }

            // Wait for all sessions concurrently with progress streaming
            const progressResults = await tmuxService.waitForMultipleClaudeSessions(
              parallelSessions,
              {
                timeoutMs: 180000,
                pollIntervalMs: 300,
                onProgress: async (progress) => {
                  // Stream TTS update when a terminal completes
                  const terminalLabel = `Terminal ${progress.terminalIndex + 1}`;
                  const statusText = progress.isSuccess
                    ? `${terminalLabel} finished`
                    : `${terminalLabel} had an error`;

                  serverLog(`[Voice] Progress update: ${statusText}`);

                  // Generate and send TTS for this progress update
                  try {
                    const ttsAudio = await voiceService.textToSpeech(statusText);
                    ws.send(JSON.stringify({
                      type: 'voice_terminal_speaking',
                      terminalId: message.terminalId,
                      responseText: statusText,
                      audioData: ttsAudio.toString('base64'),
                      audioMimeType: 'audio/mp3',
                      isComplete: false  // More terminals may still be running
                    }));
                    session.voiceLastTTSTime = Date.now();
                  } catch (ttsError) {
                    serverLog(`[Voice] TTS failed for progress update: ${ttsError}`);
                  }
                }
              }
            );

            // Record results
            let lastClaudeResponse: string | undefined;
            for (let i = 0; i < progressResults.length; i++) {
              const progress = progressResults[i];
              const parallelSession = parallelSessions[i];

              results.push({
                action: parallelSession.description,
                success: progress.isSuccess,
                error: progress.error,
                claudeResponse: progress.claudeResponse?.substring(0, 200),
                terminalIndex: progress.terminalIndex
              });

              // Keep the last successful Claude response for summary
              if (progress.isSuccess && progress.claudeResponse) {
                lastClaudeResponse = progress.claudeResponse;
              }
            }

            const successCount = progressResults.filter(p => p.isSuccess).length;
            serverLog(`[Voice] Parallel group complete: ${successCount}/${progressResults.length} succeeded`);

            return { lastClaudeResponse };
          }

          // Handle ACTION_SEQUENCE - execute multiple actions (parallel or sequential)
          if (agentResponse.type === 'action_sequence' && agentResponse.actions) {
            serverLog(`[Voice] Executing action sequence with ${agentResponse.actions.length} actions`);

            // Speak initial response
            const initialSpeech = agentResponse.voiceResponse || agentResponse.content;
            const initialTTS = await voiceService.textToSpeech(initialSpeech);
            ws.send(JSON.stringify({
              type: 'voice_terminal_speaking',
              terminalId: message.terminalId,
              responseText: initialSpeech,
              audioData: initialTTS.toString('base64'),
              audioMimeType: 'audio/mp3',
              isComplete: false
            }));
            session.voiceLastTTSTime = Date.now();

            // Classify actions into parallel/sequential groups
            const actionGroups = classifyActionGroups(
              agentResponse.actions,
              session.projectId,
              session.tmuxSessionName
            );

            serverLog(`[Voice] Classified ${agentResponse.actions.length} actions into ${actionGroups.length} group(s)`);
            actionGroups.forEach((group, idx) => {
              serverLog(`[Voice] Group ${idx + 1}: ${group.isParallel ? 'PARALLEL' : 'SEQUENTIAL'} - ${group.description}`);
            });

            // Execute action groups with error handling
            const results: Array<{ action: string; success: boolean; error?: string; claudeResponse?: string; screenshot?: string; terminalIndex?: number }> = [];
            let lastClaudeResponse: string | undefined;
            let capturedScreenshot: string | undefined;
            let hasError = false;

            for (let groupIdx = 0; groupIdx < actionGroups.length; groupIdx++) {
              const group = actionGroups[groupIdx];

              // Stop on first error (user requirement: let successful terminals continue)
              // But we stop BETWEEN groups, not within parallel groups
              if (hasError) {
                serverLog(`[Voice] Skipping group ${groupIdx + 1} due to previous error`);
                break;
              }

              serverLog(`[Voice] Executing group ${groupIdx + 1}/${actionGroups.length}: ${group.description} (${group.isParallel ? 'parallel' : 'sequential'})`);

              try {
                if (group.isParallel) {
                  // PARALLEL EXECUTION
                  const parallelResult = await executeParallelActionGroup(group, ws, session, message, results);
                  if (parallelResult.lastClaudeResponse) {
                    lastClaudeResponse = parallelResult.lastClaudeResponse;
                  }

                  // Check if any action in the parallel group failed
                  // User requirement: let successful terminals continue, so we don't break here
                  // We only set hasError if ALL actions failed
                  const groupResults = results.slice(-group.actions.length);
                  const allFailed = groupResults.every(r => !r.success);
                  if (allFailed) {
                    hasError = true;
                  }

                } else {
                  // SEQUENTIAL EXECUTION
                  for (const actionWithTarget of group.actions) {
                    try {
                      const actionResult = await executeSequentialAction(actionWithTarget, ws, session, message, results);

                      if (actionResult.lastClaudeResponse) {
                        lastClaudeResponse = actionResult.lastClaudeResponse;
                      }
                      if (actionResult.capturedScreenshot) {
                        capturedScreenshot = actionResult.capturedScreenshot;
                      }

                      // Check if this action failed
                      const lastResult = results[results.length - 1];
                      if (!lastResult.success) {
                        hasError = true;
                        break; // Stop sequential execution on first failure
                      }

                    } catch (error) {
                      const errorMsg = String(error);
                      serverLog(`[Voice] Action failed: ${errorMsg}`);
                      // Error already recorded in results by executeSequentialAction
                      hasError = true;
                      break; // Stop sequential execution on error
                    }
                  }
                }

              } catch (error) {
                const errorMsg = String(error);
                serverLog(`[Voice] Group ${groupIdx + 1} failed: ${errorMsg}`);
                results.push({
                  action: group.description,
                  success: false,
                  error: errorMsg
                });
                hasError = true;
                break; // Stop on group failure
              }
            }

            // Generate summary of what happened
            const successCount = results.filter(r => r.success).length;
            const failedAction = results.find(r => !r.success);

            // If a screenshot was captured, analyze it with the voice agent
            if (capturedScreenshot && !failedAction) {
              serverLog(`[Voice] Re-invoking voice agent to analyze captured screenshot`);

              // Build context about what was requested
              const analysisContext = `You just navigated to a different screen and captured a screenshot. The user originally asked: "${transcription}"\n\nNow describe what you see on the screen and respond to their request.`;

              // Re-invoke voice agent with screenshot for vision analysis
              // IMPORTANT: Set isSystemPrompt=true to skip semantic validation (this is AI-to-AI, not user voice)
              const screenshotAnalysis = await voiceService.processVoiceInput(
                analysisContext,
                session.projectId,
                {
                  projectName: message.appState?.projectName || projectMeta?.name,
                  screenCapture: capturedScreenshot,
                  appState: message.appState,
                  isSystemPrompt: true  // Skip semantic validation - this is system-generated, not user voice
                },
                session.voiceAgentModel
              );

              // Use the analysis response as the summary
              const analysisText = screenshotAnalysis.voiceResponse || screenshotAnalysis.content;
              const analysisTTS = await voiceService.textToSpeech(analysisText);
              ws.send(JSON.stringify({
                type: 'voice_terminal_speaking',
                terminalId: message.terminalId,
                responseText: analysisText,
                audioData: analysisTTS.toString('base64'),
                audioMimeType: 'audio/mp3',
                isComplete: true
              }));
              session.voiceLastTTSTime = Date.now();
              session.voiceIdleWaiting = true;
              return;
            }

            let summaryText: string;
            const failedActions = results.filter(r => !r.success);
            const successfulActions = results.filter(r => r.success);

            // Detect if we had parallel execution
            const hadParallelExecution = actionGroups.some(g => g.isParallel);

            if (failedActions.length > 0 && successfulActions.length > 0) {
              // PARTIAL SUCCESS (some terminals succeeded, others failed)
              const successTerminals = successfulActions
                .filter(r => r.terminalIndex !== undefined)
                .map(r => `Terminal ${r.terminalIndex! + 1}`)
                .join(', ');
              const failedTerminals = failedActions
                .filter(r => r.terminalIndex !== undefined)
                .map(r => `Terminal ${r.terminalIndex! + 1}`)
                .join(', ');

              if (successTerminals && failedTerminals) {
                summaryText = `Completed with partial success. ${successTerminals} finished successfully. ${failedTerminals} encountered errors.`;
              } else {
                summaryText = `I completed ${successCount} step${successCount !== 1 ? 's' : ''}, but encountered an error at: ${failedActions[0].action}. ${failedActions[0].error || 'The action failed.'}`;
              }

              // If we have Claude responses from successful terminals, present the first one
              const firstClaudeResponse = successfulActions.find(r => r.claudeResponse && r.claudeResponse.length > 20);
              if (firstClaudeResponse && firstClaudeResponse.claudeResponse) {
                const presentation = await voiceService.presentClaudeResponse(
                  firstClaudeResponse.claudeResponse,
                  session.projectId,
                  transcription
                );
                summaryText += ` ${presentation}`;
              }

            } else if (failedActions.length > 0) {
              // COMPLETE FAILURE (all actions failed)
              summaryText = `All ${failedActions.length} action${failedActions.length !== 1 ? 's' : ''} failed. ${failedActions[0].error || 'Unknown error occurred.'}`;

            } else if (lastClaudeResponse && lastClaudeResponse.length > 20) {
              // SUCCESS with Claude response
              const claudePresentation = await voiceService.presentClaudeResponse(
                lastClaudeResponse,
                session.projectId,
                transcription
              );
              summaryText = hadParallelExecution
                ? `All terminals completed successfully. ${claudePresentation}`
                : `Done. ${claudePresentation}`;

            } else {
              // SUCCESS without Claude response
              summaryText = hadParallelExecution
                ? `All ${results.length} terminals completed successfully.`
                : `All ${results.length} steps completed successfully.`;
            }

            // Speak final summary
            const summaryTTS = await voiceService.textToSpeech(summaryText);
            ws.send(JSON.stringify({
              type: 'voice_terminal_speaking',
              terminalId: message.terminalId,
              responseText: summaryText,
              audioData: summaryTTS.toString('base64'),
              audioMimeType: 'audio/mp3',
              isComplete: true
            }));
            session.voiceLastTTSTime = Date.now();
            session.voiceIdleWaiting = true;
            return;
          }

          // Handle CONVERSATIONAL - greetings, thanks, etc.
          if (agentResponse.type === 'conversational') {
            // Use voiceResponse if provided, otherwise use content
            const speechText = agentResponse.voiceResponse || agentResponse.content;
            const ttsAudioBuffer = await voiceService.textToSpeech(speechText);

            const audioResponse: StreamResponse & { isComplete?: boolean } = {
              type: 'voice_terminal_speaking',
              terminalId: message.terminalId,
              responseText: speechText,
              audioData: ttsAudioBuffer.toString('base64'),
              audioMimeType: 'audio/mp3',
              isComplete: true  // Final response - return to listening
            };
            ws.send(JSON.stringify(audioResponse));

            // Set TTS cooldown and enter idle state
            session.voiceLastTTSTime = Date.now();
            session.voiceIdleWaiting = true;
            return;
          }

          // Handle CONTROL - terminal/Claude Code control commands
          if (agentResponse.type === 'control') {
            const tmuxName = session.tmuxSessionName;

            // Check if this is a "complex" command that needs observation after execution
            // Complex commands: slash commands always need follow-up to report what happened
            const commands = agentResponse.content.split(',').map(c => c.trim()).filter(c => c);
            const hasSlashCommand = commands.some(cmd => cmd.startsWith('/'));
            const needsFollowUp = hasSlashCommand; // Always follow up on slash commands

            // Determine intro speech - use agent's voiceResponse or a default
            const introSpeech = agentResponse.voiceResponse || 'Let me do that for you.';

            // If this needs follow-up, speak FIRST before executing
            if (needsFollowUp) {
              serverLog(`[Voice] Speaking before executing command: "${introSpeech}"`);
              const interimTTS = await voiceService.textToSpeech(introSpeech);
              const interimResponse: StreamResponse & { isComplete?: boolean } = {
                type: 'voice_terminal_speaking',
                terminalId: message.terminalId,
                responseText: introSpeech,
                audioData: interimTTS.toString('base64'),
                audioMimeType: 'audio/mp3',
                isComplete: false  // NOT final - more coming after we observe the result
              };
              ws.send(JSON.stringify(interimResponse));

              // Tell mobile we're still working
              const workingResponse: StreamResponse = {
                type: 'voice_working',
                terminalId: message.terminalId,
                workingState: {
                  reason: 'claude_action',
                  followUpAction: 'wait_for_claude'
                }
              };
              ws.send(JSON.stringify(workingResponse));
            }

            // Helper function to execute a single control action
            async function executeControl(action: string): Promise<string> {
              let controlAction = action.trim();
              let repeatCount = 1;

              // Parse repeat count (e.g., "DOWN:3" means press down 3 times)
              if (controlAction.includes(':') && !controlAction.startsWith('/')) {
                const parts = controlAction.split(':');
                controlAction = parts[0];
                const count = parseInt(parts[1], 10);
                if (!isNaN(count)) {
                  repeatCount = Math.min(count, 10); // Cap at 10 to prevent abuse
                }
              }

              // Handle WAIT command
              if (controlAction === 'WAIT') {
                const waitSeconds = Math.min(repeatCount, 10); // Cap at 10 seconds
                await new Promise(r => setTimeout(r, waitSeconds * 1000));
                return `Waited ${waitSeconds} second${waitSeconds > 1 ? 's' : ''}.`;
              }

              // Handle slash commands directly (agent may send them as /command)
              if (controlAction.startsWith('/')) {
                await tmuxService.sendCommand(tmuxName, controlAction);
                await tmuxService.sendEnter(tmuxName);
                return `Sent ${controlAction}.`;
              }

              switch (controlAction) {
                case 'CTRL_C':
                  await tmuxService.sendControlKey(tmuxName, 'c');
                  return 'Interrupted.';
                case 'ESCAPE':
                  await tmuxService.sendSpecialKey(tmuxName, 'Escape');
                  return 'Escaped.';
                case 'ESCAPE_ESCAPE':
                  await tmuxService.sendSpecialKey(tmuxName, 'Escape');
                  await new Promise(resolve => setTimeout(resolve, 100));
                  await tmuxService.sendSpecialKey(tmuxName, 'Escape');
                  return 'Opening rewind menu.';
                case 'YES':
                  await tmuxService.sendCommand(tmuxName, 'y');
                  await tmuxService.sendEnter(tmuxName);
                  return 'Confirmed.';
                case 'NO':
                  await tmuxService.sendCommand(tmuxName, 'n');
                  await tmuxService.sendEnter(tmuxName);
                  return 'Declined.';
                case 'SLASH_CLEAR':
                  await tmuxService.sendCommand(tmuxName, '/clear');
                  await tmuxService.sendEnter(tmuxName);
                  return 'Cleared.';
                case 'SLASH_HELP':
                  await tmuxService.sendCommand(tmuxName, '/help');
                  await tmuxService.sendEnter(tmuxName);
                  return 'Showing help.';
                case 'RESTART':
                  await tmuxService.restartClaude(tmuxName);
                  return 'Restarting.';
                case 'UP':
                case 'ARROW_UP':
                  for (let i = 0; i < repeatCount; i++) {
                    await tmuxService.sendSpecialKey(tmuxName, 'Up');
                    if (repeatCount > 1) await new Promise(r => setTimeout(r, 50));
                  }
                  return repeatCount > 1 ? `Up ${repeatCount}x.` : 'Up.';
                case 'DOWN':
                case 'ARROW_DOWN':
                  for (let i = 0; i < repeatCount; i++) {
                    await tmuxService.sendSpecialKey(tmuxName, 'Down');
                    if (repeatCount > 1) await new Promise(r => setTimeout(r, 50));
                  }
                  return repeatCount > 1 ? `Down ${repeatCount}x.` : 'Down.';
                case 'LEFT':
                case 'ARROW_LEFT':
                  for (let i = 0; i < repeatCount; i++) {
                    await tmuxService.sendSpecialKey(tmuxName, 'Left');
                    if (repeatCount > 1) await new Promise(r => setTimeout(r, 50));
                  }
                  return repeatCount > 1 ? `Left ${repeatCount}x.` : 'Left.';
                case 'RIGHT':
                case 'ARROW_RIGHT':
                  for (let i = 0; i < repeatCount; i++) {
                    await tmuxService.sendSpecialKey(tmuxName, 'Right');
                    if (repeatCount > 1) await new Promise(r => setTimeout(r, 50));
                  }
                  return repeatCount > 1 ? `Right ${repeatCount}x.` : 'Right.';
                case 'ENTER':
                  await tmuxService.sendEnter(tmuxName);
                  return 'Selected.';
                case 'TAB':
                  for (let i = 0; i < repeatCount; i++) {
                    await tmuxService.sendSpecialKey(tmuxName, 'Tab');
                    if (repeatCount > 1) await new Promise(r => setTimeout(r, 50));
                  }
                  return repeatCount > 1 ? `Tab ${repeatCount}x.` : 'Tab.';
                default:
                  return `Unknown: ${controlAction}`;
              }
            }

            // Execute all commands
            const results: string[] = [];

            for (const cmd of commands) {
              const result = await executeControl(cmd);
              results.push(result);
            }

            // If this needed follow-up (slash command with voiceResponse), observe and report
            if (needsFollowUp) {
              serverLog(`[Voice] Command executed, waiting for terminal output to stabilize...`);

              // Wait for terminal output to stabilize (give Claude Code time to respond)
              await new Promise(r => setTimeout(r, 1500));

              // Capture the new terminal output
              const terminalOutput = await tmuxService.captureOutput(tmuxName, 50);

              // Get agent to analyze and respond naturally
              serverLog(`[Voice] Getting agent follow-up response...`);
              const followUpResponse = await voiceService.processVoiceInput(
                '', // No new user audio
                message.terminalId,
                {
                  terminalContent: terminalOutput,
                  appState: message.appState,
                  systemNote: `[SYSTEM: The command was executed. Here's the current terminal output. Describe what you see and offer to help the user with next steps. Be concise.]`
                },
                session.voiceAgentModel  // Pass selected model
              );

              // Speak the follow-up
              const followUpText = followUpResponse.voiceResponse || followUpResponse.content;
              const followUpTTS = await voiceService.textToSpeech(followUpText);
              const followUpAudio: StreamResponse & { isComplete?: boolean } = {
                type: 'voice_terminal_speaking',
                terminalId: message.terminalId,
                responseText: followUpText,
                audioData: followUpTTS.toString('base64'),
                audioMimeType: 'audio/mp3',
                isComplete: true  // NOW we're done - return to listening
              };
              ws.send(JSON.stringify(followUpAudio));

              session.voiceLastTTSTime = Date.now();
              session.voiceIdleWaiting = true;
              return;
            }

            // For simple commands without follow-up, use voiceResponse if provided, otherwise generate from results
            const responseText = agentResponse.voiceResponse
              || (results.length > 1
                ? `Done: ${results.join(' ')}`
                : results[0] || 'Done.');

            // Generate voice response for control action
            const ttsAudio = await voiceService.textToSpeech(responseText);
            const audioResponse: StreamResponse & { isComplete?: boolean } = {
              type: 'voice_terminal_speaking',
              terminalId: message.terminalId,
              responseText,
              audioData: ttsAudio.toString('base64'),
              audioMimeType: 'audio/mp3',
              isComplete: true  // Final response - return to listening
            };
            ws.send(JSON.stringify(audioResponse));

            // Set TTS cooldown and enter idle state
            session.voiceLastTTSTime = Date.now();
            session.voiceIdleWaiting = true;
            return;
          }

          // Handle APP_CONTROL - control the mobile app UI
          if (agentResponse.type === 'app_control' && agentResponse.appAction) {
            // Use voiceResponse if provided, otherwise use content
            const speechText = agentResponse.voiceResponse || agentResponse.content;

            // Send app control command to mobile app
            const appControlResponse: StreamResponse = {
              type: 'voice_app_control',
              terminalId: message.terminalId,
              responseText: speechText,
              appControl: agentResponse.appAction
            };
            ws.send(JSON.stringify(appControlResponse));

            // Also send voice response
            const ttsAudio = await voiceService.textToSpeech(speechText);
            const audioResponse: StreamResponse & { isComplete?: boolean } = {
              type: 'voice_terminal_speaking',
              terminalId: message.terminalId,
              responseText: speechText,
              audioData: ttsAudio.toString('base64'),
              audioMimeType: 'audio/mp3',
              isComplete: true  // Final response - return to listening
            };
            ws.send(JSON.stringify(audioResponse));

            // Set TTS cooldown
            session.voiceLastTTSTime = Date.now();
            session.voiceIdleWaiting = true;
            return;
          }

          // Handle WORKING - agent is gathering info/waiting, don't yield floor
          if (agentResponse.type === 'working' && agentResponse.workingState) {
            // Increment loop counter to prevent infinite "one moment" loops
            session.voiceWorkingLoopCount++;
            const MAX_WORKING_LOOPS = 2;  // Max consecutive WORKING responses before forcing completion

            // If we've hit the loop limit, convert WORKING to CONVERSATIONAL and report what we have
            if (session.voiceWorkingLoopCount > MAX_WORKING_LOOPS) {
              serverLog(`[Voice] WORKING loop limit reached (${session.voiceWorkingLoopCount}), forcing completion`);
              session.voiceWorkingLoopCount = 0;  // Reset for next time

              // Analyze the terminal content we have and give a response
              const fallbackText = "I've checked the terminal. Based on what I can see, please let me know what specific information you'd like me to focus on.";
              const ttsAudio = await voiceService.textToSpeech(fallbackText);
              const audioResponse: StreamResponse & { isComplete?: boolean } = {
                type: 'voice_terminal_speaking',
                terminalId: message.terminalId,
                responseText: fallbackText,
                audioData: ttsAudio.toString('base64'),
                audioMimeType: 'audio/mp3',
                isComplete: true  // Force completion - return to listening
              };
              ws.send(JSON.stringify(audioResponse));
              session.voiceLastTTSTime = Date.now();
              session.voiceIdleWaiting = true;
              return;
            }

            // Send TTS for the status message (e.g., "One moment, let me check that")
            const ttsAudio = await voiceService.textToSpeech(agentResponse.content);
            const audioResponse: StreamResponse & { isComplete?: boolean } = {
              type: 'voice_terminal_speaking',
              terminalId: message.terminalId,
              responseText: agentResponse.content,
              audioData: ttsAudio.toString('base64'),
              audioMimeType: 'audio/mp3',
              isComplete: false  // NOT final - more processing coming
            };
            ws.send(JSON.stringify(audioResponse));

            // Send working state to client - this triggers the working chime and follow-up action
            serverLog(`[Voice] Sending working state: reason=${agentResponse.workingState?.reason}, followUpAction=${agentResponse.workingState?.followUpAction}`);
            const workingResponse: StreamResponse = {
              type: 'voice_working',
              terminalId: message.terminalId,
              workingState: agentResponse.workingState
            };
            ws.send(JSON.stringify(workingResponse));

            // Don't set idle state - agent is still in control
            session.voiceLastTTSTime = Date.now();
            session.voiceIdleWaiting = false;
            return;
          }

          // Handle BACKGROUND_TASK - send to Claude Code and continue conversation
          if (agentResponse.type === 'background_task' && agentResponse.backgroundTask) {
            serverLog(`[Voice] Starting background task: "${agentResponse.backgroundTask.taskDescription}"`);

            // Create a background task entry
            const taskId = `task-${Date.now().toString(36)}`;
            const task: BackgroundTask = {
              id: taskId,
              description: agentResponse.backgroundTask.taskDescription,
              prompt: agentResponse.backgroundTask.prompt,
              startedAt: Date.now(),
              status: 'running'
            };
            session.backgroundTasks.push(task);

            // Notify mobile app that a background task started
            const taskStartedResponse: StreamResponse = {
              type: 'voice_background_task_started',
              terminalId: message.terminalId,
              backgroundTaskId: taskId,
              backgroundTaskDescription: task.description
            };
            ws.send(JSON.stringify(taskStartedResponse));

            // Speak the conversational response to user (this is NOT final - we continue listening)
            const ttsAudio = await voiceService.textToSpeech(agentResponse.content);
            const audioResponse: StreamResponse & { isComplete?: boolean } = {
              type: 'voice_terminal_speaking',
              terminalId: message.terminalId,
              responseText: agentResponse.content,
              audioData: ttsAudio.toString('base64'),
              audioMimeType: 'audio/mp3',
              isComplete: true  // Return to listening for more conversation
            };
            ws.send(JSON.stringify(audioResponse));
            session.voiceLastTTSTime = Date.now();
            session.voiceIdleWaiting = true;  // User can continue talking

            // Now start the Claude Code task in the background (async, don't await)
            (async () => {
              try {
                // Capture output before sending command
                const outputBeforeCommand = await tmuxService.captureOutput(session.tmuxSessionName, 100);

                // Send the prompt to Claude Code
                await tmuxService.sendCommand(session.tmuxSessionName, task.prompt);
                await tmuxService.sendEnter(session.tmuxSessionName);

                // Wait for Claude Code to finish (via hooks)
                const claudeState = await tmuxService.waitForClaudeReadyWithHooks(session.tmuxSessionName, {
                  timeoutMs: 300000,  // 5 minutes for background tasks
                  pollIntervalMs: 500,
                  previousOutput: outputBeforeCommand
                });

                // Extract the response
                const claudeResponse = tmuxService.extractClaudeResponse(claudeState.rawOutput);

                // Update task status
                task.status = 'completed';
                task.result = claudeResponse;

                // Summarize for notification
                const summary = claudeResponse && claudeResponse.length > 100
                  ? await voiceService.summarizeForVoice(claudeResponse, message.terminalId, 'terse')
                  : 'The task is done.';

                serverLog(`[Voice] Background task completed: "${task.description}"`);

                // If user is still in voice mode, notify them
                if (session.voiceMode && session.ws) {
                  // Send completion notification
                  const completionResponse: StreamResponse = {
                    type: 'voice_background_task_complete',
                    terminalId: message.terminalId,
                    backgroundTaskId: taskId,
                    backgroundTaskDescription: task.description,
                    backgroundTaskResult: summary
                  };
                  try {
                    session.ws.send(JSON.stringify(completionResponse));
                  } catch (e) {
                    serverLog(`[Voice] Failed to send background task completion: ${e}`);
                  }
                }

                // Remove from active tasks
                session.backgroundTasks = session.backgroundTasks.filter(t => t.id !== taskId);
              } catch (err) {
                serverLog(`[Voice] Background task failed: ${err}`);
                task.status = 'failed';
                session.backgroundTasks = session.backgroundTasks.filter(t => t.id !== taskId);
              }
            })();

            return;
          }

          // PROMPT type - send natural language to Claude Code
          // Clear idle state - user is actively commanding
          session.voiceIdleWaiting = false;
          const promptText = agentResponse.content;

          // Auto-navigate to terminal if needed (unless we're already on terminal tab)
          // This fixes the issue where prompts are sent without navigating back to terminal
          const currentTab = message.appState?.currentTab;
          if (currentTab && currentTab !== 'terminal' && currentTab !== 'chat') {
            serverLog(`[Voice] Auto-navigating to terminal before sending prompt (currently on ${currentTab})`);
            ws.send(JSON.stringify({
              type: 'voice_app_control',
              terminalId: message.terminalId,
              appControl: { action: 'navigate', target: 'terminal' }
            }));
            await new Promise(resolve => setTimeout(resolve, 800));
          }

          // If there's a voiceResponse, speak it FIRST before sending the command
          // This lets the user know what's happening ("Let me check that for you")
          if (agentResponse.voiceResponse) {
            const ttsAudioBuffer = await voiceService.textToSpeech(agentResponse.voiceResponse);
            const audioResponse: StreamResponse & { isComplete?: boolean } = {
              type: 'voice_terminal_speaking',
              terminalId: message.terminalId,
              responseText: agentResponse.voiceResponse,
              audioData: ttsAudioBuffer.toString('base64'),
              audioMimeType: 'audio/mp3',
              isComplete: false  // NOT final - Claude will process and we'll send final response after
            };
            ws.send(JSON.stringify(audioResponse));

            // Also tell mobile app we're still working (backup signal)
            const workingResponse: StreamResponse = {
              type: 'voice_working',
              terminalId: message.terminalId,
              workingState: {
                reason: 'claude_action',
                followUpAction: 'wait_for_claude'
              }
            };
            ws.send(JSON.stringify(workingResponse));
          }

          // Send progress to client
          const progressResponse: StreamResponse = {
            type: 'voice_progress',
            terminalId: message.terminalId,
            responseText: `Sending to Claude: "${promptText.substring(0, 50)}${promptText.length > 50 ? '...' : ''}"`
          };
          ws.send(JSON.stringify(progressResponse));

          // Set up to capture Claude's response
          session.voiceAwaitingResponse = true;

          // Capture terminal output BEFORE sending command so we can filter it out later
          const outputBeforeCommand = await tmuxService.captureOutput(session.tmuxSessionName, 100);

          // Send the translated command to Claude Code via tmux WITH VERIFICATION
          // Handles race conditions where Enter key might be dropped
          await tmuxService.sendPromptWithVerification(session.tmuxSessionName, promptText);

          // Wait for Claude Code using hook-based state detection
          // Pass previousOutput so we can filter out old content from the response
          const claudeState = await tmuxService.waitForClaudeReadyWithHooks(session.tmuxSessionName, {
            timeoutMs: 180000,  // 3 minutes for long tasks
            pollIntervalMs: 300,
            previousOutput: outputBeforeCommand  // Filter out old content
          });

          session.voiceAwaitingResponse = false;

          // Extract the response from the raw output
          const claudeResponse = tmuxService.extractClaudeResponse(claudeState.rawOutput);

          if (claudeState.isWaitingConfirm) {
            // Claude is asking for confirmation - need to tell user
            const confirmText = 'Claude is asking for confirmation. Please say yes or no.';
            const ttsAudio = await voiceService.textToSpeech(confirmText);
            const confirmResponse: StreamResponse & { isComplete?: boolean } = {
              type: 'voice_terminal_speaking',
              terminalId: message.terminalId,
              responseText: confirmText,
              audioData: ttsAudio.toString('base64'),
              audioMimeType: 'audio/mp3',
              isComplete: true  // Final response - return to listening
            };
            ws.send(JSON.stringify(confirmResponse));
            session.voiceLastTTSTime = Date.now();
            session.voiceIdleWaiting = true;
          } else if (claudeResponse && claudeResponse.length > 50) {
            // Generate voice response (isComplete=true by default)
            // Pass the user's original transcription for contextual attribution
            await processTerminalVoiceResponse(ws, message.terminalId, claudeResponse, session, true, transcription);

            // Enter idle state - wait for user to speak next
            session.voiceIdleWaiting = true;
          } else {
            // Provide feedback that task completed
            const doneText = 'Done. What would you like me to do next?';
            const ttsAudio = await voiceService.textToSpeech(doneText);
            const doneResponse: StreamResponse & { isComplete?: boolean } = {
              type: 'voice_terminal_speaking',
              terminalId: message.terminalId,
              responseText: doneText,
              audioData: ttsAudio.toString('base64'),
              audioMimeType: 'audio/mp3',
              isComplete: true  // Final response - return to listening
            };
            ws.send(JSON.stringify(doneResponse));
            session.voiceLastTTSTime = Date.now();
            session.voiceIdleWaiting = true;
          }

        } catch (err) {
          serverError('[Voice-Terminal] Processing error:', err);
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

      // Preview server management
      if (message.type === 'preview_start' && message.projectId) {
        try {
          // Create error callback to forward preview errors to client
          const onPreviewError = (error: string, errorType: 'error' | 'warn' | 'info') => {
            const errorResponse: StreamResponse = {
              type: 'preview_error',
              projectId: message.projectId,
              previewError: error,
              previewErrorType: errorType
            };
            try {
              ws.send(JSON.stringify(errorResponse));
            } catch {
              // WebSocket may be closed
            }
          };

          const { url, port } = await startPreviewServer(message.projectId, onPreviewError);
          const response: StreamResponse = {
            type: 'preview_started',
            projectId: message.projectId,
            previewUrl: url,
            previewPort: port
          };
          ws.send(JSON.stringify(response));
        } catch (err) {
          const response: StreamResponse = {
            type: 'error',
            error: `Failed to start preview: ${err instanceof Error ? err.message : 'Unknown error'}`
          };
          ws.send(JSON.stringify(response));
        }
        return;
      }

      if (message.type === 'preview_stop' && message.projectId) {
        const stopped = stopPreviewServer(message.projectId);
        const response: StreamResponse = {
          type: 'preview_stopped',
          projectId: message.projectId,
          stopped
        };
        ws.send(JSON.stringify(response));
        return;
      }

      if (message.type === 'preview_status' && message.projectId) {
        const status = getPreviewStatus(message.projectId);
        const response: StreamResponse = {
          type: 'preview_status',
          projectId: message.projectId,
          previewRunning: status.running,
          previewUrl: status.url,
          previewPort: status.port
        };
        ws.send(JSON.stringify(response));
        return;
      }

      // Voice session management

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

  ws.on('close', async () => {
    serverLog('❌ Lora iOS app disconnected');
    // Kill ALL terminal sessions including tmux sessions when app disconnects
    // This ensures no orphaned terminals run in the background
    for (const [id, session] of terminals) {
      serverLog(`🖥️  Cleaning up terminal ${id} and tmux session ${session.tmuxSessionName}`);
      terminalLog(id, 'CLOSED_ON_DISCONNECT');

      // Kill the PTY
      if (session.pty) {
        session.pty.kill();
      }

      // Kill the tmux session
      try {
        await tmuxService.killSession(session.tmuxSessionName);
        // Mark session as inactive in registry
        markSessionInactive(session.projectId, session.tmuxSessionName);
      } catch (err) {
        serverError(`Failed to kill tmux session ${session.tmuxSessionName}:`, err);
      }
    }
    terminals.clear();
    serverLog('🧹 All terminal sessions cleaned up');
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
