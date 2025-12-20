/**
 * Claude State Service for Lora Bridge Server
 *
 * Provides reliable Claude Code state detection using the built-in hooks system.
 * Instead of fragile pattern matching on terminal output, we use Claude Code's
 * hooks to get notified of state transitions:
 *
 * - idle_prompt: Claude finished responding, waiting for user input
 * - permission_prompt: Claude waiting for approval (y/n)
 * - UserPromptSubmit: User submitted a prompt, Claude is now processing
 * - Stop: Session ended
 *
 * Each project's .claude/settings.local.json is configured with hooks that
 * write state to /tmp/lora-claude-state-{sessionName}.json
 */

import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';

// State file location pattern
const STATE_DIR = '/tmp';
const STATE_FILE_PREFIX = 'lora-claude-state-';

/**
 * Claude Code state as reported by hooks
 */
export type ClaudeHookState = 'idle' | 'permission' | 'processing' | 'stopped' | 'unknown';

/**
 * Claude state info with timestamp
 */
export interface ClaudeStateInfo {
  state: ClaudeHookState;
  timestamp: number;
  rawValue?: string;
}

/**
 * State change event
 */
export interface StateChangeEvent {
  sessionName: string;
  previousState: ClaudeHookState;
  newState: ClaudeHookState;
  timestamp: number;
}

/**
 * Claude State Service - watches for state changes via hook-written files
 */
class ClaudeStateService extends EventEmitter {
  private watchedSessions: Map<string, {
    watcher: fs.FSWatcher | null;
    lastState: ClaudeStateInfo;
    pollInterval: NodeJS.Timeout | null;
  }> = new Map();

  private logPrefix = '[ClaudeState]';

  constructor() {
    super();
    this.ensureStateDir();
  }

  /**
   * Ensure the state directory exists
   */
  private ensureStateDir(): void {
    if (!fs.existsSync(STATE_DIR)) {
      fs.mkdirSync(STATE_DIR, { recursive: true });
    }
  }

  /**
   * Get the state file path for a session
   */
  getStateFilePath(sessionName: string): string {
    return path.join(STATE_DIR, `${STATE_FILE_PREFIX}${sessionName}.json`);
  }

  /**
   * Write state to file (called by hooks via shell command)
   * This is what the hook command will do
   */
  static getHookCommand(sessionName: string, state: ClaudeHookState): string {
    const stateFile = path.join(STATE_DIR, `${STATE_FILE_PREFIX}${sessionName}.json`);
    const stateData = JSON.stringify({ state, timestamp: Date.now() });
    // Use printf for better escaping in shell
    return `printf '%s' '${stateData}' > ${stateFile}`;
  }

  /**
   * Generate the Claude Code hooks configuration for a session
   */
  static generateHooksConfig(sessionName: string): object {
    const stateFile = path.join(STATE_DIR, `${STATE_FILE_PREFIX}${sessionName}.json`);

    return {
      hooks: {
        // When Claude finishes and shows the ">" prompt
        Notification: [
          {
            matcher: 'idle_prompt',
            hooks: [
              {
                type: 'command',
                command: `echo '{"state":"idle","timestamp":'$(date +%s000)'}' > ${stateFile}`
              }
            ]
          },
          {
            matcher: 'permission_prompt',
            hooks: [
              {
                type: 'command',
                command: `echo '{"state":"permission","timestamp":'$(date +%s000)'}' > ${stateFile}`
              }
            ]
          },
          {
            matcher: 'UserPromptSubmit',
            hooks: [
              {
                type: 'command',
                command: `echo '{"state":"processing","timestamp":'$(date +%s000)'}' > ${stateFile}`
              }
            ]
          },
          {
            matcher: 'Stop',
            hooks: [
              {
                type: 'command',
                command: `echo '{"state":"stopped","timestamp":'$(date +%s000)'}' > ${stateFile}`
              }
            ]
          }
        ]
      }
    };
  }

