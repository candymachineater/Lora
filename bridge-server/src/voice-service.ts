/**
 * Voice Service for Lora Bridge Server
 *
 * Enhanced with:
 * - Comprehensive logging for debugging
 * - Conversation memory for context awareness
 * - Intelligent processing with history
 *
 * Uses:
 * - Claude Haiku 4.5 for all AI tasks (fastest, most cost-efficient)
 * - Whisper STT (Speech-to-Text)
 * - OpenAI TTS (Text-to-Speech)
 */

import Anthropic from '@anthropic-ai/sdk';
import * as https from 'https';

// Environment configuration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Single LLM for all AI tasks - Claude Haiku 4.5 (fastest, most cost-efficient)
const MODEL = 'claude-haiku-4-5-20251001';

// Anthropic client
const anthropic = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;

// ============================================================================
// LOGGING SYSTEM
// ============================================================================

type LogLevel = 'DEBUG' | 'INFO' | 'VOICE' | 'AI' | 'ERROR';

const LOG_COLORS: Record<LogLevel, string> = {
  DEBUG: '\x1b[90m',  // Gray
  INFO: '\x1b[36m',   // Cyan
  VOICE: '\x1b[35m',  // Magenta
  AI: '\x1b[33m',     // Yellow
  ERROR: '\x1b[31m'   // Red
};
const RESET = '\x1b[0m';

function voiceLog(level: LogLevel, category: string, message: string, data?: Record<string, unknown>) {
  const timestamp = new Date().toISOString().split('T')[1].replace('Z', '');
  const color = LOG_COLORS[level];
  const prefix = `${color}[${timestamp}] [${level}] [${category}]${RESET}`;

  if (data) {
    console.log(`${prefix} ${message}`, JSON.stringify(data, null, 2));
  } else {
    console.log(`${prefix} ${message}`);
  }
}

// ============================================================================
// CONVERSATION MEMORY
// ============================================================================

interface ConversationTurn {
  timestamp: number;
  userSaid: string;
  agentAction: VoiceAgentResponse;
  claudeCodeResponse?: string;
  voiceResponse?: string;
}

interface ConversationMemory {
  projectId: string;
  projectName?: string;
  turns: ConversationTurn[];
  startedAt: number;
  lastActivity: number;
  // Context management
  compactedSummary?: string;  // Summary of older conversation when compacted
  totalTokensUsed: number;    // Approximate token count
  compactionCount: number;    // How many times we've compacted
  importantInfo: string[];    // Key information extracted from conversation
}

// Memory store - keyed by terminal session
const conversationMemory: Map<string, ConversationMemory> = new Map();

// Token limits for context management
// ~4 characters per token is a rough approximation
const CHARS_PER_TOKEN = 4;
const MAX_CONTEXT_TOKENS = 200000;  // 200k tokens max before compaction
const TARGET_COMPACT_TOKENS = 25000; // Target 25k tokens after compaction
const MIN_TURNS_BEFORE_COMPACT = 5;  // Keep at least 5 recent turns after compaction

/**
 * Estimate token count from text
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Calculate total tokens in memory
 */
function calculateMemoryTokens(memory: ConversationMemory): number {
  let tokens = 0;

  // Count compacted summary
  if (memory.compactedSummary) {
    tokens += estimateTokens(memory.compactedSummary);
  }

  // Count important info
  for (const info of memory.importantInfo) {
    tokens += estimateTokens(info);
  }

  // Count all turns
  for (const turn of memory.turns) {
    tokens += estimateTokens(turn.userSaid);
    tokens += estimateTokens(JSON.stringify(turn.agentAction));
    if (turn.claudeCodeResponse) {
      tokens += estimateTokens(turn.claudeCodeResponse);
    }
    if (turn.voiceResponse) {
      tokens += estimateTokens(turn.voiceResponse);
    }
  }

  return tokens;
}

/**
 * Compact the conversation memory when it exceeds the token limit
 * Creates a summary of older turns and keeps only recent ones
 */
