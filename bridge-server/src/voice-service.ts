/**
 * Voice Service for Lora Bridge Server
 *
 * Enhanced with:
 * - Comprehensive logging for debugging
 * - Conversation memory for context awareness
 * - Intelligent processing with history
 *
 * Uses:
 * - Claude Sonnet 4.5 for all AI tasks
 * - Whisper STT (Speech-to-Text)
 * - OpenAI TTS (Text-to-Speech)
 */

import Anthropic from '@anthropic-ai/sdk';
import * as https from 'https';

// Environment configuration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Single LLM for all AI tasks - Claude Sonnet 4.5
const MODEL = 'claude-sonnet-4-20250514';

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
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      temperature: 0.3,
      system: `You are summarizing a voice conversation with an AI coding assistant. Create a concise but comprehensive summary that preserves:
1. Key topics discussed
2. Important user preferences or requirements mentioned
3. Significant decisions made
4. Any code files, features, or projects mentioned
5. The overall context and purpose of the conversation

Keep the summary under 1500 words. Format as bullet points for easy scanning.`,
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
    history += '\n## Important Context from Conversation:\n';
    memory.importantInfo.forEach(info => {
      history += `- ${info}\n`;
    });
  }

  // Include recent turns
  if (memory.turns.length > 0) {
    history += '\n## Recent Conversation:\n';
    memory.turns.forEach((turn, i) => {
      history += `${i + 1}. User: "${turn.userSaid}"\n`;
      if (turn.agentAction.type === 'prompt') {
        history += `   → Sent to Claude Code: "${turn.agentAction.content}"\n`;
      } else if (turn.agentAction.type === 'control') {
        history += `   → Control: ${turn.agentAction.content}\n`;
      }
      if (turn.voiceResponse) {
        history += `   → Response: "${turn.voiceResponse.substring(0, 150)}..."\n`;
      }
    });
  }

  // Add memory stats for debugging
  if (history) {
    history += `\n[Memory: ${memory.turns.length} turns, ~${memory.totalTokensUsed} tokens, ${memory.compactionCount} compactions]\n`;
  }

  return history;
}

// ============================================================================
// VOICE AGENT TYPES
// ============================================================================

export interface VoiceAgentResponse {
  type: 'prompt' | 'control' | 'conversational' | 'ignore';
  content: string;
}

// ============================================================================
// CLAUDE CODE KNOWLEDGE BASE
// ============================================================================