  /**
   * Read current state from file
   */
  readState(sessionName: string, verbose: boolean = false): ClaudeStateInfo {
    const stateFile = this.getStateFilePath(sessionName);

    if (!fs.existsSync(stateFile)) {
      if (verbose) {
        console.log(`${this.logPrefix} [readState] File doesn't exist: ${stateFile}`);
      }
      return { state: 'unknown', timestamp: 0 };
    }

    try {
      const content = fs.readFileSync(stateFile, 'utf-8').trim();
      const data = JSON.parse(content);

      const result = {
        state: data.state as ClaudeHookState || 'unknown',
        timestamp: data.timestamp || Date.now(),
        rawValue: content
      };

      if (verbose) {
        const fileStats = fs.statSync(stateFile);
        console.log(`${this.logPrefix} [readState] ${sessionName}: state=${result.state}, timestamp=${result.timestamp}, fileModified=${fileStats.mtime.toISOString()}`);
      }

      return result;
    } catch (err) {
      console.log(`${this.logPrefix} Failed to read state file for ${sessionName}:`, err);
      return { state: 'unknown', timestamp: 0 };
    }
  }

  /**
   * Start watching a session for state changes
   */
  startWatching(sessionName: string): void {
    if (this.watchedSessions.has(sessionName)) {
      console.log(`${this.logPrefix} Already watching session ${sessionName}`);
      return;
    }

    const stateFile = this.getStateFilePath(sessionName);
    console.log(`${this.logPrefix} Starting to watch ${sessionName} at ${stateFile}`);

    // Initialize state file if it doesn't exist
    if (!fs.existsSync(stateFile)) {
      this.writeState(sessionName, 'unknown');
    }

    const lastState = this.readState(sessionName);
    let watcher: fs.FSWatcher | null = null;

    // Try to use fs.watch for efficiency
    try {
      watcher = fs.watch(stateFile, (eventType) => {
        if (eventType === 'change') {
          this.handleStateFileChange(sessionName);
        }
      });

      watcher.on('error', (err) => {
        console.log(`${this.logPrefix} Watcher error for ${sessionName}:`, err);
        // Fall back to polling if watch fails
        this.startPolling(sessionName);
      });
    } catch (err) {
      console.log(`${this.logPrefix} Failed to start watcher, using polling for ${sessionName}`);
    }

    this.watchedSessions.set(sessionName, {
      watcher,
      lastState,
      pollInterval: null
    });

    // Also start polling as a fallback (fs.watch can be unreliable on some systems)
    this.startPolling(sessionName);
  }

  /**
   * Start polling for state changes (fallback for when fs.watch doesn't work)
   */
  private startPolling(sessionName: string): void {
    const session = this.watchedSessions.get(sessionName);
    if (!session) return;

    // Clear existing poll interval
    if (session.pollInterval) {
      clearInterval(session.pollInterval);
    }

    // Poll every 300ms
    session.pollInterval = setInterval(() => {
      this.handleStateFileChange(sessionName);
    }, 300);
  }

  /**
   * Handle state file change
   */
  private handleStateFileChange(sessionName: string): void {
    const session = this.watchedSessions.get(sessionName);
    if (!session) return;

    const newState = this.readState(sessionName);

    // Only emit if state actually changed
    if (newState.state !== session.lastState.state ||
        (newState.timestamp > session.lastState.timestamp && newState.state !== 'unknown')) {
      const event: StateChangeEvent = {
        sessionName,
        previousState: session.lastState.state,
        newState: newState.state,
        timestamp: newState.timestamp
      };

      console.log(`${this.logPrefix} State change: ${event.previousState} → ${event.newState} for ${sessionName}`);
      session.lastState = newState;
      this.emit('stateChange', event);
    }
  }