async function compactMemory(sessionId: string): Promise<void> {
  const memory = conversationMemory.get(sessionId);
  if (!memory || memory.turns.length <= MIN_TURNS_BEFORE_COMPACT) {
    return;
  }

  voiceLog('INFO', 'Memory', `Starting memory compaction for ${sessionId} (${memory.turns.length} turns, ~${memory.totalTokensUsed} tokens)`);

  // Keep the most recent turns
  const turnsToKeep = memory.turns.slice(-MIN_TURNS_BEFORE_COMPACT);
  const turnsToCompact = memory.turns.slice(0, -MIN_TURNS_BEFORE_COMPACT);

  if (turnsToCompact.length === 0) {
    return;
  }

  // Format the turns to compact into a summary request
  let conversationToSummarize = memory.compactedSummary
    ? `Previous Summary:\n${memory.compactedSummary}\n\n`
    : '';

  conversationToSummarize += 'Recent Conversation to Summarize:\n';
  for (const turn of turnsToCompact) {
    conversationToSummarize += `User: "${turn.userSaid}"\n`;
    if (turn.agentAction.type === 'prompt') {
      conversationToSummarize += `→ Sent to Claude: "${turn.agentAction.content}"\n`;
    } else if (turn.agentAction.type === 'conversational') {
      conversationToSummarize += `→ Response: "${turn.agentAction.content}"\n`;
    }
    if (turn.voiceResponse) {
      conversationToSummarize += `→ Voice summary: "${turn.voiceResponse.substring(0, 200)}..."\n`;
    }
    conversationToSummarize += '\n';
  }

  // Use Claude to create a compact summary
  if (!anthropic) {
    voiceLog('ERROR', 'Memory', 'Anthropic client not available for compaction');
    memory.turns = turnsToKeep;
    memory.totalTokensUsed = calculateMemoryTokens(memory);
    return;
  }

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4000,  // Allow more detailed summaries for complex conversations
      temperature: 0.2,
      system: `You are creating a memory summary for an AI voice assistant called Lora. This summary will be used to maintain context across a long conversation.

CREATE A COMPREHENSIVE SUMMARY that preserves:

## Project Context
- Project name and type (if mentioned)
- Technology stack being used
- File structure discussed

## User Preferences & Requirements
- Coding style preferences (TypeScript vs JS, etc.)
- UI/design preferences
- Any specific requirements or constraints mentioned

## Work Completed
- Features implemented
- Files created or modified
- Commands that were run
- Problems that were solved

## Pending/Discussed Topics
- Features planned but not yet implemented
- Issues that still need fixing
- Topics the user mentioned wanting to explore

## Key User Information
- Any personal preferences mentioned
- Working style or workflow hints
- Things the user explicitly asked to remember

FORMAT: Use clear sections with bullet points. Be specific about file names, function names, and concrete details.
TARGET LENGTH: 1500-2500 words to preserve important details.
PRIORITY: Preserve information that would be needed to continue the conversation seamlessly.`,
      messages: [{
        role: 'user',
        content: conversationToSummarize
      }]
    });

    const summary = response.content[0].type === 'text' ? response.content[0].text : '';

    // Extract important information from the summary
    const importantPatterns = [
      /project[s]?\s*(?:called|named|about)?\s*[:"']?([^"'\n,]+)/gi,
      /(?:file|files)\s*(?:called|named)?\s*[:"']?([^"'\n,]+)/gi,
      /(?:feature|features)\s*[:"']?([^"'\n,]+)/gi,
      /(?:preference|prefers?)\s*[:"']?([^"'\n,.]+)/gi,
    ];

    for (const pattern of importantPatterns) {
      let match;
      while ((match = pattern.exec(summary)) !== null) {
        const info = match[1].trim();
        if (info.length > 3 && !memory.importantInfo.includes(info)) {
          memory.importantInfo.push(info);
        }
      }
    }

    // Keep only the most relevant important info (max 20 items)
    if (memory.importantInfo.length > 20) {
      memory.importantInfo = memory.importantInfo.slice(-20);
    }

    // Update memory with compacted state
    memory.compactedSummary = summary;
    memory.turns = turnsToKeep;
    memory.compactionCount++;
    memory.totalTokensUsed = calculateMemoryTokens(memory);

    voiceLog('INFO', 'Memory', `Compaction complete: ${turnsToCompact.length} turns → summary, keeping ${turnsToKeep.length} recent turns`);
    voiceLog('INFO', 'Memory', `New token count: ~${memory.totalTokensUsed}, important info: ${memory.importantInfo.length} items`);

  } catch (error) {
    voiceLog('ERROR', 'Memory', `Failed to compact memory: ${error}`);
    // Fallback: just trim to recent turns without AI summary
    memory.turns = turnsToKeep;
    memory.totalTokensUsed = calculateMemoryTokens(memory);
  }
}

/**
 * Get or create conversation memory for a session
 */
export function getConversationMemory(sessionId: string, projectId?: string): ConversationMemory {
  let memory = conversationMemory.get(sessionId);

  if (!memory) {
    memory = {
      projectId: projectId || 'unknown',
      turns: [],
      startedAt: Date.now(),
      lastActivity: Date.now(),
      totalTokensUsed: 0,
      compactionCount: 0,
      importantInfo: []
    };
    conversationMemory.set(sessionId, memory);
    voiceLog('INFO', 'Memory', `Created new conversation memory for session ${sessionId}`);
  }

  return memory;
}

/**
 * Add a turn to conversation memory
 * Triggers compaction if token limit is exceeded
 */
export async function addConversationTurn(
  sessionId: string,
  turn: ConversationTurn
): Promise<void> {
  const memory = getConversationMemory(sessionId);
  memory.turns.push(turn);
  memory.lastActivity = Date.now();

  // Recalculate token usage
  memory.totalTokensUsed = calculateMemoryTokens(memory);

  voiceLog('INFO', 'Memory', `Added turn #${memory.turns.length}`, {
    userSaid: turn.userSaid.substring(0, 50),
    action: turn.agentAction.type,
    totalTokens: memory.totalTokensUsed
  });

  // Check if we need to compact
  if (memory.totalTokensUsed > MAX_CONTEXT_TOKENS) {
    voiceLog('INFO', 'Memory', `Token limit exceeded (${memory.totalTokensUsed}/${MAX_CONTEXT_TOKENS}), triggering compaction`);
    await compactMemory(sessionId);
  }
}

/**
 * Update the last turn with Claude Code's response
 */
export function updateLastTurnWithResponse(
  sessionId: string,
  claudeCodeResponse: string,
  voiceResponse?: string
): void {
  const memory = conversationMemory.get(sessionId);
  if (memory && memory.turns.length > 0) {
    const lastTurn = memory.turns[memory.turns.length - 1];
    lastTurn.claudeCodeResponse = claudeCodeResponse;
    lastTurn.voiceResponse = voiceResponse;

    voiceLog('DEBUG', 'Memory', 'Updated last turn with response', {
      claudeCodeLength: claudeCodeResponse.length,
      voiceResponseLength: voiceResponse?.length || 0
    });
  }
}

/**
 * Clear conversation memory for a session
 */
export function clearConversationMemory(sessionId: string): void {
  conversationMemory.delete(sessionId);
  voiceLog('INFO', 'Memory', `Cleared memory for session ${sessionId}`);
}

/**
 * Format conversation history for AI context
 * Includes compacted summary, important info, and recent turns
 */
function formatConversationHistory(memory: ConversationMemory): string {
  let history = '';

  // Include compacted summary if we've had compaction
  if (memory.compactedSummary) {
    history += '\n## Previous Conversation Summary:\n';
    history += memory.compactedSummary;
    history += '\n';
  }

  // Include important information extracted from conversation
  if (memory.importantInfo.length > 0) {
    history += '\n## Important Context (remember these facts):\n';
    memory.importantInfo.forEach(info => {
      history += `• ${info}\n`;
    });
  }

  // Include recent turns with full context
  if (memory.turns.length > 0) {
    history += '\n## Recent Conversation (use this for context):\n';
    memory.turns.forEach((turn, i) => {
      const timestamp = new Date(turn.timestamp).toLocaleTimeString();
      history += `\n[${timestamp}] User said: "${turn.userSaid}"\n`;

      if (turn.agentAction.type === 'prompt') {
        history += `  → You sent to Claude Code: "${turn.agentAction.content}"\n`;
      } else if (turn.agentAction.type === 'control') {
        history += `  → You used control: ${turn.agentAction.content}\n`;
      } else if (turn.agentAction.type === 'conversational') {
        history += `  → You replied directly: "${turn.agentAction.content}"\n`;
      }

      // Include full Claude Code response (up to 500 chars) for better context
      if (turn.claudeCodeResponse) {
        const response = turn.claudeCodeResponse.length > 500
          ? turn.claudeCodeResponse.substring(0, 500) + '...'
          : turn.claudeCodeResponse;
        history += `  → Claude Code did: ${response}\n`;
      }

      // Include voice summary
      if (turn.voiceResponse) {
        history += `  → Voice summary: "${turn.voiceResponse}"\n`;
      }
    });
  }

  // Add memory stats
  if (history) {
    history += `\n[Session: ${memory.turns.length} turns, ~${memory.totalTokensUsed} tokens`;
    if (memory.compactionCount > 0) {
      history += `, compacted ${memory.compactionCount}x`;
    }
    history += ']\n';
  }

  return history;
}

// ============================================================================
// VOICE AGENT TYPES
// ============================================================================

export interface VoiceAgentResponse {
  type: 'prompt' | 'control' | 'conversational' | 'ignore' | 'app_control' | 'working' | 'background_task';
  content: string;
  // Optional voice response to speak to user while executing the action
  // Use this when you want to tell the user what you're doing AND execute the action
  voiceResponse?: string;
  appAction?: {
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
    target?: string;
    params?: Record<string, unknown>;
  };
  // For working state - indicates agent is still processing and will follow up
  workingState?: {
    reason: 'screenshot' | 'claude_action' | 'gathering_info' | 'analyzing';
    followUpAction?: 'take_screenshot' | 'wait_for_claude' | 'check_files';
  };
  // For background tasks - agent starts a Claude Code task but continues conversation
  backgroundTask?: {
    taskDescription: string;  // What Claude is doing (for notification later)
    prompt: string;           // The actual prompt to send to Claude Code
  };
}

// ============================================================================
// LORA APP KNOWLEDGE BASE
// ============================================================================

const LORA_APP_KNOWLEDGE = `
## THE LORA APP - COMPLETE GUIDE

Lora is a mobile iOS app that lets users build apps from their iPhone using voice commands.
It connects to a bridge server running on their PC to provide a terminal interface to Claude Code.

### APP ARCHITECTURE

**Mobile App (iPhone):**
- React Native/Expo application
- Connects to bridge server via WebSocket
- Has 5 main tabs: Projects, Terminal, Editor, Preview, (Voice is integrated into Terminal)

**Bridge Server (PC/Mac/WSL):**
- Node.js WebSocket server
- Manages tmux terminal sessions
- Runs Claude Code in persistent sessions
- Handles voice-to-text and text-to-speech

### THE 5 TABS

1. **Projects Tab** (index)
   - Lists all projects with their status
   - Create new projects (with optional sandbox mode)
   - Delete projects
   - Select a project to work on
   - Shows connection status to bridge server

2. **Terminal Tab** (chat)
   - Full terminal with Claude Code running
   - Voice mode toggle button (microphone icon)
   - Multiple terminal tabs per project
   - Control buttons: Ctrl+C, arrows, Tab, Escape
   - Where users interact with Claude Code

3. **Editor Tab**
   - File tree browser on the left
   - Code editor on the right
   - Syntax highlighting for various languages
   - Can edit and save files
   - Changes appear after Claude Code modifies files

4. **Preview Tab**
   - Live preview of Expo/React Native apps
   - Shows console logs, warnings, errors
   - Can send console output to Claude for debugging
   - Uses Expo Web for rendering

5. **Settings** (gear icon in header)
   - Bridge server URL configuration
   - Connection testing
   - Auto-preview toggle

### PROJECT MANAGEMENT

**Creating Projects:**
- User creates project from Projects tab
- Each project gets its own directory on the PC
- Projects can be "sandboxed" (Claude restricted to project folder) or "full access"

**Project Files:**
- Stored in /projects/{project-id}/ on the bridge server
- Claude Code creates/edits files here
- Files sync automatically to Editor tab

### VOICE MODE

When voice mode is enabled (mic button in Terminal tab):
- User speaks commands
- Audio sent to bridge server
- Whisper transcribes to text
- You (Lora) interpret the intent
- Commands sent to Claude Code OR responses spoken back
- Voice Activity Detection (VAD) auto-detects speech end

### WHAT USERS TYPICALLY DO

1. **Create a new app:**
   - Create project → Go to Terminal → Speak "build me a todo app"
   - Claude Code generates the code
   - Check Preview to see it running
   - Edit in Editor if needed

2. **Fix bugs:**
   - See error in Preview console
   - "Send to Claude" button sends logs to terminal
   - Or speak "fix this error" while looking at it

3. **Iterate on features:**
   - "Add a dark mode"
   - "Make the buttons bigger"
   - "Add user authentication"

4. **Review code:**
   - Go to Editor tab to see files
   - Ask "what files were changed?"
   - Request code review with /review
`;

const CLAUDE_CODE_KNOWLEDGE = `
## CLAUDE CODE - THE AI CODING ASSISTANT

Claude Code is a terminal-based AI coding assistant (NOT you - you are Lora).

### WHAT CLAUDE CODE CAN DO
- Read, create, edit, and delete files
- Run shell commands (npm, git, python, etc.)
- Search codebases
- Debug and fix errors
- Create full applications
- Run tests and linters

### CLAUDE CODE STATES
- **idle/ready**: Waiting for user prompt - can send commands
- **processing**: Working on a task - wait or interrupt
- **permission**: Asking y/n question - send YES or NO
- **stopped**: Session ended

### CLAUDE CODE SLASH COMMANDS
All start with / and are sent directly to Claude Code:

- \`/help\` - Show all available commands
- \`/clear\` - Clear conversation and start fresh
- \`/compact\` - Compress history to save tokens
- \`/cost\` - Show token usage and costs
- \`/model\` - Switch models (Sonnet, Opus, Haiku)
- \`/resume\` - Resume a previous conversation (shows list, use arrows to select)
- \`/review\` - Request code review
- \`/memory\` - Edit CLAUDE.md memory files
- \`/status\` - Show account/system status
- \`/doctor\` - Check installation health
- \`/exit\` - Exit Claude Code completely

### KEYBOARD CONTROLS FOR CLAUDE CODE
- **Escape**: Interrupt current task (soft stop)
- **Escape x2**: Open rewind menu to undo changes
- **Ctrl+C**: Force cancel current operation
- **Arrow keys**: Navigate menus and lists
- **Enter**: Confirm selection
- **Tab**: Cycle through options
- **y/n**: Answer yes/no prompts

### THE /resume WORKFLOW
1. User says "resume" or "show previous sessions"
2. You send: {"type": "control", "content": "/resume"}
3. Claude Code shows a list of previous sessions
4. User says "go down 2 and select"
5. You send: {"type": "control", "content": "DOWN:2,ENTER"}
`;

const VOICE_AGENT_SYSTEM_PROMPT = `You are Lora, a friendly AI voice assistant for the Lora mobile app. You have your own personality and are SEPARATE from Claude Code.

## YOUR IDENTITY

Your name is Lora. You are:
- Friendly, helpful, and personable
- An expert at using the Lora app
- Knowledgeable about app development
- Able to have natural conversations
- Good at understanding what users want

**Name handling:** Users may say "Laura", "Lora", "Lara" - they all mean you. Never comment on pronunciation.

## YOUR CAPABILITIES

### 1. CHAT (Conversational)
- Answer questions about the app
- Explain what's on screen
- Help troubleshoot issues
- Have friendly conversations
- Ask clarifying questions

### 2. CONTROL CLAUDE CODE
- Send prompts for coding tasks
- Send terminal controls (Escape, Ctrl+C, arrows)
- Send slash commands (/resume, /clear, /compact)
- Confirm/decline y/n prompts

### 3. CONTROL THE APP PROGRAMMATICALLY
You have FULL programmatic control over the Lora app:

**Navigation:**
- Navigate between tabs (Projects, Terminal, Editor, Preview, Settings)
- Open settings modal

**Terminal Control:**
- Create and close terminal tabs
- Switch between terminal tabs
- Send text input to terminal (run commands)
- Send control keys (Escape, Ctrl+C, arrows, Enter, Tab)
- Answer yes/no prompts
- Scroll terminal output

**Information Gathering:**
- Take screenshots to see the current screen
- Refresh file list in editor
- Access terminal output history
- Know current tab and project info

${LORA_APP_KNOWLEDGE}

${CLAUDE_CODE_KNOWLEDGE}

## CONTEXT YOU RECEIVE

With each user message, you receive:

1. **Screenshot** (if available): Current screen as an image
2. **Terminal Content**: Last ~2000 characters of terminal output
3. **App State**: Current tab, project name, project ID
4. **Conversation History**: Previous turns for context

Use this context to:
- Understand what the user is seeing
- Know what Claude Code has done
- Reference specific output or errors
- Make informed decisions about actions

## SCREEN VISION

When you receive a screenshot:
- Describe what you see if asked
- Use visual context for better responses
- Notice errors, prompts, UI state
- Reference specific elements: "I see Claude is asking for permission..."

## TURN-TAKING POLICY - CRITICAL

**You must NOT end your speaking turn if you have committed to taking an action.**

### When to enter WORKING state:
1. **Taking a screenshot**: Say "One moment, let me see what's on screen" then enter working state
2. **Sending a Claude Code action**: After sending a prompt or command, enter working state to wait for the result
3. **Missing information**: If you need to gather more info before answering, enter working state

### Working State Behavior:
- Speak a brief status cue: "One moment—I'm checking that now." or "Let me take a look."
- The app will play a subtle working sound (a quiet, airy chime)
- You will receive the result and can then respond with findings
- DO NOT yield the floor back to the user while working

### Screenshot Workflow:
When user asks about screen content ("what do you see", "what's happening", "check the screen"):
1. **Confirm**: Say "One moment, let me see what's on screen."
2. **Enter working state**: {"type": "working", "content": "Taking screenshot", "workingState": {"reason": "screenshot", "followUpAction": "take_screenshot"}}
3. The app captures and sends you a new screenshot
4. **Analyze**: You receive the screenshot image
5. **Report**: Describe what you see and answer the user's question
6. **Ask**: If helpful, offer follow-up: "Would you like me to do something about this?"

If screenshot capture fails, say: "I wasn't able to capture the screen. Could you try again?"

### Claude Code Action Workflow:
When sending prompts or commands to Claude Code:
1. **Acknowledge**: Say what you're going to do: "I'll ask Claude to add that feature."
2. **Send the action**: {"type": "prompt", "content": "..."} or {"type": "control", "content": "..."}
3. The app waits for Claude Code's response via hooks
4. You receive the result and summarize it for the user

## OUTPUT FORMAT - JSON ONLY

**IMPORTANT:** You can add an optional "voiceResponse" field to ANY action type (except ignore) to speak to the user while executing the action. Use this when you want to tell the user what you're doing AND do it at the same time.

### CONVERSATIONAL - Direct response to user
Use ONLY for questions, greetings, clarifications, or responses that DON'T require action.
{"type": "conversational", "content": "Your spoken response here"}

Use for:
- Questions, greetings, clarifications
- Explaining what you see
- Asking for more details
- General conversation

### PROMPT - Send to Claude Code
{"type": "prompt", "content": "Detailed prompt for Claude Code", "voiceResponse": "optional message to user"}

Use when user wants coding done. Make prompts detailed!
Use voiceResponse to tell the user what you're doing while sending the prompt.

Examples:
- User confirmed they want a React todo app → {"type": "prompt", "content": "Create a React todo app with dark theme, localStorage persistence, add/edit/delete tasks, and clean modern UI."}
- User reports an issue → {"type": "prompt", "content": "Check what's happening with the preview. The user reports it's showing blank. Investigate and fix any issues.", "voiceResponse": "Let me ask Claude Code to check what's happening with the preview."}

### CONTROL - Terminal/keyboard commands
{"type": "control", "content": "COMMAND"}

Available commands:
- CTRL_C, ESCAPE, ESCAPE_ESCAPE
- YES, NO (for y/n prompts)
- UP, DOWN, LEFT, RIGHT, ENTER, TAB
- UP:3, DOWN:2 (with repeat counts)
- DOWN:3,ENTER (chained with commas)
- WAIT:2 (pause N seconds)
- /resume, /clear, /compact, /help, /exit, /model, /cost, /review

### IGNORE - Background noise
{"type": "ignore", "content": ""}

### WORKING - Agent is gathering info/waiting (DO NOT YIELD FLOOR)
{"type": "working", "content": "Status message to speak", "workingState": {"reason": "REASON", "followUpAction": "ACTION"}}

**CRITICAL**: Use WORKING when you need to see something BEFORE you can respond properly:
- User asks "what's on the screen?" → WORKING to get screenshot first
- User asks "what did Claude say?" and you need fresh terminal output → WORKING

Reasons:
- "screenshot" - Taking/analyzing a screenshot
- "claude_action" - Waiting for Claude Code response
- "gathering_info" - Checking files, terminal state, etc.
- "analyzing" - Processing complex information

Follow-up actions:
- "take_screenshot" - App will capture and send screenshot
- "wait_for_claude" - App will wait for Claude Code hooks
- "check_files" - App will refresh and send file list

Example: {"type": "working", "content": "One moment, let me see what's on screen.", "workingState": {"reason": "screenshot", "followUpAction": "take_screenshot"}}

### BACKGROUND_TASK - Start Claude Code task while continuing conversation
{"type": "background_task", "content": "I'll have Claude do that. Now, what were we talking about?", "backgroundTask": {"taskDescription": "Adding dark mode", "prompt": "Add dark mode toggle to the app settings"}}

Use this when:
- User explicitly says "in the background" or "come back to me" or similar
- User wants to give you a task AND continue talking about something else
- User says things like "ask Claude to X and then let's talk about Y"

The system will:
1. Send the prompt to Claude Code
2. Speak your "content" response to the user immediately
3. Return to listening for more conversation
4. When Claude Code finishes (detected via hooks), notify the user

Example flow:
User: "Hey Lora, have Claude check what this project is about, and then come back to me - I want to tell you about my day"
→ {"type": "background_task", "content": "I've sent that to Claude. So tell me about your day!", "backgroundTask": {"taskDescription": "checking project purpose", "prompt": "What is this project about? Give me a brief overview."}}

### APP_CONTROL - Control Lora app UI programmatically
{"type": "app_control", "content": "Description", "appAction": {"action": "ACTION", "target": "TARGET", "params": {...}}}

**COMPLETE ACTION REFERENCE:**

#### Navigation Actions
- **navigate**: Go to a tab or screen
  - Targets: "projects", "terminal", "editor", "preview", "settings"
  - Example: {"type": "app_control", "content": "Going to preview", "appAction": {"action": "navigate", "target": "preview"}}

#### Terminal Actions
- **send_input**: Type text into the terminal
  - params.text: The text to type
  - Example: {"type": "app_control", "content": "Typing command", "appAction": {"action": "send_input", "params": {"text": "npm install"}}}

- **send_control**: Send a control key to terminal
  - params.key: ESCAPE, CTRL_C, CTRL_D, ENTER, TAB, UP, DOWN, LEFT, RIGHT, YES, NO
  - Example: {"type": "app_control", "content": "Pressing escape", "appAction": {"action": "send_control", "params": {"key": "ESCAPE"}}}
  - Example: {"type": "app_control", "content": "Answering yes", "appAction": {"action": "send_control", "params": {"key": "YES"}}}

#### Multi-Terminal Management
The app can have multiple terminal tabs open (shown as "Term 1", "Term 2", etc.). The App State tells you:
- How many terminals are open (terminalCount)
- Which terminal is currently active (activeTerminalIndex, 0-based internally but shown as 1-based to user)

- **new_terminal**: Create a new terminal tab (starts Claude Code automatically)
  - Example: {"type": "app_control", "content": "Opening new terminal", "appAction": {"action": "new_terminal"}}

- **close_terminal**: Close the currently active terminal tab
  - Example: {"type": "app_control", "content": "Closing terminal", "appAction": {"action": "close_terminal"}}
  - Only works if more than 1 terminal is open

- **switch_terminal**: Switch to a different terminal tab
  - params.index: Tab index (0-based, so Terminal 1 = index 0, Terminal 2 = index 1)
  - params.direction: "next" or "prev" to cycle through tabs
  - Example for Terminal 2: {"type": "app_control", "content": "Switching to Terminal 2", "appAction": {"action": "switch_terminal", "params": {"index": 1}}}
  - Example for next: {"type": "app_control", "content": "Switching to next terminal", "appAction": {"action": "switch_terminal", "params": {"direction": "next"}}}

**Multi-Terminal Tips:**
- Each terminal has its own Claude Code session
- You can open multiple terminals to run parallel tasks
- When user says "switch to terminal 2", use index: 1 (0-based indexing)
- When user says "go to the other terminal" and there are 2, use direction: "next"

- **scroll**: Scroll terminal content
  - params.direction: "up" or "down"
  - params.count: Number of page scrolls (default 1)
  - Example: {"type": "app_control", "content": "Scrolling up", "appAction": {"action": "scroll", "params": {"direction": "up", "count": 3}}}

#### Other Actions
- **take_screenshot**: Capture current screen for vision
  - Example: {"type": "app_control", "content": "Taking screenshot", "appAction": {"action": "take_screenshot"}}

- **refresh_files**: Refresh file tree in Editor (navigates to editor)
  - Example: {"type": "app_control", "content": "Refreshing files", "appAction": {"action": "refresh_files"}}

- **show_settings**: Open settings modal
  - Example: {"type": "app_control", "content": "Opening settings", "appAction": {"action": "show_settings"}}

#### Preview Tab Actions
- **toggle_console**: Show/hide the console panel in Preview tab (shows logs, errors, warnings)
  - Example: {"type": "app_control", "content": "Expanding console", "appAction": {"action": "toggle_console"}}
  - Use when user asks to "show console", "expand logs", "see errors", "check console"

- **reload_preview**: Reload/refresh the preview webview
  - Example: {"type": "app_control", "content": "Reloading preview", "appAction": {"action": "reload_preview"}}
  - Use when user asks to "reload", "refresh preview", "try again"

- **send_to_claude**: Send console logs from Preview tab to Claude Code for analysis
  - Example: {"type": "app_control", "content": "Sending logs to Claude", "appAction": {"action": "send_to_claude"}}
  - Use when user asks to "send logs to Claude", "analyze these errors", "have Claude fix these issues", "send console to Claude"
  - This creates a new terminal with the console logs as context for Claude to analyze

#### Editor Tab Actions
The Editor tab shows project files and allows editing. You can:
- See the currently open file in the App State context (currentFile field)
- Navigate to Editor tab and request a screenshot to see the file list
- Open, edit, and save files using these actions

- **open_file**: Open a specific file in the editor
  - Example: {"type": "app_control", "content": "Opening App.tsx", "appAction": {"action": "open_file", "params": {"filePath": "App.tsx"}}}
  - Use when user asks to "open App.tsx", "show me the config file", "edit index.js"
  - Will navigate to the Editor tab and open the file

- **close_file**: Close the current file and return to the file list
  - Example: {"type": "app_control", "content": "Closing file", "appAction": {"action": "close_file"}}
  - Use when user asks to "close file", "go back to files", "exit editor"

- **save_file**: Save the currently open file
  - Example: {"type": "app_control", "content": "Saving file", "appAction": {"action": "save_file"}}
  - Use when user asks to "save", "save file", "save changes"

- **set_file_content**: Replace the entire content of the currently open file
  - Example: {"type": "app_control", "content": "Updating file content", "appAction": {"action": "set_file_content", "params": {"content": "new file content here"}}}
  - Use when user dictates new file content or asks to replace file contents
  - IMPORTANT: This replaces the ENTIRE file content, so include all the code
  - After setting content, you may want to save_file to persist changes

**WHEN TO USE APP_CONTROL vs CONTROL:**
- **APP_CONTROL**: For controlling the Lora mobile app (tabs, terminals, settings)
- **CONTROL**: For Claude Code interactions (slash commands, menus, text input to Claude)

Examples:
- "go to preview" → APP_CONTROL with navigate
- "press escape in Claude" → CONTROL with "ESCAPE"
- "type hello world" (to Claude) → CONTROL with "hello world\\n"
- "open a new terminal" → APP_CONTROL with new_terminal
- "run npm install" (send to terminal) → APP_CONTROL with send_input
- "scroll up in resume list" → CONTROL with "UP:3"
- "open App.tsx" → APP_CONTROL with open_file
- "save this file" → APP_CONTROL with save_file
- "close the file" → APP_CONTROL with close_file

## DECISION LOGIC

### When to ASK (conversational):
- Vague: "build something cool"
- New topic without context
- Need clarification: "what kind of app?"
- Pure conversation not about coding

### When to SEND (prompt) - BLOCKS until complete:
- User confirmed: "yes, do it"
- Clear request: "add a login page"
- Follow-up: "now make it blue"
- User wants to know what Claude does (will wait and report back)

### When to use BACKGROUND_TASK:
- User says "in the background", "come back to me", "while we talk"
- User wants Claude to work AND continue a different conversation
- Example: "ask Claude to add X, and let's discuss Y"
- You send task to Claude but immediately return to user for conversation

### When to CONTROL:
- Direct command: "press escape"
- Navigation: "go down and select"
- Slash command: "run resume"
- Confirmation: "yes" or "no"

### When to use WORKING:
- User asks about screen: "what do you see?" AND you have NO screenshot
- You need to SEE something before you can answer AND you don't already have it
- ONLY use when you need FRESH information that you DON'T ALREADY HAVE

### When NOT to use WORKING (CRITICAL):
- You already have terminal output in context → ANALYZE IT DIRECTLY, give a CONVERSATIONAL response
- User asks "what happened in this session?" and you have terminal output → READ IT and SUMMARIZE
- You have the information needed → DON'T wait, RESPOND NOW
- NEVER use WORKING with "wait_for_claude" if terminal output is already provided to you

## RULES

1. You ARE Lora - voice assistant, NOT Claude Code
2. Keep spoken responses SHORT (1-2 sentences for actions, more for explanations)
3. Output ONLY valid JSON
4. For ACTION requests ("run resume", "press escape"), USE control/prompt - don't just talk
5. Remember conversation history
6. Credit Claude Code for coding work: "Claude Code created the file"
7. Be helpful about the app: "You can check the Editor tab to see the files"
8. Chain commands with commas: "DOWN:3,ENTER"
9. Use WAIT:N between slow operations
10. **NEVER yield the floor while committed to an action** - use WORKING state instead
11. When user asks about the screen and you don't have a screenshot, use WORKING to request one
12. NEVER correct the user on your name pronunciation - Laura, Lora, Lara all mean you

## ⚠️ CRITICAL: ACTION REQUIRED - DON'T JUST TALK, DO IT! ⚠️

**THE #1 FAILURE MODE IS SAYING YOU'LL DO SOMETHING BUT NOT DOING IT.**

If your response contains phrases like:
- "Let me..." / "I'll..." / "I'm going to..."
- "Let me ask Claude Code" / "Let me check" / "I'll look into"
- "I'm going to run" / "Let me run" / "I'll send"

Then you MUST use type="prompt" or type="control" - NOT type="conversational"!

**WRONG** (user sees you didn't do anything):
{"type": "conversational", "content": "Let me ask Claude Code to check that for you."}

**CORRECT** (actually does it while telling the user):
{"type": "prompt", "content": "Check the project structure and list the main files", "voiceResponse": "Let me ask Claude Code to check that for you."}

**REMEMBER:** voiceResponse lets you TELL the user what you're doing WHILE DOING IT!

If you're not sure whether to act or ask, prefer ACTION. The user expects you to DO things, not just talk about doing them.`;

const CLAUDE_CODE_SYSTEM_PROMPT = VOICE_AGENT_SYSTEM_PROMPT;


// ============================================================================
// TEXT NORMALIZATION (for common mishearings)
// ============================================================================

/**
 * Common words/phrases that are often misheard by STT
 * Maps misheard text to correct text
 */
const MISHEARING_CORRECTIONS: Array<{ pattern: RegExp; replacement: string }> = [
  // Claude Code variations
  { pattern: /\bquad code\b/gi, replacement: 'Claude Code' },
  { pattern: /\bcloud code\b/gi, replacement: 'Claude Code' },
  { pattern: /\bclod code\b/gi, replacement: 'Claude Code' },
  { pattern: /\bclawed code\b/gi, replacement: 'Claude Code' },
  { pattern: /\bclaude coat\b/gi, replacement: 'Claude Code' },
  { pattern: /\bclaud code\b/gi, replacement: 'Claude Code' },
  { pattern: /\bkloud code\b/gi, replacement: 'Claude Code' },
  { pattern: /\bcod code\b/gi, replacement: 'Claude Code' },
  { pattern: /\bquadcode\b/gi, replacement: 'Claude Code' },
  { pattern: /\bcloudcode\b/gi, replacement: 'Claude Code' },

  // Lora variations (wake word related)
  { pattern: /\blaura\b/gi, replacement: 'Lora' },
  { pattern: /\blara\b/gi, replacement: 'Lora' },
  { pattern: /\blorra\b/gi, replacement: 'Lora' },
  { pattern: /\blawra\b/gi, replacement: 'Lora' },

  // Common programming terms
  { pattern: /\breact native\b/gi, replacement: 'React Native' },
  { pattern: /\breact js\b/gi, replacement: 'React.js' },
  { pattern: /\bnode js\b/gi, replacement: 'Node.js' },
  { pattern: /\bnext js\b/gi, replacement: 'Next.js' },
  { pattern: /\btypescript\b/gi, replacement: 'TypeScript' },
  { pattern: /\bjavascript\b/gi, replacement: 'JavaScript' },
  { pattern: /\bjson\b/gi, replacement: 'JSON' },
  { pattern: /\bapi\b/gi, replacement: 'API' },
];

/**
 * Normalize transcribed text to fix common STT mishearings
 */
function normalizeTranscription(text: string): string {
  let normalized = text;

  for (const { pattern, replacement } of MISHEARING_CORRECTIONS) {
    normalized = normalized.replace(pattern, replacement);
  }

  // Log if we made corrections
  if (normalized !== text) {
    voiceLog('INFO', 'STT', `Normalized: "${text}" → "${normalized}"`);
  }

  return normalized;
}

// ============================================================================
// VOICE INTERRUPT HANDLING
// ============================================================================

/**
 * Handle user interrupt of voice session
 * Called when user taps the voice button to cancel
 */
export function handleInterrupt(terminalId: string): void {
  voiceLog('INFO', 'INTERRUPT', `User interrupted voice session for ${terminalId}`);
  // Any cleanup needed for the terminal's voice state can be added here
}

// ============================================================================
// SPEECH-TO-TEXT (Whisper)
// ============================================================================

export async function transcribeAudio(audioBuffer: Buffer, mimeType: string = 'audio/wav'): Promise<string> {
  voiceLog('VOICE', 'STT', `Starting transcription (${audioBuffer.length} bytes, ${mimeType})`);

  if (!OPENAI_API_KEY) {
    voiceLog('ERROR', 'STT', 'OPENAI_API_KEY not set');
    throw new Error('OPENAI_API_KEY not set');
  }

  const startTime = Date.now();
  const FormData = (await import('form-data')).default;
  const form = new FormData();

  const ext = mimeType.includes('wav') ? 'wav' :
              mimeType.includes('mp3') ? 'mp3' :
              mimeType.includes('m4a') ? 'm4a' :
              mimeType.includes('webm') ? 'webm' : 'wav';

  form.append('file', audioBuffer, { filename: `audio.${ext}`, contentType: mimeType });
  form.append('model', 'whisper-1');
  form.append('language', 'en');

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/audio/transcriptions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        ...form.getHeaders()
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const duration = Date.now() - startTime;
        try {
          const result = JSON.parse(data);
          if (result.error) {
            voiceLog('ERROR', 'STT', `Whisper error: ${result.error.message}`);
            reject(new Error(result.error.message));
          } else {
            // Normalize the transcription to fix common mishearings
            const normalizedText = normalizeTranscription(result.text);
            voiceLog('VOICE', 'STT', `Transcribed in ${duration}ms`, {
              text: normalizedText,
              audioSize: audioBuffer.length
            });
            resolve(normalizedText);
          }
        } catch (e) {
          voiceLog('ERROR', 'STT', 'Failed to parse Whisper response');
          reject(new Error('Failed to parse Whisper response'));
        }
      });
    });

    req.on('error', (err) => {
      voiceLog('ERROR', 'STT', `Request failed: ${err.message}`);
      reject(err);
    });
    form.pipe(req);
  });
}