const CLAUDE_CODE_SYSTEM_PROMPT = `You are Lora, a voice interface for Claude Code. You have DEEP knowledge of Claude Code and help users control it with their voice.

## WHAT IS CLAUDE CODE?

Claude Code is Anthropic's official AI-powered command-line interface (CLI) for coding. It runs in a terminal and provides an agentic coding experience where users type natural language and Claude Code performs actions.

### How Claude Code Works
1. User types a natural language prompt (e.g., "create a todo app")
2. Claude Code analyzes the request
3. Claude Code uses TOOLS to complete the task:
   - Read: Reads file contents
   - Write: Creates new files
   - Edit: Modifies existing files
   - Bash: Runs shell commands (npm, git, etc.)
   - Glob: Finds files by pattern
   - Grep: Searches file contents
   - WebFetch: Fetches web pages
   - WebSearch: Searches the internet
4. Claude Code shows progress with tool usage boxes
5. Claude Code outputs its response with what it did

### All Claude Code Slash Commands
/help - Show all available commands
/clear - Clear conversation, start fresh
/init - Initialize project with CLAUDE.md
/cost - Show token usage and cost
/compact - Toggle compact mode
/memory - Manage persistent memory
/config - View/modify configuration

### Keyboard Shortcuts
- Ctrl+C: Cancel/interrupt current operation
- Ctrl+D: Exit Claude Code
- Escape: Cancel prompt input
- Up/Down: Navigate history

## YOUR ROLE AS VOICE INTERFACE

You translate voice input into appropriate actions. Output a JSON response with one of four types:

### 1. PROMPT - Send natural language to Claude Code
Use for ANY coding task. Keep prompts close to what user said.
Output: {"type": "prompt", "content": "the prompt"}

Examples:
- "list files" → {"type": "prompt", "content": "list all files"}
- "create a todo app" → {"type": "prompt", "content": "create a todo app"}
- "fix the error" → {"type": "prompt", "content": "fix the error"}
- "what's in this file" → {"type": "prompt", "content": "show this file"}

### 2. CONTROL - Terminal control commands
Available controls:
- CTRL_C: Interrupt/cancel ("stop", "cancel", "interrupt")
- ESCAPE: Press escape ("escape", "nevermind", "go back")
- SLASH_CLEAR: /clear command ("clear", "start fresh", "reset")
- SLASH_HELP: /help command ("help", "show commands")
- SLASH_COST: /cost command ("cost", "how much")

Output: {"type": "control", "content": "CTRL_C"}

### 3. CONVERSATIONAL - Direct response to user
ONLY for simple greetings, not coding questions.
Output: {"type": "conversational", "content": "brief response"}

Examples:
- "hello" → {"type": "conversational", "content": "Hi! What would you like to build?"}
- "thanks" → {"type": "conversational", "content": "You're welcome!"}

### 4. IGNORE - Audio artifacts
For transcription errors, background noise.
Output: {"type": "ignore", "content": ""}

Common artifacts: "thanks for watching", "[music]", "um", single meaningless words

## CONVERSATION AWARENESS

You have access to the recent conversation history. Use this context to:
- Understand follow-up questions ("do that again", "now fix it")
- Remember what was just discussed
- Provide coherent multi-turn interactions

## CLAUDE CODE STATE AWARENESS

You will be given Claude Code's current state:
- **ready for input**: Claude finished and is waiting for your next command. Send PROMPT.
- **waiting for confirmation (y/n)**: Claude is asking a yes/no question.
  - If user says "yes", "yeah", "sure", "do it", "go ahead" → PROMPT with "yes"
  - If user says "no", "nope", "cancel", "don't" → PROMPT with "no"
- **still processing**: Claude is working. Consider using CONTROL (CTRL_C to interrupt) or wait.
- **session ended**: Claude session has ended. May need CONTROL (RESTART).

## RULES

1. When in doubt, use PROMPT - Claude Code is smart
2. Keep prompts natural and concise
3. NEVER output shell commands yourself
4. Only use CONVERSATIONAL for greetings
5. Output ONLY valid JSON, nothing else
6. Use conversation history for context
7. When Claude is "waiting for confirmation", translate user's intent to "yes" or "no"
8. If user wants to interrupt during processing, use CONTROL with CTRL_C`;

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
  context?: { projectName?: string; recentOutput?: string; claudeCodeState?: string }
): Promise<VoiceAgentResponse> {
  voiceLog('AI', 'Agent', '┌─── PROCESSING VOICE INPUT ───');
  voiceLog('AI', 'Agent', `│ User said: "${userSpeech}"`);

  if (!anthropic) {
    voiceLog('AI', 'Agent', '│ No Anthropic API, falling back to prompt');
    voiceLog('AI', 'Agent', '└───────────────────────────────');
    return { type: 'prompt', content: userSpeech };
  }

  const startTime = Date.now();

  try {
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

    voiceLog('AI', 'Agent', '│ Calling Claude Sonnet 4.5...');

    const result = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 200,
      system: CLAUDE_CODE_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `${contextInfo}
User just said: "${userSpeech}"

Output JSON only:`
      }]
    });

    const responseText = result.content[0].type === 'text' ? result.content[0].text.trim() : '';
    const duration = Date.now() - startTime;

    voiceLog('AI', 'Agent', `│ AI responded in ${duration}ms`);

    // Parse JSON response
    try {
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
    } catch (parseError) {
      voiceLog('AI', 'Agent', `│ JSON parse failed, using as prompt`);
      voiceLog('AI', 'Agent', `│ Raw: ${responseText.substring(0, 100)}`);
      voiceLog('AI', 'Agent', '└───────────────────────────────');
      return { type: 'prompt', content: responseText || userSpeech };
    }
  } catch (error) {
    voiceLog('ERROR', 'Agent', `Processing failed: ${error}`);
    return { type: 'prompt', content: userSpeech };
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
