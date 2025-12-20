/**
 * Tmux Service for Lora Bridge Server
 *
 * Provides tmux-based terminal session management for reliable
 * Claude Code interaction with:
 * - Session persistence across disconnects
 * - Reliable command sending with separate Enter key
 * - Clean output capture via capture-pane
 * - Control key support (Ctrl+C, Ctrl+D, etc.)
 * - Sandbox isolation per project
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

// Session prefix for all Lora tmux sessions
const SESSION_PREFIX = 'lora-';

/**
 * Tmux session information
 */
export interface TmuxSession {
  id: string;
  sessionName: string;
  projectId: string;
  projectPath: string;
  isClaudeRunning: boolean;
  createdAt: number;
  lastActivity: number;
}

/**
 * Session registry for tracking active sessions
 */
const sessionRegistry: Map<string, TmuxSession> = new Map();

/**
 * Escape shell arguments safely
 */
function shellEscape(str: string): string {
  return `'${str.replace(/'/g, "'\\''")}'`;
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Set up sandbox configuration for a project directory.
 * Creates .claude/settings.local.json to restrict Claude Code's access
 * to only the project directory.
 */
export function setupProjectSandbox(projectPath: string): void {
  const claudeDir = path.join(projectPath, '.claude');
  const settingsPath = path.join(claudeDir, 'settings.local.json');

  // Create .claude directory if it doesn't exist
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
    console.log(`[Sandbox] Created .claude directory in ${projectPath}`);
  }

  // Create/update settings.local.json with sandbox restrictions
  const settings = {
    // Restrict file access to only this project directory
    permissions: {
      allow: [
        projectPath,  // Allow access to project directory
      ],
      deny: [
        path.dirname(projectPath),  // Deny access to parent (projects folder)
        path.join(path.dirname(projectPath), '*'),  // Deny access to sibling projects
      ]
    },
    // Additional safety settings
    sandbox: {
      enabled: true,
      rootDirectory: projectPath,
    }
  };

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  console.log(`[Sandbox] Created settings.local.json for project sandbox`);

  // Also create a CLAUDE.md in the project to reinforce sandbox rules
  const claudeMdPath = path.join(projectPath, 'CLAUDE.md');
  if (!fs.existsSync(claudeMdPath)) {
    const claudeMd = `# Project Sandbox Rules

This project is running in a sandboxed environment.

## Important Restrictions

- You can ONLY access files within this project directory: \`${projectPath}\`
- You CANNOT access parent directories or other projects
- All file operations must be within this project folder
- Do not attempt to navigate outside this directory using \`cd ..\` or absolute paths

## Project Structure

This is an isolated Expo/React Native project. Focus on building and modifying files within this directory only.
`;
    fs.writeFileSync(claudeMdPath, claudeMd);
    console.log(`[Sandbox] Created CLAUDE.md with sandbox instructions`);
  }
}

/**
 * Check if tmux is available on the system
 */