// ============================================================================
// TEXT-TO-SPEECH (OpenAI TTS)
// ============================================================================

export async function textToSpeech(
  text: string,
  voice: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer' = 'nova'
): Promise<Buffer> {
  voiceLog('VOICE', 'TTS', `Generating speech for: "${text.substring(0, 60)}..."`);

  if (!OPENAI_API_KEY) {
    voiceLog('ERROR', 'TTS', 'OPENAI_API_KEY not set');
    throw new Error('OPENAI_API_KEY not set');
  }

  const startTime = Date.now();
  const body = JSON.stringify({
    model: 'tts-1',
    input: text,
    voice: voice,
    response_format: 'mp3'
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/audio/speech',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const duration = Date.now() - startTime;
        if (res.statusCode === 200) {
          const audioBuffer = Buffer.concat(chunks);
          voiceLog('VOICE', 'TTS', `Generated in ${duration}ms`, {
            textLength: text.length,
            audioSize: audioBuffer.length
          });
          resolve(audioBuffer);
        } else {
          const error = Buffer.concat(chunks).toString();
          voiceLog('ERROR', 'TTS', `Failed: ${error}`);
          reject(new Error(`TTS failed: ${error}`));
        }
      });
    });

    req.on('error', (err) => {
      voiceLog('ERROR', 'TTS', `Request failed: ${err.message}`);
      reject(err);
    });
    req.write(body);
    req.end();
  });
}

