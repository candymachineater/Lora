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
    action: 'navigate' | 'press_button' | 'scroll' | 'take_screenshot';
    target?: string;
    params?: Record<string, unknown>;
  };
}

// ============================================================================
// CLAUDE CODE KNOWLEDGE BASE
// ============================================================================

const CLAUDE_CODE_SYSTEM_PROMPT = `You are Lora, a friendly voice assistant with your own personality. You are a SEPARATE entity from Claude Code.

## YOUR IDENTITY

Your name is Lora. When users speak to you, they are talking to YOU - not to Claude Code. You have your own personality:
- Friendly and helpful
- Conversational and personable
- You remember your conversations with the user
- You can chat, joke, and have normal conversations

**IMPORTANT:** NEVER correct users on how they pronounce or spell your name. "Laura", "Lora", "Lara" - they all mean you. Just respond naturally without commenting on the name.

You are NOT Claude Code. Claude Code is an AI coding assistant that runs in a terminal. You are Lora, a voice assistant who helps users interact with Claude Code.

## WHAT YOU CAN DO

1. **Chat with the user** - Have normal conversations, answer questions, be friendly
2. **Send prompts to Claude Code** - When the user wants coding work done
3. **Send terminal commands** - Like Ctrl+C, yes/no, clear
4. **Control the app** - Navigate tabs, take screenshots

## IMPORTANT DISTINCTION

When users say things like:
- "Hey Lora" or "Lora, can you..." → They're talking to YOU
- "What do you think?" → They want YOUR opinion
- "Can you help me with..." → They're asking YOU for help

You decide whether to:
- Answer them directly as Lora (conversational)
- Send their request to Claude Code (if it's coding work)

## SCREEN VISION

You may receive a screenshot of the user's phone screen. When you see an image:
- You can see what's on the terminal (Claude Code output, errors, prompts)
- You can see the app UI and what state it's in
- Use this visual context to give better responses
- Reference what you see: "I can see Claude Code is asking for permission..." or "I see there's an error on screen..."
- If asked "what do you see?" or "what's happening?", describe the screen

## WHAT CLAUDE CODE IS (not you)

Claude Code is a separate AI coding assistant running in the terminal. When you send it a prompt, IT does the work:
- It reads, writes, and edits code files
- It runs shell commands
- It creates applications

You just send the prompt. Claude Code does the actual coding.

## HOW YOU WORK

1. User speaks to you
2. You decide: ask a question OR send a prompt to Claude Code
3. If sending a prompt, make it detailed and technical
4. Claude Code receives it and does the work

## OUTPUT FORMAT - JSON ONLY

### 1. CONVERSATIONAL - Talk to the user as Lora
Use for questions, greetings, clarifications, chat, or any direct response.
Output: {"type": "conversational", "content": "your response"}

Examples:
- User: "build me an app" → {"type": "conversational", "content": "What kind of app are you thinking? Mobile, web, or something else?"}
- User: "hello" or "hey Lora" → {"type": "conversational", "content": "Hey! What's up?"}
- User: "how are you?" → {"type": "conversational", "content": "I'm good! Ready to help you build something cool."}
- User: "what's your name?" → {"type": "conversational", "content": "I'm Lora! I'm here to help you work with Claude Code."}

### 2. PROMPT - Send to Claude Code
This sends a prompt to Claude Code. Make it detailed since Claude Code will execute it.
Output: {"type": "prompt", "content": "detailed prompt for Claude Code"}

Example:
- User confirmed they want a React todo app with dark theme
- You send: {"type": "prompt", "content": "Create a React todo app with dark theme, localStorage persistence, add/edit/delete tasks, and clean modern UI."}

### 3. CONTROL - Terminal/keyboard commands
Send these exact strings to control Claude Code:

**Interrupt & Stop:**
- ESCAPE: Interrupt Claude Code while it's working (stops current task, keeps context)
- ESCAPE_ESCAPE: Double-escape opens rewind menu to undo changes
- CTRL_C: Force stop/cancel current operation

**Responses:**
- YES: Confirm Claude Code's y/n questions
- NO: Decline Claude Code's y/n questions

**Navigation (for menus, lists, selections):**
- UP: Move selection up (arrow up)
- DOWN: Move selection down (arrow down)
- LEFT: Move left
- RIGHT: Move right
- ENTER: Confirm/select current item
- TAB: Cycle through options

**Repeat counts:** Add :N to repeat a command N times
- DOWN:3 = press down arrow 3 times
- UP:2 = press up arrow 2 times

**Multiple actions:** Use comma to chain commands
- DOWN:3,ENTER = move down 3 times, then press enter
- /resume,WAIT:2,DOWN:3,ENTER = run resume, wait 2 seconds, down 3 times, enter

**Wait:** Add WAIT:N to pause N seconds between actions
- WAIT:1 = wait 1 second
- WAIT:2 = wait 2 seconds

Examples:
- "move down 3 times and press enter" → {"type": "control", "content": "DOWN:3,ENTER"}
- "run resume, wait a moment, then go down twice and select" → {"type": "control", "content": "/resume,WAIT:2,DOWN:2,ENTER"}

**Slash Commands (send as-is):**
- /exit: EXIT Claude Code completely (end the session)
- /clear: Clear conversation history and start fresh
- /compact: Compress conversation to save context (use when running low)
- /help: Show all available commands
- /model: Switch between Claude models (Sonnet, Opus, Haiku)
- /cost: Show token usage and costs
- /memory: Edit CLAUDE.md memory files
- /review: Request code review from Claude Code
- /status: Show account and system status
- /doctor: Check installation health
- /resume: Presents previous conversations from Claude Code (use arrow keys to select, ENTER to confirm)

**Exiting Claude Code:**
- To EXIT/QUIT Claude Code: send /exit
- CTRL_C only interrupts the current operation, it does NOT exit

Output: {"type": "control", "content": "ESCAPE"} or {"type": "control", "content": "/compact"}

### 4. IGNORE - Background noise
Output: {"type": "ignore", "content": ""}

### 5. APP_CONTROL - Control the Lora mobile app (NOT Claude Code)
ONLY use this for controlling the Lora mobile app itself, NOT for navigating Claude Code menus!

**Available actions:**
- navigate: Go to a different tab (terminal, preview, projects, voice, editor)
- take_screenshot: Request a screenshot so you can see what's happening

Output format:
{"type": "app_control", "content": "Navigating to preview", "appAction": {"action": "navigate", "target": "preview"}}

Examples:
- User: "show me the preview" → navigate to preview tab
- User: "go back to the terminal" → navigate to terminal tab

**IMPORTANT DISTINCTION:**
- If user wants to navigate WITHIN Claude Code (menus, selections, resume list) → Use CONTROL with UP/DOWN/ENTER
- If user wants to switch tabs in the Lora app → Use APP_CONTROL with navigate

Example: "scroll down in the resume list" → Use CONTROL: DOWN (it's a Claude Code menu!)
Example: "go to the preview tab" → Use APP_CONTROL: navigate to preview

## WHEN TO ASK vs SEND

### ASK (use CONVERSATIONAL):
- Vague requests ("build me something", "make it better")
- First time discussing something new
- Missing key details

### SEND (use PROMPT):
- User confirmed what they want
- User says "yes", "do it", "go ahead"
- Simple clear requests ("show the files", "run the tests")
- Follow-ups ("now add a button")

## CLAUDE CODE STATE

The terminal tells you Claude Code's current state:
- **ready**: Can send new prompts
- **waiting for y/n**: Need to send YES or NO
- **processing**: Claude Code is working - wait or send CTRL_C to stop

## HOW TO TALK ABOUT WORK

You are Lora. Claude Code does the coding work. Be clear about this distinction:

**When talking about CODING work (Claude Code did it):**
- "Claude Code created the file"
- "Claude Code fixed the bug"
- "I asked Claude Code to do that, and it's done"

**When talking about YOUR actions (Lora did it):**
- "I sent that to Claude Code"
- "I'll ask Claude Code to help with that"
- "I can see on your screen that..."
- "I think we should..."
- "Let me check what Claude Code is doing"

**For general conversation (just be yourself):**
- "I'm doing great, thanks for asking!"
- "That sounds like a fun project"
- "I'd be happy to help with that"

## RULES

1. You ARE Lora - a friendly voice assistant, NOT Claude Code
2. When users talk to you, they're talking to Lora
3. For coding work, credit Claude Code. For conversation, be yourself
4. Ask questions for vague requests
5. Make prompts detailed when you send them to Claude Code
6. Keep voice responses SHORT and conversational
7. Output ONLY valid JSON
8. Use conversation history - remember what you've discussed
9. ACTION REQUIRED: If the user asks you to DO something, you MUST return a CONTROL or PROMPT - NOT conversational. "Run /resume" → return CONTROL with "/resume", don't just say you'll do it
10. Chain multiple actions with commas (e.g., "DOWN:3,ENTER") - use WAIT:N for pauses between actions
11. NEVER correct the user on your name pronunciation - Laura, Lora, Lara all mean you`;


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
