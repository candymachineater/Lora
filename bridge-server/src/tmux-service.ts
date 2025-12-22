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
import { claudeStateService } from './claude-state-service';

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
 * Set up sandbox configuration and hooks for a project directory.
 * Creates:
 * - .claude/settings.json with hooks configuration
 * - .claude/hooks/lora-state-hook.sh for state notifications
 */
export function setupProjectSandbox(projectPath: string, sessionName?: string): void {
  const claudeDir = path.join(projectPath, '.claude');
  const hooksDir = path.join(claudeDir, 'hooks');
  const settingsPath = path.join(claudeDir, 'settings.json');
  const hookScriptPath = path.join(hooksDir, 'lora-state-hook.sh');

  // Create .claude and .claude/hooks directories if they don't exist
  if (!fs.existsSync(hooksDir)) {
    fs.mkdirSync(hooksDir, { recursive: true });
    console.log(`[Sandbox] Created .claude/hooks directory in ${projectPath}`);
  }

  // Remove any stale settings.local.json that might have old hook configurations
  const localSettingsPath = path.join(claudeDir, 'settings.local.json');
  if (fs.existsSync(localSettingsPath)) {
    fs.unlinkSync(localSettingsPath);
    console.log(`[Sandbox] Removed stale settings.local.json`);
  }

  // Create the hook script that receives JSON via stdin and writes state
  // Handles SessionStart, Stop, and Notification hooks
  // Uses grep/sed instead of jq for portability
  // Includes debug logging to /tmp/lora-hook-debug.log
  const hookScript = `#!/bin/bash
# Lora Claude Code State Hook
# Receives events via stdin and writes state to a file
# Handles:
# - SessionStart: Writes marker file to indicate hooks are working
# - Stop: Fires immediately when Claude finishes
# - Notification: Fires on idle_prompt, permission_prompt

DEBUG_LOG="/tmp/lora-hook-debug.log"
HOOK_TYPE="\${LORA_HOOK_TYPE:-notification}"
echo "$(date): Hook called (type=$HOOK_TYPE)" >> "$DEBUG_LOG"

INPUT=$(cat)
echo "$(date): Input received: $INPUT" >> "$DEBUG_LOG"
echo "$(date): LORA_SESSION=$LORA_SESSION" >> "$DEBUG_LOG"

# Only process if we have a LORA_SESSION (set by bridge server in tmux)
if [ -z "$LORA_SESSION" ]; then
  echo "$(date): LORA_SESSION not set, exiting" >> "$DEBUG_LOG"
  exit 0
fi

STATE_FILE="/tmp/lora-claude-state-$LORA_SESSION.json"
HOOKS_READY_FILE="/tmp/lora-hooks-ready-$LORA_SESSION"
TIMESTAMP=$(date +%s000)

# Handle SessionStart hook (proves hooks are working)
if [ "$HOOK_TYPE" = "session_start" ]; then
  echo "$TIMESTAMP" > "$HOOKS_READY_FILE"
  echo "$(date): SessionStart hook - wrote hooks ready marker to $HOOKS_READY_FILE" >> "$DEBUG_LOG"
  exit 0
fi

# Handle Stop hook (fires immediately when Claude finishes)
if [ "$HOOK_TYPE" = "stop" ]; then
  echo "{\\"state\\":\\"idle\\",\\"timestamp\\":$TIMESTAMP}" > "$STATE_FILE"
  echo "$(date): Stop hook - wrote idle state to $STATE_FILE" >> "$DEBUG_LOG"
  exit 0
fi

# Handle Notification hooks
# Extract notification_type using grep/sed (no jq dependency)
NOTIFICATION_TYPE=$(echo "$INPUT" | grep -o '"notification_type":"[^"]*"' | sed 's/"notification_type":"\\([^"]*\\)"/\\1/')
echo "$(date): notification_type=$NOTIFICATION_TYPE" >> "$DEBUG_LOG"

case "$NOTIFICATION_TYPE" in
  "permission_prompt")
    echo "{\\"state\\":\\"permission\\",\\"timestamp\\":$TIMESTAMP}" > "$STATE_FILE"
    echo "$(date): Wrote permission state to $STATE_FILE" >> "$DEBUG_LOG"
    ;;
  "idle_prompt")
    echo "{\\"state\\":\\"idle\\",\\"timestamp\\":$TIMESTAMP}" > "$STATE_FILE"
    echo "$(date): Wrote idle state to $STATE_FILE" >> "$DEBUG_LOG"
    ;;
  *)
    echo "$(date): Unknown notification_type: $NOTIFICATION_TYPE" >> "$DEBUG_LOG"
    ;;
esac

exit 0
`;

  fs.writeFileSync(hookScriptPath, hookScript);
  fs.chmodSync(hookScriptPath, '755');
  console.log(`[Sandbox] Created hook script at ${hookScriptPath}`);

  // Create .claude/settings.json with sandbox and hooks configuration
  // Sandbox settings provide filesystem and network isolation per project
  // SessionStart hook fires when Claude Code starts - used to verify hooks are working
  // Stop hook fires IMMEDIATELY when Claude finishes - this is the primary detection method
  // Notification hooks are backup for permission prompts and 60-second idle detection
  const sessionStartHookCommand = `LORA_HOOK_TYPE=session_start bash "$CLAUDE_PROJECT_DIR/.claude/hooks/lora-state-hook.sh"`;
  const stopHookCommand = `LORA_HOOK_TYPE=stop bash "$CLAUDE_PROJECT_DIR/.claude/hooks/lora-state-hook.sh"`;
  const notificationHookCommand = `LORA_HOOK_TYPE=notification bash "$CLAUDE_PROJECT_DIR/.claude/hooks/lora-state-hook.sh"`;
  const settings = {
    // Sandbox configuration - isolates Claude Code to this project directory
    sandbox: {
      // Enable OS-level sandbox (Linux: bubblewrap, macOS: Seatbelt)
      enabled: true,
      // Auto-allow bash commands that run inside the sandbox without prompting
      autoAllowBashIfSandboxed: true,
      // Commands that should run outside sandbox (need full system access)
      excludedCommands: [
        "docker",       // Docker needs socket access
        "git"           // Git may need SSH/GPG keys
      ],
      // Allow binding to localhost ports for Expo dev server
      network: {
        allowLocalBinding: true
      }
    },
    // Permission rules for filesystem access
    permissions: {
      // Deny access to sensitive directories and parent paths
      deny: [
        "Read(../**)",           // No access to parent directories
        "Read(~/.ssh/**)",       // No SSH keys
        "Read(~/.aws/**)",       // No AWS credentials
        "Read(~/.config/**)",    // No general config
        "Read(~/.gnupg/**)",     // No GPG keys
        "Read(/etc/**)",         // No system config
        "Edit(../**)",           // No editing parent directories
        "Bash(rm -rf /)",        // No dangerous rm commands
        "Bash(rm -rf ~)"         // No dangerous rm on home
      ]
    },
    hooks: {
      // SessionStart hook fires when Claude Code starts - verifies hooks are functional
      SessionStart: [
        {
          hooks: [
            {
              type: "command",
              command: sessionStartHookCommand,
              timeout: 5
            }
          ]
        }
      ],
      // Stop hook fires immediately when Claude Code finishes processing
      Stop: [
        {
          hooks: [
            {
              type: "command",
              command: stopHookCommand,
              timeout: 5
            }
          ]
        }
      ],
      // Notification hook for idle detection (fires after 60s of waiting for any input)
      // This covers both regular prompts AND permission prompts that go unanswered
      Notification: [
        {
          matcher: "idle_prompt",
          hooks: [
            {
              type: "command",
              command: notificationHookCommand,
              timeout: 5
            }
          ]
        }
      ]
    }
  };

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

  // Force sync to ensure Claude Code sees the settings on startup
  const hookFd = fs.openSync(hookScriptPath, 'r');
  fs.fsyncSync(hookFd);
  fs.closeSync(hookFd);
  const settingsFd = fs.openSync(settingsPath, 'r');
  fs.fsyncSync(settingsFd);
  fs.closeSync(settingsFd);

  console.log(`[Sandbox] Created settings.json with hooks configuration`);

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

  // Set up sandbox configuration for the project (includes hook configuration)
  setupProjectSandbox(projectPath, sessionName);

  // Create new detached session with LORA_SESSION environment variable
  // This allows Claude Code hooks to know which session they're in
  console.log(`[Tmux] Creating new session ${sessionName} in ${projectPath}`);

  // Set LORA_SESSION as a tmux environment variable that will be inherited by all processes
  await execAsync(
    `tmux new-session -d -s ${shellEscape(sessionName)} -c ${shellEscape(projectPath)} -e LORA_SESSION=${shellEscape(sessionName)}`
  );

  // Start watching for Claude state changes via hooks
  claudeStateService.startWatching(sessionName);

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
    // Wait longer to ensure shell initializes and settings.json is visible
    await sleep(1500);
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

    // Clean up state service
    claudeStateService.cleanupSession(sessionName);

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
 * Extract only the NEW output by removing content that existed before the command
 * Uses a simple heuristic: find where the command was echoed and return everything after
 */
export function extractNewOutput(fullOutput: string, previousOutput: string): string {
  console.log(`[Tmux] extractNewOutput: fullOutput=${fullOutput.length} chars, previousOutput=${previousOutput?.length || 0} chars`);

  if (!previousOutput || !previousOutput.trim()) {
    console.log(`[Tmux] extractNewOutput: No previousOutput, returning full output`);
    return fullOutput;
  }

  // If outputs are identical, return empty (no new content)
  if (fullOutput.trim() === previousOutput.trim()) {
    console.log(`[Tmux] extractNewOutput: Outputs identical, returning empty`);
    return '';
  }

  const fullLines = fullOutput.split('\n');
  const prevLines = previousOutput.split('\n');

  console.log(`[Tmux] extractNewOutput: fullLines=${fullLines.length}, prevLines=${prevLines.length}`);

  // Strategy 1: Find the last command echo ("> ") in full output
  // Everything after the command echo is the response
  let lastCommandEchoIdx = -1;
  for (let i = 0; i < fullLines.length; i++) {
    const line = fullLines[i].trim();
    // Look for command echo pattern: starts with ">" followed by the prompt
    if (line.startsWith('>') && line.length > 3) {
      lastCommandEchoIdx = i;
    }
  }

  if (lastCommandEchoIdx >= 0 && lastCommandEchoIdx < fullLines.length - 1) {
    const newContent = fullLines.slice(lastCommandEchoIdx + 1).join('\n').trim();
    if (newContent.length > 10) {
      console.log(`[Tmux] extractNewOutput: Found command echo at line ${lastCommandEchoIdx}, returning ${newContent.length} chars`);
      return newContent;
    }
  }

  // Strategy 2: Compare line by line from the end to find where content diverges
  // Start from the end of previousOutput and find where it appears in fullOutput
  const prevLastLines = prevLines.slice(-10).map(l => l.trim()).filter(l => l.length > 5);

  if (prevLastLines.length > 0) {
    const markerLine = prevLastLines[prevLastLines.length - 1];

    // Find the LAST occurrence of this marker in fullOutput
    let markerIdx = -1;
    for (let i = 0; i < fullLines.length; i++) {
      if (fullLines[i].trim() === markerLine) {
        markerIdx = i;
      }
    }

    if (markerIdx >= 0 && markerIdx < fullLines.length - 1) {
      const newContent = fullLines.slice(markerIdx + 1).join('\n').trim();
      if (newContent.length > 10) {
        console.log(`[Tmux] extractNewOutput: Found marker at line ${markerIdx}, returning ${newContent.length} chars`);
        return newContent;
      }
    }
  }

  // Strategy 3: Simple line count difference
  // If fullOutput has more lines than previousOutput, return the extra lines
  if (fullLines.length > prevLines.length + 2) {
    const newContent = fullLines.slice(prevLines.length - 5).join('\n').trim();
    if (newContent.length > 10) {
      console.log(`[Tmux] extractNewOutput: Line count difference, returning ${newContent.length} chars`);
      return newContent;
    }
  }

  // Strategy 4: Return everything after the input prompt ">"
  // Look for the most recent prompt-like line
  for (let i = fullLines.length - 1; i >= Math.max(0, fullLines.length - 50); i--) {
    const line = fullLines[i];
    // Check for Claude Code input prompt (empty ">" or with minimal content)
    if (/^>\s*$/.test(line.trim()) || line.includes('╭─')) {
      if (i < fullLines.length - 1) {
        const newContent = fullLines.slice(i + 1).join('\n').trim();
        if (newContent.length > 10) {
          console.log(`[Tmux] extractNewOutput: Found prompt at line ${i}, returning ${newContent.length} chars`);
          return newContent;
        }
      }
    }
  }

  // Fallback: Return full output rather than nothing
  // This ensures we always have something to summarize
  console.log(`[Tmux] extractNewOutput: No extraction strategy worked, returning full output (${fullOutput.length} chars)`);
  return fullOutput;
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
    // Also check hook state - if hooks report idle, trust that immediately
    const hookState = claudeStateService.readState(sessionName);
    if (hookState.state === 'idle' || hookState.state === 'permission') {
      console.log(`[Tmux] Hook reports ${hookState.state} during pattern matching - exiting early`);
      const output = await captureOutput(sessionName, 100);
      const state = analyzeClaudeCodeState(output);
      state.isReady = true;
      state.isProcessing = false;
      state.isWaitingConfirm = hookState.state === 'permission';
      return state;
    }

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
 * Send a prompt to Claude Code with verification that Enter was received
 * Handles race conditions where Enter key might be dropped by tmux
 *
 * This is critical for voice-driven workflows where reliability is paramount
 */
export async function sendPromptWithVerification(
  sessionName: string,
  prompt: string,
  options?: {
    maxRetries?: number;
    delayBeforeEnter?: number;
    verificationDelay?: number;
  }
): Promise<void> {
  const {
    maxRetries = 2,
    delayBeforeEnter = 150,  // ms to wait between typing and Enter
    verificationDelay = 500   // ms to wait before verification
  } = options || {};

  console.log(`[Tmux] Sending prompt with verification to ${sessionName}`);

  // Step 1: Type the text
  await sendCommand(sessionName, prompt);
  await sleep(delayBeforeEnter);

  // Step 2: Send Enter
  await sendEnter(sessionName);
  await sleep(verificationDelay);

  // Step 3: Verify submission succeeded
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const output = await captureOutput(sessionName, 10);
    const lines = output.split('\n').filter(l => l.trim());
    const lastLine = lines[lines.length - 1] || '';

    // Detection Method 1: Check if text is still sitting at prompt (not submitted)
    // Pattern: "> Transform this application..." means typed but NOT submitted
    // Pattern: "Transform this application..." (no >) means submitted successfully
    const hasPromptWithText = lastLine.startsWith('>') && lastLine.length > 2;

    // Detection Method 2: Check if state file was updated (Claude started processing)
    const hookState = claudeStateService.readState(sessionName, false);
    const stateAge = Date.now() - hookState.timestamp;
    const stateIsStale = stateAge > 2000; // More than 2s old = likely didn't receive Enter

    // If BOTH detection methods indicate failure, retry
    // (Require both to avoid false positives)
    if (hasPromptWithText && stateIsStale) {
      console.log(`[Tmux] ⚠️ Enter verification failed (attempt ${attempt + 1}/${maxRetries})`);
      console.log(`[Tmux]   Last line: "${lastLine.substring(0, 60)}..."`);
      console.log(`[Tmux]   State age: ${stateAge}ms (stale: ${stateIsStale})`);

      // Retry Enter key
      await sleep(200);
      await sendEnter(sessionName);
      await sleep(verificationDelay);

      // Continue loop to re-verify
      continue;
    }

    // Verification passed!
    console.log(`[Tmux] ✓ Prompt submitted successfully`);
    return;
  }

  // Final check after all retries
  const finalOutput = await captureOutput(sessionName, 5);
  const finalLine = finalOutput.split('\n').filter(l => l.trim()).slice(-1)[0] || '';

  if (finalLine.startsWith('>') && finalLine.length > 2) {
    console.error(`[Tmux] ❌ Failed to submit prompt after ${maxRetries} retries`);
    console.error(`[Tmux]    Final line: "${finalLine}"`);
    throw new Error(`Failed to submit prompt to Claude Code: Enter key not received after ${maxRetries} attempts`);
  }

  console.log(`[Tmux] ✓ Prompt submitted (verified after retry)`);
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

/**
 * HOOK-BASED: Wait for Claude Code to be ready using the hooks system
 *
 * This is more reliable than pattern matching because Claude Code's hooks
 * notify us directly when state changes occur. Falls back to pattern matching
 * if hooks aren't responding (older Claude Code versions).
 */
export interface HookBasedClaudeState {
  isReady: boolean;
  isProcessing: boolean;
  isWaitingConfirm: boolean;  // permission_prompt
  state: 'idle' | 'permission' | 'processing' | 'stopped' | 'unknown';
  rawOutput: string;
  usedHooks: boolean;  // true if we used hooks, false if we fell back to pattern matching
}

export async function waitForClaudeReadyWithHooks(
  sessionName: string,
  options?: {
    timeoutMs?: number;
    pollIntervalMs?: number;
    useHooksOnly?: boolean;  // if true, don't fall back to pattern matching
    previousOutput?: string;  // output before command was sent, to filter out old content
    hooksCheckTimeoutMs?: number;  // time to wait before checking if hooks are working
  }
): Promise<HookBasedClaudeState> {
  const {
    timeoutMs = 180000,   // 3 minutes max (only applies when hooks aren't working)
    pollIntervalMs = 300,
    useHooksOnly = false,
    previousOutput = '',
    hooksCheckTimeoutMs = 10000  // Check if hooks are working after 10s
  } = options || {};

  const startTime = Date.now();
  let lastHookCheck = 0;
  const HOOK_CHECK_INTERVAL = 1000;  // Check hooks every second
  let hookResponded = false;
  let hooksWorkingChecked = false;
  let hooksAreWorking = false;

  console.log(`[Tmux] Waiting for Claude Code (hooks+fallback) in ${sessionName}...`);
  console.log(`[Tmux] Hook detection: timeoutMs=${timeoutMs}, pollInterval=${pollIntervalMs}, useHooksOnly=${useHooksOnly}, hooksCheckTimeout=${hooksCheckTimeoutMs}`);

  // Ensure we're watching this session
  if (!claudeStateService.getWatchedSessions().includes(sessionName)) {
    console.log(`[Tmux] Starting to watch session: ${sessionName}`);
    claudeStateService.startWatching(sessionName);
  }

  // Check initial state before marking as processing
  const initialState = claudeStateService.readState(sessionName, true);
  console.log(`[Tmux] Initial hook state: ${initialState.state} (timestamp: ${initialState.timestamp})`);

  // Mark as processing when we start waiting
  claudeStateService.markProcessing(sessionName);
  console.log(`[Tmux] Marked session as processing`);

  // When hooks are working and reporting 'processing', we DON'T timeout
  // This allows Claude Code to run for 20+ minutes if needed
  // Timeout only applies when hooks aren't working (fallback to pattern matching)
  while (true) {
    const elapsed = Date.now() - startTime;

    // After hooksCheckTimeoutMs, check if hooks are actually working
    if (!hooksWorkingChecked && elapsed >= hooksCheckTimeoutMs) {
      hooksWorkingChecked = true;
      hooksAreWorking = claudeStateService.areHooksWorking(sessionName);

      if (!hooksAreWorking && !hookResponded && !useHooksOnly) {
        // Hooks aren't working - fall back to pattern matching
        console.log(`[Tmux] ⚠️ Hooks not working after ${hooksCheckTimeoutMs}ms, falling back to pattern matching`);
        console.log(`[Tmux] Switching to pattern-based detection...`);

        // Use waitForClaudeReady which does pattern matching
        const patternState = await waitForClaudeReady(sessionName, {
          timeoutMs: timeoutMs - elapsed,
          pollIntervalMs
        });

        const output = await captureOutput(sessionName, 100);
        const newOutput = extractNewOutput(output, previousOutput);

        return {
          isReady: patternState.isReady,
          isProcessing: patternState.isProcessing,
          isWaitingConfirm: patternState.isWaitingConfirm,
          state: patternState.isReady
            ? (patternState.isWaitingConfirm ? 'permission' : 'idle')
            : (patternState.isProcessing ? 'processing' : 'unknown'),
          rawOutput: newOutput,
          usedHooks: false  // Indicate we used pattern matching
        };
      } else if (hooksAreWorking) {
        console.log(`[Tmux] ✓ Hooks are working (SessionStart marker found) - NO TIMEOUT will be applied`);
      }
    }

    // Check hook-based state periodically
    if (Date.now() - lastHookCheck >= HOOK_CHECK_INTERVAL) {
      // Use verbose logging every 5 seconds
      const isVerboseCheck = elapsed > 0 && elapsed % 5000 < HOOK_CHECK_INTERVAL;
      const hookState = claudeStateService.readState(sessionName, isVerboseCheck);
      lastHookCheck = Date.now();

      // If hooks have reported something other than 'unknown' and 'processing', they've responded
      if (hookState.state !== 'unknown' && hookState.state !== 'processing') {
        if (!hookResponded) {
          console.log(`[Tmux] Hook responded! State: ${hookState.state} at ${elapsed}ms`);
        }
        hookResponded = true;

        // Check if we're in a ready state
        if (claudeStateService.isReadyState(hookState.state)) {
          const output = await captureOutput(sessionName, 100);
          // Filter out old content if previousOutput was provided
          const newOutput = extractNewOutput(output, previousOutput);

          console.log(`[Tmux] Hook reports ready: ${hookState.state} after ${elapsed}ms`);

          return {
            isReady: true,
            isProcessing: false,
            isWaitingConfirm: hookState.state === 'permission',
            state: hookState.state,
            rawOutput: newOutput,
            usedHooks: true
          };
        }
      }

      // Log progress every 5 seconds (reduced frequency for long-running tasks)
      // After 5 minutes, only log every 30 seconds to reduce noise
      const logInterval = elapsed > 300000 ? 30000 : 5000;
      if (isVerboseCheck || (elapsed > 300000 && elapsed % logInterval < HOOK_CHECK_INTERVAL)) {
        const hooksStatus = hooksWorkingChecked
          ? (hooksAreWorking ? 'working' : 'NOT working')
          : 'not yet checked';
        console.log(`[Tmux] Waiting... hookState=${hookState.state}, hookResponded=${hookResponded}, hooksStatus=${hooksStatus}, elapsed=${Math.round(elapsed/1000)}s`);
      }

      // Only apply timeout if hooks are NOT working
      // When hooks are working, we wait indefinitely for Claude to finish
      if (!hooksAreWorking && elapsed >= timeoutMs) {
        // Timeout only applies when hooks aren't working
        const finalOutput = await captureOutput(sessionName, 100);
        const filteredFinalOutput = extractNewOutput(finalOutput, previousOutput);

        console.log(`[Tmux] Timeout after ${timeoutMs}ms (hooks not working), final hookState=${hookState.state}`);

        return {
          isReady: claudeStateService.isReadyState(hookState.state),
          isProcessing: hookState.state === 'processing',
          isWaitingConfirm: hookState.state === 'permission',
          state: hookState.state,
          rawOutput: filteredFinalOutput,
          usedHooks: hookResponded
        };
      }
    }

    await sleep(pollIntervalMs);
  }
}

/**
 * Progress information for a Claude session in multi-terminal execution
 */
export interface ClaudeSessionProgress {
  sessionName: string;
  terminalIndex: number;
  isComplete: boolean;
  isSuccess: boolean;
  error?: string;
  claudeResponse?: string;
  startTime: number;
  endTime?: number;
}

/**
 * Wait for multiple Claude Code sessions to complete concurrently.
 *
 * This enables parallel command execution across multiple terminals by monitoring
 * their hook state files simultaneously. Each session is watched independently,
 * and the function returns when ALL sessions have completed (success or failure).
 *
 * @param sessions - Array of sessions to monitor, each with sessionName, terminalIndex, previousOutput, and description
 * @param options - Configuration including timeoutMs, pollIntervalMs, and onProgress callback
 * @returns Promise<ClaudeSessionProgress[]> - Array of results for each session
 *
 * @example
 * const results = await waitForMultipleClaudeSessions([
 *   { sessionName: 'lora-term1', terminalIndex: 0, previousOutput: '', description: 'Run /compact' },
 *   { sessionName: 'lora-term2', terminalIndex: 1, previousOutput: '', description: 'Run /clear' }
 * ], {
 *   onProgress: (progress) => {
 *     console.log(`Terminal ${progress.terminalIndex + 1} finished: ${progress.isSuccess}`);
 *   }
 * });
 */
export async function waitForMultipleClaudeSessions(
  sessions: Array<{
    sessionName: string;
    terminalIndex: number;
    previousOutput: string;
    description: string;
  }>,
  options?: {
    timeoutMs?: number;
    pollIntervalMs?: number;
    onProgress?: (progress: ClaudeSessionProgress) => void;
  }
): Promise<ClaudeSessionProgress[]> {
  const {
    timeoutMs = 180000,  // 3 minutes per session
    pollIntervalMs = 300,
    onProgress
  } = options || {};

  console.log(`[Tmux] Waiting for ${sessions.length} Claude sessions concurrently...`);

  const startTime = Date.now();

  // Initialize progress tracking for each session
  const progressMap = new Map<string, ClaudeSessionProgress>();
  for (const session of sessions) {
    progressMap.set(session.sessionName, {
      sessionName: session.sessionName,
      terminalIndex: session.terminalIndex,
      isComplete: false,
      isSuccess: false,
      startTime: Date.now()
    });

    // Ensure we're watching this session's hook state
    if (!claudeStateService.getWatchedSessions().includes(session.sessionName)) {
      console.log(`[Tmux] Starting to watch session: ${session.sessionName}`);
      claudeStateService.startWatching(session.sessionName);
    }

    // Mark as processing
    claudeStateService.markProcessing(session.sessionName);
  }

  // Create a monitoring promise for each session
  const monitoringPromises = sessions.map(async (session) => {
    const progress = progressMap.get(session.sessionName)!;

    try {
      console.log(`[Tmux] Monitoring Terminal ${session.terminalIndex + 1} (${session.sessionName}) - ${session.description}`);

      // Wait for this specific session using existing hook-based waiting
      const result = await waitForClaudeReadyWithHooks(session.sessionName, {
        timeoutMs,
        pollIntervalMs,
        previousOutput: session.previousOutput
      });

      progress.isComplete = true;
      progress.isSuccess = result.isReady;
      progress.endTime = Date.now();

      if (result.isReady) {
        // Extract Claude's response from the output
        const output = await captureOutput(session.sessionName, 100);
        const newOutput = extractNewOutput(output, session.previousOutput);
        progress.claudeResponse = extractClaudeResponse(newOutput);
      } else {
        progress.error = 'Claude did not respond in time';
      }

      // Notify progress callback
      if (onProgress) {
        onProgress(progress);
      }

      const duration = ((progress.endTime || Date.now()) - progress.startTime) / 1000;
      console.log(`[Tmux] Terminal ${session.terminalIndex + 1} (${session.sessionName}) completed in ${duration.toFixed(1)}s: ${progress.isSuccess ? 'SUCCESS' : 'FAILED'}`);

      return progress;

    } catch (error) {
      progress.isComplete = true;
      progress.isSuccess = false;
      progress.endTime = Date.now();
      progress.error = String(error);

      if (onProgress) {
        onProgress(progress);
      }

      const duration = ((progress.endTime || Date.now()) - progress.startTime) / 1000;
      console.log(`[Tmux] Terminal ${session.terminalIndex + 1} (${session.sessionName}) failed after ${duration.toFixed(1)}s: ${error}`);

      return progress;
    }
  });

  // Wait for ALL sessions to complete using Promise.allSettled
  // This ensures we wait for all sessions even if some fail
  const results = await Promise.allSettled(monitoringPromises);

  // Extract the progress objects from settled promises
  const finalProgress = results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      // Promise rejection (shouldn't happen since we catch errors, but just in case)
      const session = sessions[index];
      return {
        sessionName: session.sessionName,
        terminalIndex: session.terminalIndex,
        isComplete: true,
        isSuccess: false,
        error: 'Promise rejection: ' + result.reason,
        startTime: Date.now(),
        endTime: Date.now()
      };
    }
  });

  const successCount = finalProgress.filter(p => p.isSuccess).length;
  const totalDuration = (Date.now() - startTime) / 1000;
  console.log(`[Tmux] Multi-session wait complete in ${totalDuration.toFixed(1)}s: ${successCount}/${sessions.length} succeeded`);

  return finalProgress;
}

/**
 * Mark a session as processing (call before sending a command)
 */
export function markSessionProcessing(sessionName: string): void {
  claudeStateService.markProcessing(sessionName);
}

/**
 * Get current Claude state from hooks
 */
export function getClaudeHookState(sessionName: string): { state: string; timestamp: number } {
  return claudeStateService.readState(sessionName);
}

// Re-export the state service for direct access if needed
export { claudeStateService };

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
  waitForClaudeReadyWithHooks,
  waitForMultipleClaudeSessions,
  extractClaudeResponse,
  sendCommandAndWait,
  sendPromptWithVerification,
  clearScreen,
  restartClaude,
  cleanupStaleSessions,
  markSessionProcessing,
  getClaudeHookState
};