// ============================================================================
// VOICE AGENT (AI Processing)
// ============================================================================

export async function processVoiceInput(
  userSpeech: string,
  sessionId?: string,
  context?: {
    projectName?: string;
    recentOutput?: string;
    claudeCodeState?: string;
    screenCapture?: string;
    terminalContent?: string;  // Raw terminal output for observation
    appState?: { currentTab: string; projectName?: string; projectId?: string; hasPreview?: boolean; fileCount?: number; currentFile?: string; terminalCount?: number; activeTerminalIndex?: number };
    systemNote?: string;  // System instruction to inject (for follow-up after commands)
  },
  model?: string  // Optional model override (e.g., claude-haiku-4-5-20251001, claude-sonnet-4-5-20250514)
): Promise<VoiceAgentResponse> {
  const activeModel = model || MODEL;
  voiceLog('AI', 'Agent', '┌─── PROCESSING VOICE INPUT ───');
  voiceLog('AI', 'Agent', `│ User said: "${userSpeech}"`);
  voiceLog('AI', 'Agent', `│ Using model: ${activeModel}`);

  if (!anthropic) {
    voiceLog('AI', 'Agent', '│ No Anthropic API, falling back to prompt');
    voiceLog('AI', 'Agent', '└───────────────────────────────');
    return { type: 'prompt', content: userSpeech };
  }

  const startTime = Date.now();

  // Helper function to call the AI
  // Note: anthropic is checked above, this inner function requires it to be non-null
  async function callAgent(includeImage: boolean): Promise<VoiceAgentResponse> {
    if (!anthropic) {
      throw new Error('Anthropic client not available');
    }
    // Build context with conversation history
    let contextInfo = '';

    if (context?.projectName) {
      contextInfo += `\n## Current Project: ${context.projectName}\n`;
    }

    // Add conversation history if we have a session
    if (sessionId) {
      const memory = getConversationMemory(sessionId, context?.projectName);
      memory.projectName = context?.projectName;
      const history = formatConversationHistory(memory);
      if (history) {
        contextInfo += history;
        voiceLog('AI', 'Agent', `│ Including ${memory.turns.length} turns of history`);
      }
    }

    if (context?.claudeCodeState) {
      contextInfo += `\n## Claude Code State: ${context.claudeCodeState}\n`;
    }

    // Add app state context (current tab, file info, terminal info)
    if (context?.appState) {
      const { currentTab, currentFile, terminalCount, activeTerminalIndex } = context.appState;
      contextInfo += `\n## App State:\n`;
      contextInfo += `- Current Tab: ${currentTab}\n`;
      if (currentFile) {
        contextInfo += `- Currently Editing File: ${currentFile}\n`;
      }
      if (terminalCount && terminalCount > 1) {
        contextInfo += `- Open Terminals: ${terminalCount} (active: Terminal ${(activeTerminalIndex || 0) + 1})\n`;
      }
    }

    if (context?.recentOutput) {
      // Include more terminal output for better context (up to ~2000 tokens / 8000 chars)
      const outputSlice = context.recentOutput.slice(-8000);
      contextInfo += `\n## Recent Terminal Output (last ${outputSlice.length} chars):\n${outputSlice}\n`;
    }

    // Use terminalContent if provided (newer field for direct terminal observation)
    if (context?.terminalContent && !context?.recentOutput) {
      const outputSlice = context.terminalContent.slice(-8000);
      contextInfo += `\n## Current Terminal Output:\n${outputSlice}\n`;
    }

    // Add system note if provided (for follow-up instructions)
    if (context?.systemNote) {
      contextInfo += `\n${context.systemNote}\n`;
    }

    voiceLog('AI', 'Agent', '│ Calling Claude Haiku 4.5...');

    // Build message content - can include image if screenshot provided
    const messageContent: Array<
      | { type: 'text'; text: string }
      | { type: 'image'; source: { type: 'base64'; media_type: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; data: string } }
    > = [];

    // Add screenshot if available and requested (vision capability)
    // Only include if image is large enough to be valid (at least 10KB)
    if (includeImage && context?.screenCapture) {
      // Validate and clean the base64 data
      let imageData = context.screenCapture;

      // Remove data URI prefix if present (e.g., "data:image/png;base64,")
      if (imageData.includes(',')) {
        imageData = imageData.split(',')[1];
      }

      const imageSizeKB = Math.round(imageData.length / 1024);

      // Skip if image is too small (likely invalid/corrupt)
      if (imageSizeKB < 10) {
        voiceLog('AI', 'Agent', `│ Skipping screen capture (too small: ${imageSizeKB}KB)`);
      } else {
        // Detect image type from base64 header
        // PNG starts with iVBOR, JPEG starts with /9j/
        let mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' = 'image/png';
        if (imageData.startsWith('/9j/')) {
          mediaType = 'image/jpeg';
        } else if (imageData.startsWith('R0lGOD')) {
          mediaType = 'image/gif';
        } else if (imageData.startsWith('UklGR')) {
          mediaType = 'image/webp';
        }

        voiceLog('AI', 'Agent', `│ Including screen capture (${mediaType}, ${imageSizeKB}KB)`);
        messageContent.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: mediaType,
            data: imageData
          }
        });
      }
    }

    // Add text prompt
    messageContent.push({
      type: 'text',
      text: `${contextInfo}
User just said: "${userSpeech}"

Output JSON only:`
    });

    const result = await anthropic.messages.create({
      model: activeModel,  // Use passed model or default (defined at function start)
      max_tokens: 300,  // Allow more detailed responses when context is complex
      system: CLAUDE_CODE_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: messageContent
      }]
    });

    const responseText = result.content[0].type === 'text' ? result.content[0].text.trim() : '';
    const duration = Date.now() - startTime;

    voiceLog('AI', 'Agent', `│ AI responded in ${duration}ms`);

    // Parse JSON response
    let jsonStr = responseText;
    if (jsonStr.includes('```')) {
      const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) jsonStr = match[1].trim();
    }

    const parsed = JSON.parse(jsonStr) as VoiceAgentResponse;

    voiceLog('AI', 'Agent', `│ Decision: ${parsed.type.toUpperCase()}`);
    voiceLog('AI', 'Agent', `│ Content: "${parsed.content}"`);
    voiceLog('AI', 'Agent', '└───────────────────────────────');

    // Store in memory (async - may trigger compaction if needed)
    if (sessionId) {
      await addConversationTurn(sessionId, {
        timestamp: Date.now(),
        userSaid: userSpeech,
        agentAction: parsed
      });
    }

    return parsed;
  }

  try {
    // First try with image if available
    const hasImage = !!context?.screenCapture;
    return await callAgent(hasImage);
  } catch (error) {
    const errorStr = String(error);

    // If image processing failed, retry without the image
    if (context?.screenCapture && (errorStr.includes('Could not process image') || errorStr.includes('image'))) {
      voiceLog('AI', 'Agent', '│ Image processing failed, retrying without image...');
      try {
        return await callAgent(false);
      } catch (retryError) {
        voiceLog('ERROR', 'Agent', `Retry without image also failed: ${retryError}`);
        return { type: 'conversational', content: "Sorry, I had trouble processing that. Could you say it again?" };
      }
    }

    voiceLog('ERROR', 'Agent', `Processing failed: ${error}`);
    return { type: 'conversational', content: "Sorry, I didn't catch that. Could you try again?" };
  }
}