export async function isTmuxAvailable(): Promise<boolean> {
  try {
    await execAsync('which tmux');
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a tmux session exists
 */
export async function sessionExists(sessionName: string): Promise<boolean> {
  try {
    await execAsync(`tmux has-session -t ${shellEscape(sessionName)} 2>/dev/null`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a new tmux session for a project
 */
export async function createSession(
  projectId: string,
  projectPath: string,
  options?: { autoStartClaude?: boolean }
): Promise<TmuxSession> {
  const sessionName = `${SESSION_PREFIX}${projectId}`;

  // Check if session already exists
  if (await sessionExists(sessionName)) {
    console.log(`[Tmux] Session ${sessionName} already exists, reusing`);

    // Check registry first
    const existingSession = sessionRegistry.get(projectId);
    if (existingSession) {
      existingSession.lastActivity = Date.now();
      return existingSession;
    }

    // Session exists in tmux but not in registry (server restart case)
    // Create registry entry for existing session
    console.log(`[Tmux] Registering existing session ${sessionName}`);
    const session: TmuxSession = {
      id: `tmux-${Date.now().toString(36)}`,
      sessionName,
      projectId,
      projectPath,
      isClaudeRunning: true, // Assume Claude is running if session exists
      createdAt: Date.now(),
      lastActivity: Date.now()
    };
    sessionRegistry.set(projectId, session);
    return session;
  }

  // Set up sandbox configuration for the project
  setupProjectSandbox(projectPath);

  // Create new detached session
  console.log(`[Tmux] Creating new session ${sessionName} in ${projectPath}`);
  await execAsync(
    `tmux new-session -d -s ${shellEscape(sessionName)} -c ${shellEscape(projectPath)}`
  );

  // Set up session info
  const session: TmuxSession = {
    id: `tmux-${Date.now().toString(36)}`,
    sessionName,
    projectId,
    projectPath,
    isClaudeRunning: false,
    createdAt: Date.now(),
    lastActivity: Date.now()
  };

  sessionRegistry.set(projectId, session);

  // Auto-start Claude Code if requested
  if (options?.autoStartClaude !== false) {
    await sleep(500); // Wait for shell to initialize
    console.log(`[Tmux] Auto-starting Claude Code in ${sessionName}`);
    await sendCommand(sessionName, 'claude --dangerously-skip-permissions');
    await sendEnter(sessionName);
    session.isClaudeRunning = true;
  }

  return session;
}

/**
 * Kill a tmux session
 */
export async function killSession(sessionName: string): Promise<void> {
  try {
    console.log(`[Tmux] Killing session ${sessionName}`);
    await execAsync(`tmux kill-session -t ${shellEscape(sessionName)}`);

    // Remove from registry
    for (const [projectId, session] of sessionRegistry) {
      if (session.sessionName === sessionName) {
        sessionRegistry.delete(projectId);
        break;
      }
    }
  } catch (error) {
    console.error(`[Tmux] Failed to kill session ${sessionName}:`, error);
  }
}

/**
 * Send text command to a session (without Enter)
 */
export async function sendCommand(sessionName: string, command: string): Promise<void> {
  console.log(`[Tmux] Sending command to ${sessionName}: "${command.substring(0, 50)}..."`);

  // Use -l flag for literal text (handles special characters better)
  await execAsync(
    `tmux send-keys -t ${shellEscape(sessionName)}:0 -l ${shellEscape(command)}`
  );

  // Update activity
  updateSessionActivity(sessionName);
}

/**
 * Send Enter key to a session
 */
export async function sendEnter(sessionName: string): Promise<void> {
  console.log(`[Tmux] Sending Enter to ${sessionName}`);
  await execAsync(`tmux send-keys -t ${shellEscape(sessionName)}:0 Enter`);
  updateSessionActivity(sessionName);
}

/**
 * Send a control key to a session
 */
export async function sendControlKey(
  sessionName: string,
  key: 'c' | 'd' | 'z' | 'l'
): Promise<void> {
  const keyMap: Record<string, string> = {
    c: 'C-c',   // Ctrl+C (interrupt)
    d: 'C-d',   // Ctrl+D (EOF)
    z: 'C-z',   // Ctrl+Z (suspend)
    l: 'C-l'    // Ctrl+L (clear)
  };

  const tmuxKey = keyMap[key];
  if (!tmuxKey) {
    throw new Error(`Unknown control key: ${key}`);
  }

  console.log(`[Tmux] Sending ${tmuxKey} to ${sessionName}`);
  await execAsync(`tmux send-keys -t ${shellEscape(sessionName)}:0 ${tmuxKey}`);
  updateSessionActivity(sessionName);
}

/**
 * Send special keys to a session
 */
export async function sendSpecialKey(
  sessionName: string,
  key: 'Up' | 'Down' | 'Left' | 'Right' | 'Escape' | 'Tab' | 'BSpace'
): Promise<void> {
  console.log(`[Tmux] Sending ${key} to ${sessionName}`);
  await execAsync(`tmux send-keys -t ${shellEscape(sessionName)}:0 ${key}`);
  updateSessionActivity(sessionName);
}

/**
 * Capture pane output
 */
export async function captureOutput(
  sessionName: string,
  lines?: number
): Promise<string> {
  try {
    let cmd = `tmux capture-pane -t ${shellEscape(sessionName)}:0 -p`;
    if (lines) {
      cmd = `tmux capture-pane -t ${shellEscape(sessionName)}:0 -S -${lines} -p`;
    }

    const { stdout } = await execAsync(cmd);
    return stdout;
  } catch (error) {
    console.error(`[Tmux] Failed to capture output from ${sessionName}:`, error);
    return '';
  }
}

/**
 * Get session info
 */
export async function getSessionInfo(projectId: string): Promise<TmuxSession | null> {
  return sessionRegistry.get(projectId) || null;
}

/**
 * Get session by session name
 */
export async function getSessionByName(sessionName: string): Promise<TmuxSession | null> {
  for (const session of sessionRegistry.values()) {
    if (session.sessionName === sessionName) {
      return session;
    }
  }
  return null;
}

/**
 * List all active Lora sessions
 */
export async function listSessions(): Promise<TmuxSession[]> {
  try {
    // Get all tmux sessions
    const { stdout } = await execAsync('tmux list-sessions -F "#{session_name}" 2>/dev/null');
    const allSessions = stdout.trim().split('\n').filter(Boolean);

    // Filter to Lora sessions
    const loraSessions = allSessions.filter(name => name.startsWith(SESSION_PREFIX));

    // Sync registry with actual tmux sessions
    const activeSessions: TmuxSession[] = [];
    for (const sessionName of loraSessions) {
      const projectId = sessionName.replace(SESSION_PREFIX, '');
      let session = sessionRegistry.get(projectId);

      if (!session) {
        // Session exists in tmux but not in registry (e.g., after server restart)
        session = {
          id: `tmux-${Date.now().toString(36)}`,
          sessionName,
          projectId,
          projectPath: await getSessionDirectory(sessionName),
          isClaudeRunning: true, // Assume Claude is running
          createdAt: Date.now(),
          lastActivity: Date.now()
        };
        sessionRegistry.set(projectId, session);
      }

      activeSessions.push(session);
    }

    return activeSessions;
  } catch {
    return [];
  }
}

/**
 * Get the current directory of a session
 */
async function getSessionDirectory(sessionName: string): Promise<string> {
  try {
    const { stdout } = await execAsync(
      `tmux display-message -t ${shellEscape(sessionName)}:0 -p '#{pane_current_path}'`
    );
    return stdout.trim();
  } catch {
    return '';
  }
}

/**
 * Update session activity timestamp
 */
function updateSessionActivity(sessionName: string): void {
  for (const session of sessionRegistry.values()) {
    if (session.sessionName === sessionName) {
      session.lastActivity = Date.now();
      break;
    }
  }
}

/**
 * Claude Code state detection
 */
export interface ClaudeCodeState {
  isReady: boolean;           // Ready for input (shows prompt)
  isProcessing: boolean;      // Actively working (spinners, etc.)
  isWaitingConfirm: boolean;  // Waiting for y/n confirmation
  hasInputPrompt: boolean;    // > prompt visible at end
  rawOutput: string;          // Full captured output
}

/**
 * Analyze Claude Code output to determine state
 */
export function analyzeClaudeCodeState(output: string): ClaudeCodeState {
  const lines = output.split('\n');
  const lastLines = lines.slice(-15).join('\n'); // Focus on recent output
  const lastLine = lines[lines.length - 1] || '';
  const secondLastLine = lines[lines.length - 2] || '';

  // Check for active processing indicators
  const processingPatterns = [
    /[·✻✽✿✸⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/,  // Spinner characters
    /\bThinking\b/i,
    /\bWorking\b/i,
    /\bProcessing\b/i,
    /\bAnalyzing\b/i,
    /\bReading\b/i,
    /\bWriting\b/i,
    /\bSearching\b/i,
    /\bRunning\b/i,
    /esc to interrupt/i,
    /\.\.\.\s*$/,  // Trailing ellipsis
  ];

  const isProcessing = processingPatterns.some(pattern => pattern.test(lastLines));

  // Check for confirmation prompts
  const confirmPatterns = [
    /\[y\/n\]/i,
    /\[Y\/n\]/i,
    /\[yes\/no\]/i,
    /Do you want to proceed/i,
    /Would you like to/i,
    /Continue\?/i,
    /Proceed\?/i,
    /\(yes\/no\)/i,
  ];

  const isWaitingConfirm = confirmPatterns.some(pattern => pattern.test(lastLines));

  // Check for input prompt at end
  // Claude Code shows ">" on a line by itself or with minimal content when ready
  const promptPatterns = [
    /^>\s*$/,                    // Just > on a line
    /^>\s+$/,                    // > with trailing spaces
    /^\s*>\s*$/,                 // > with leading/trailing whitespace
    /What would you like/i,
    /How can I help/i,
    /What can I help/i,
  ];

  const hasInputPrompt = promptPatterns.some(pattern =>
    pattern.test(lastLine) || pattern.test(secondLastLine)
  );

  // Ready when: has prompt AND not processing
  const isReady = (hasInputPrompt || isWaitingConfirm) && !isProcessing;

  return {
    isReady,
    isProcessing,
    isWaitingConfirm,
    hasInputPrompt,
    rawOutput: output
  };
}

/**
 * Wait for Claude Code response by polling output
 * Uses smart state detection to know when Claude is truly done
 */
export async function waitForResponse(
  sessionName: string,
  options?: {
    timeoutMs?: number;
    stabilityMs?: number;
    pollIntervalMs?: number;
    minResponseTime?: number;  // Minimum time to wait before checking readiness
  }
): Promise<string> {
  const {
    timeoutMs = 120000,        // 2 minutes for long tasks
    stabilityMs = 1500,        // Output stable for 1.5s
    pollIntervalMs = 300,      // Poll every 300ms
    minResponseTime = 1000     // Wait at least 1s before checking readiness
  } = options || {};

  const startTime = Date.now();
  let lastOutput = '';
  let stableTime = 0;
  let outputBeforeCommand = '';
  let firstOutputTime = 0;
  let hasSeenNewOutput = false;

  // Capture initial state before the command runs
  outputBeforeCommand = await captureOutput(sessionName, 100);

  console.log(`[Tmux] Waiting for Claude Code response from ${sessionName}...`);
  console.log(`[Tmux] Config: timeout=${timeoutMs}ms, stability=${stabilityMs}ms, poll=${pollIntervalMs}ms`);

  while (Date.now() - startTime < timeoutMs) {
    const currentOutput = await captureOutput(sessionName, 100);
    const state = analyzeClaudeCodeState(currentOutput);

    // Track when we first see new output
    if (currentOutput !== outputBeforeCommand && !hasSeenNewOutput) {
      hasSeenNewOutput = true;
      firstOutputTime = Date.now();
      console.log(`[Tmux] New output detected after ${Date.now() - startTime}ms`);
    }

    // Don't check readiness until min response time has passed
    const timeSinceFirstOutput = firstOutputTime > 0 ? Date.now() - firstOutputTime : 0;

    // Debug state periodically
    if (Math.floor((Date.now() - startTime) / 2000) !== Math.floor((Date.now() - startTime - pollIntervalMs) / 2000)) {
      console.log(`[Tmux] State check: ready=${state.isReady}, processing=${state.isProcessing}, prompt=${state.hasInputPrompt}, stable=${stableTime}ms`);
    }

    // If Claude Code is ready (has prompt and not processing)
    if (state.isReady && timeSinceFirstOutput >= minResponseTime) {
      // Still check for stability to avoid false positives
      if (currentOutput === lastOutput) {
        stableTime += pollIntervalMs;
        if (stableTime >= stabilityMs) {
          console.log(`[Tmux] Claude Code is ready (prompt detected, stable for ${stabilityMs}ms)`);
          return extractClaudeResponse(currentOutput);
        }
      } else {
        stableTime = 0;
        lastOutput = currentOutput;
      }
    } else if (state.isProcessing) {
      // Reset stability timer if still processing
      stableTime = 0;
      lastOutput = currentOutput;
    } else {
      // Not explicitly ready or processing - use stability check
      if (currentOutput === lastOutput) {
        stableTime += pollIntervalMs;
        // For non-processing state, require longer stability
        const requiredStability = state.hasInputPrompt ? stabilityMs : stabilityMs * 2;
        if (stableTime >= requiredStability && timeSinceFirstOutput >= minResponseTime) {
          console.log(`[Tmux] Output stable for ${stableTime}ms, extracting response`);
          return extractClaudeResponse(currentOutput);
        }
      } else {
        stableTime = 0;
        lastOutput = currentOutput;
      }
    }

    await sleep(pollIntervalMs);
  }

  console.log(`[Tmux] Timeout waiting for response after ${timeoutMs}ms`);
  return extractClaudeResponse(lastOutput);
}

/**
 * Wait specifically for Claude Code to be ready for input
 * More aggressive timeout and prompt detection for voice mode
 */
export async function waitForClaudeReady(
  sessionName: string,
  options?: {
    timeoutMs?: number;
    pollIntervalMs?: number;
  }
): Promise<ClaudeCodeState> {
  const {
    timeoutMs = 180000,   // 3 minutes max for long tasks
    pollIntervalMs = 500
  } = options || {};

  const startTime = Date.now();
  let lastState: ClaudeCodeState | null = null;
  let readyCount = 0;
  const READY_CONFIRMATIONS = 3; // Must be ready for 3 consecutive checks

  console.log(`[Tmux] Waiting for Claude Code to be ready in ${sessionName}...`);

  while (Date.now() - startTime < timeoutMs) {
    const output = await captureOutput(sessionName, 100);
    const state = analyzeClaudeCodeState(output);

    if (state.isReady) {
      readyCount++;
      console.log(`[Tmux] Ready check ${readyCount}/${READY_CONFIRMATIONS}`);
      if (readyCount >= READY_CONFIRMATIONS) {
        console.log(`[Tmux] Claude Code confirmed ready after ${Date.now() - startTime}ms`);
        return state;
      }
    } else {
      if (readyCount > 0) {
        console.log(`[Tmux] Ready interrupted (processing=${state.isProcessing})`);
      }
      readyCount = 0;
    }

    lastState = state;
    await sleep(pollIntervalMs);
  }

  console.log(`[Tmux] Timeout waiting for Claude ready after ${timeoutMs}ms`);
  return lastState || analyzeClaudeCodeState(await captureOutput(sessionName, 100));
}

/**
 * Extract Claude's actual response from raw terminal output
 * Filters out TUI elements, prompts, spinners, tips, etc.
 */
export function extractClaudeResponse(rawOutput: string): string {
  const lines = rawOutput.split('\n');

  const filteredLines = lines.filter(line => {
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) return false;
    if (trimmed.length < 3) return false;

    // Skip command echo (lines starting with >)
    if (/^>\s*.+/.test(trimmed)) return false;

    // Skip shell prompts
    if (/^[$%#]\s*$/.test(trimmed)) return false;
    if (/^\[sandbox\]/.test(trimmed)) return false;

    // Skip box drawing characters
    if (/^[╭│╰─┌└├┤┬┴┼═╔╗╚╝╠╣╦╩╬]+$/.test(trimmed)) return false;
    if (/^[─═]+$/.test(trimmed)) return false;

    // Skip Claude Code status bar elements
    if (/^\w+@[\w-]+:/.test(trimmed)) return false;  // username@hostname:
    if (/◯\s*IDE\s*(dis)?connected/i.test(trimmed)) return false;
    if (/ctrl\+[a-z]/i.test(trimmed)) return false;  // Keyboard hints
    if (/to edit in vim/i.test(trimmed)) return false;
    if (/\[\s*\]/.test(trimmed) && trimmed.length < 20) return false;

    // Skip Claude Code tips and status messages
    if (/^⎿?\s*Tip:/i.test(trimmed)) return false;
    if (/install-slack-app/i.test(trimmed)) return false;
    if (/Inferring|Combobulating|Thinking/i.test(trimmed)) return false;
    if (/esc to interrupt/i.test(trimmed)) return false;
    if (/^[·✻✽✿✸]\s/.test(trimmed)) return false;  // Spinner characters

    // Skip lines that are mostly whitespace
    if (trimmed.replace(/\s/g, '').length < 5) return false;

    return true;
  });

  return filteredLines.join('\n').trim();
}

/**
 * Send a command and wait for response
 * Convenience method combining send + wait
 */
export async function sendCommandAndWait(
  sessionName: string,
  command: string,
  options?: {
    timeoutMs?: number;
    stabilityMs?: number;
  }
): Promise<string> {
  // Send the command
  await sendCommand(sessionName, command);
  await sleep(50); // Small delay before Enter
  await sendEnter(sessionName);

  // Wait for response
  return waitForResponse(sessionName, options);
}

/**
 * Clear terminal screen
 */
export async function clearScreen(sessionName: string): Promise<void> {
  await sendControlKey(sessionName, 'l');
}

/**
 * Restart Claude Code in a session
 */
export async function restartClaude(sessionName: string): Promise<void> {
  console.log(`[Tmux] Restarting Claude Code in ${sessionName}`);

  // Send Ctrl+C to interrupt any running command
  await sendControlKey(sessionName, 'c');
  await sleep(100);

  // Exit Claude if running
  await sendCommand(sessionName, 'exit');
  await sendEnter(sessionName);
  await sleep(500);

  // Start Claude again
  await sendCommand(sessionName, 'claude --dangerously-skip-permissions');
  await sendEnter(sessionName);

  // Update session
  const session = await getSessionByName(sessionName);
  if (session) {
    session.isClaudeRunning = true;
  }
}

/**
 * Clean up old/stale sessions
 */
export async function cleanupStaleSessions(maxAgeMs: number = 24 * 60 * 60 * 1000): Promise<void> {
  const now = Date.now();

  for (const [projectId, session] of sessionRegistry) {
    if (now - session.lastActivity > maxAgeMs) {
      console.log(`[Tmux] Cleaning up stale session ${session.sessionName}`);
      await killSession(session.sessionName);
    }
  }
}

export default {
  isTmuxAvailable,
  sessionExists,
  createSession,
  killSession,
  sendCommand,
  sendEnter,
  sendControlKey,
  sendSpecialKey,
  captureOutput,
  getSessionInfo,
  getSessionByName,
  listSessions,
  analyzeClaudeCodeState,
  waitForResponse,
  waitForClaudeReady,
  extractClaudeResponse,
  sendCommandAndWait,
  clearScreen,
  restartClaude,
  cleanupStaleSessions
};
