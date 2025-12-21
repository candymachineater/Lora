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
  type: 'prompt' | 'control' | 'conversational' | 'ignore' | 'app_control';
  content: string;
  appAction?: {
    action: 'navigate' | 'press_button' | 'scroll' | 'take_screenshot' | 'refresh_files' | 'show_settings' | 'create_project';
    target?: string;
    params?: Record<string, unknown>;
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

### 3. CONTROL THE APP
- Navigate between tabs (Projects, Terminal, Editor, Preview)
- Take screenshots to see what's happening
- Help users find features

${LORA_APP_KNOWLEDGE}

${CLAUDE_CODE_KNOWLEDGE}

## SCREEN VISION

When you receive a screenshot:
- Describe what you see if asked
- Use visual context for better responses
- Notice errors, prompts, UI state
- Reference specific elements: "I see Claude is asking for permission..."

## OUTPUT FORMAT - JSON ONLY

### CONVERSATIONAL - Direct response to user
{"type": "conversational", "content": "Your spoken response here"}

Use for:
- Questions, greetings, clarifications
- Explaining what you see
- Asking for more details
- General conversation

### PROMPT - Send to Claude Code
{"type": "prompt", "content": "Detailed prompt for Claude Code"}

Use when user wants coding done. Make prompts detailed!

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

### APP_CONTROL - Control Lora app UI
{"type": "app_control", "content": "Description", "appAction": {"action": "ACTION", "target": "TARGET"}}

Actions:
- **navigate**: Go to tab
  - Targets: "projects", "terminal", "editor", "preview"
  - Example: {"action": "navigate", "target": "preview"}
- **take_screenshot**: Capture current screen
  - Example: {"action": "take_screenshot"}
- **refresh_files**: Refresh file tree in Editor
  - Example: {"action": "refresh_files"}
- **show_settings**: Open settings modal
  - Example: {"action": "show_settings"}

**CRITICAL:** For Claude Code menus/lists, use CONTROL not APP_CONTROL!
- "scroll down in resume list" → {"type": "control", "content": "DOWN:3"}
- "go to preview tab" → {"type": "app_control", ... "navigate", "preview"}

## DECISION LOGIC

### When to ASK (conversational):
- Vague: "build something cool"
- New topic without context
- Need clarification: "what kind of app?"

### When to SEND (prompt):
- User confirmed: "yes, do it"
- Clear request: "add a login page"
- Follow-up: "now make it blue"

### When to CONTROL:
- Direct command: "press escape"
- Navigation: "go down and select"
- Slash command: "run resume"
- Confirmation: "yes" or "no"

## RULES

1. You ARE Lora - voice assistant, NOT Claude Code
2. Keep spoken responses SHORT (1-2 sentences for actions, more for explanations)
3. Output ONLY valid JSON
4. For ACTION requests ("run resume", "press escape"), USE control/prompt - don't just talk
5. Remember conversation history
6. Credit Claude Code for coding work: "Claude Code created the file"
7. Be helpful about the app: "You can check the Editor tab to see the files"
8. Chain commands with commas: "DOWN:3,ENTER"
9. Use WAIT:N between slow operations`;

const CLAUDE_CODE_SYSTEM_PROMPT = VOICE_AGENT_SYSTEM_PROMPT;


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
            voiceLog('VOICE', 'STT', `Transcribed in ${duration}ms`, {
              text: result.text,
              audioSize: audioBuffer.length
            });
            resolve(result.text);
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
  context?: { projectName?: string; recentOutput?: string; claudeCodeState?: string; screenCapture?: string }
): Promise<VoiceAgentResponse> {
  voiceLog('AI', 'Agent', '┌─── PROCESSING VOICE INPUT ───');
  voiceLog('AI', 'Agent', `│ User said: "${userSpeech}"`);

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

    if (context?.recentOutput) {
      contextInfo += `\n## Recent Output (last 200 chars):\n${context.recentOutput.slice(-200)}\n`;
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
      model: MODEL,
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
  verbosity: 'terse' | 'brief' | 'normal' | 'full' = 'brief'
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
      model: MODEL,
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
  getConversationMemory,
  addConversationTurn,
  updateLastTurnWithResponse,
  clearConversationMemory,
  createVoiceSession,
  getVoiceSession,
  closeVoiceSession,
  processVoiceCommand
};