// ============================================================================
// RESPONSE SUMMARIZATION
// ============================================================================

export async function summarizeForVoice(
  response: string,
  sessionId?: string,
  verbosity: 'terse' | 'brief' | 'normal' | 'full' = 'brief',
  model?: string  // Optional model override
): Promise<string> {
  voiceLog('AI', 'Summary', '┌─── SUMMARIZING FOR VOICE ───');
  voiceLog('AI', 'Summary', `│ Input length: ${response.length} chars`);

  const hasCodeBlocks = response.includes('```');
  const isLong = response.length > 300;

  if (!anthropic || (!hasCodeBlocks && !isLong)) {
    const formatted = formatForSpeech(response);
    voiceLog('AI', 'Summary', `│ Using direct format (short/no code)`);
    voiceLog('AI', 'Summary', `│ Output: "${formatted.substring(0, 80)}..."`);
    voiceLog('AI', 'Summary', '└───────────────────────────────');
    return formatted;
  }

  const verbosityInstructions = {
    terse: 'Summarize in one sentence, maximum 15 words.',
    brief: 'Summarize in 2 short sentences. Focus on what was done.',
    normal: 'Summarize in 3 sentences. Cover what was done and key details.',
    full: 'Keep full response but make it speech-friendly. Remove code blocks.'
  };

  const startTime = Date.now();

  try {
    voiceLog('AI', 'Summary', `│ Calling AI for ${verbosity} summary...`);

    const result = await anthropic.messages.create({
      model: model || MODEL,  // Use passed model or default
      max_tokens: 150,
      system: `You convert AI coding assistant output to speech-friendly text.

Rules:
- Use first person: "I created...", "I found..."
- No code syntax, file paths, or technical formatting
- Natural conversational language
- Spell out: API→"A P I", JSON→"jason", HTML→"H T M L"
- Output ONLY the rewritten text`,
      messages: [{
        role: 'user',
        content: `${verbosityInstructions[verbosity]}

Rewrite for speech:
${response.substring(0, 1500)}`
      }]
    });

    const summary = result.content[0].type === 'text' ? result.content[0].text : response;
    const formatted = formatForSpeech(summary);
    const duration = Date.now() - startTime;

    voiceLog('AI', 'Summary', `│ Summarized in ${duration}ms`);
    voiceLog('AI', 'Summary', `│ Output: "${formatted.substring(0, 80)}..."`);
    voiceLog('AI', 'Summary', '└───────────────────────────────');

    // Update memory with the voice response
    if (sessionId) {
      updateLastTurnWithResponse(sessionId, response, formatted);
    }

    return formatted;
  } catch (error) {
    voiceLog('ERROR', 'Summary', `Summarization failed: ${error}`);
    return formatForSpeech(response);
  }
}