  /**
   * Write state to file (for testing or manual state updates)
   */
  writeState(sessionName: string, state: ClaudeHookState): void {
    const stateFile = this.getStateFilePath(sessionName);
    const data = { state, timestamp: Date.now() };
    fs.writeFileSync(stateFile, JSON.stringify(data));
  }

  /**
   * Stop watching a session
   */
  stopWatching(sessionName: string): void {
    const session = this.watchedSessions.get(sessionName);
    if (!session) return;

    console.log(`${this.logPrefix} Stopping watch for ${sessionName}`);

    if (session.watcher) {
      session.watcher.close();
    }

    if (session.pollInterval) {
      clearInterval(session.pollInterval);
    }

    this.watchedSessions.delete(sessionName);
  }

  /**
   * Wait for Claude to be ready (idle or permission prompt)
   * This is the replacement for the old pattern-matching approach
   */
  async waitForReady(
    sessionName: string,
    options?: {
      timeoutMs?: number;
      pollIntervalMs?: number;
    }
  ): Promise<ClaudeStateInfo> {
    const {
      timeoutMs = 180000,  // 3 minutes default
      pollIntervalMs = 300
    } = options || {};

    const startTime = Date.now();

    // Start watching if not already
    if (!this.watchedSessions.has(sessionName)) {
      this.startWatching(sessionName);
    }

    console.log(`${this.logPrefix} Waiting for Claude to be ready in ${sessionName}...`);

    // Check immediately
    let currentState = this.readState(sessionName);
    if (this.isReadyState(currentState.state)) {
      console.log(`${this.logPrefix} Claude already ready: ${currentState.state}`);
      return currentState;
    }

    // Poll for state changes
    while (Date.now() - startTime < timeoutMs) {
      await this.sleep(pollIntervalMs);

      currentState = this.readState(sessionName);

      if (this.isReadyState(currentState.state)) {
        console.log(`${this.logPrefix} Claude became ready: ${currentState.state} after ${Date.now() - startTime}ms`);
        return currentState;
      }

      // Log progress every 5 seconds
      const elapsed = Date.now() - startTime;
      if (elapsed > 0 && elapsed % 5000 < pollIntervalMs) {
        console.log(`${this.logPrefix} Still waiting... state=${currentState.state}, elapsed=${elapsed}ms`);
      }
    }

    console.log(`${this.logPrefix} Timeout waiting for ready state after ${timeoutMs}ms`);
    return currentState;
  }

  /**
   * Check if a state indicates Claude is ready for input
   */
  isReadyState(state: ClaudeHookState): boolean {
    return state === 'idle' || state === 'permission';
  }

  /**
   * Check if Claude needs confirmation (permission prompt)
   */
  needsConfirmation(state: ClaudeHookState): boolean {
    return state === 'permission';
  }

  /**
   * Check if Claude is processing
   */
  isProcessing(state: ClaudeHookState): boolean {
    return state === 'processing';
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Clean up state file when session ends
   */
  cleanupSession(sessionName: string): void {
    this.stopWatching(sessionName);

    const stateFile = this.getStateFilePath(sessionName);
    if (fs.existsSync(stateFile)) {
      try {
        fs.unlinkSync(stateFile);
        console.log(`${this.logPrefix} Cleaned up state file for ${sessionName}`);
      } catch (err) {
        console.log(`${this.logPrefix} Failed to clean up state file:`, err);
      }
    }
  }

  /**
   * Mark a session as processing (called when we send a command)
   */
  markProcessing(sessionName: string): void {
    this.writeState(sessionName, 'processing');
    const session = this.watchedSessions.get(sessionName);
    if (session) {
      session.lastState = { state: 'processing', timestamp: Date.now() };
    }
  }

  /**
   * Get all watched sessions
   */
  getWatchedSessions(): string[] {
    return Array.from(this.watchedSessions.keys());
  }
}

// Singleton instance
const claudeStateService = new ClaudeStateService();

export { claudeStateService };
export default claudeStateService;