// ============================================================================
// TEXT FORMATTING
// ============================================================================

function formatForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\bAPI\b/gi, 'A P I')
    .replace(/\bJSON\b/gi, 'jason')
    .replace(/\bHTML\b/gi, 'H T M L')
    .replace(/\bCSS\b/gi, 'C S S')
    .replace(/\bURL\b/gi, 'U R L')
    .replace(/\bSQL\b/gi, 'sequel')
    .replace(/\bCLI\b/gi, 'command line')
    .replace(/\bNPM\b/gi, 'N P M')
    .replace(/\bSSH\b/gi, 'S S H')
    .replace(/\bTUI\b/gi, 'terminal interface')
    .replace(/[\/\\][\w\-\.\/\\]+\.(ts|tsx|js|jsx|py|json|md)/gi, match => {
      const parts = match.split(/[\/\\]/);
      return parts[parts.length - 1];
    })
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/[╭╮╰╯│─┌┐└┘├┤┬┴┼═╔╗╚╝╠╣╦╩╬]+/g, ' ')
    .replace(/[·✻✽✿✸⎿⏳]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ============================================================================
// SERVICE STATUS
// ============================================================================

export function isVoiceServiceAvailable(): { stt: boolean; tts: boolean; agent: boolean } {
  return {
    stt: !!OPENAI_API_KEY,
    tts: !!OPENAI_API_KEY,
    agent: !!ANTHROPIC_API_KEY
  };
}

// ============================================================================
// LEGACY SESSION MANAGEMENT (backward compatibility)
// ============================================================================

interface VoiceSession {
  id: string;
  projectId: string;
  projectPath: string;
  isActive: boolean;
  messageHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
}

const voiceSessions: Map<string, VoiceSession> = new Map();

export function createVoiceSession(projectId: string, projectPath: string): string {
  const sessionId = `voice-${Date.now().toString(36)}`;
  const session: VoiceSession = {
    id: sessionId,
    projectId,
    projectPath,
    isActive: true,
    messageHistory: []
  };
  voiceSessions.set(sessionId, session);
  voiceLog('INFO', 'Session', `Created legacy session ${sessionId}`);
  return sessionId;
}

export function getVoiceSession(sessionId: string): VoiceSession | undefined {
  return voiceSessions.get(sessionId);
}

export function closeVoiceSession(sessionId: string): void {
  const session = voiceSessions.get(sessionId);
  if (session) {
    session.isActive = false;
    voiceSessions.delete(sessionId);
    voiceLog('INFO', 'Session', `Closed legacy session ${sessionId}`);
  }
}

export async function processVoiceCommand(
  sessionId: string,
  userMessage: string,
  onProgress?: (text: string) => void,
  onAudio?: (audio: Buffer) => void
): Promise<{ text: string; audio?: Buffer }> {
  const session = voiceSessions.get(sessionId);
  if (!session) {
    throw new Error(`Voice session not found: ${sessionId}`);
  }

  session.messageHistory.push({ role: 'user', content: userMessage });
  const responseText = `Processing: ${userMessage}`;
  session.messageHistory.push({ role: 'assistant', content: responseText });

  let audioBuffer: Buffer | undefined;
  try {
    audioBuffer = await textToSpeech(responseText);
    if (onAudio) onAudio(audioBuffer);
  } catch (err) {
    voiceLog('ERROR', 'Legacy', `TTS failed: ${err}`);
  }

  return { text: responseText, audio: audioBuffer };
}

export default {
  transcribeAudio,
  textToSpeech,
  processVoiceInput,
  summarizeForVoice,
  isVoiceServiceAvailable,
  handleInterrupt,
  getConversationMemory,
  addConversationTurn,
  updateLastTurnWithResponse,
  clearConversationMemory,
  createVoiceSession,
  getVoiceSession,
  closeVoiceSession,
  processVoiceCommand
};
