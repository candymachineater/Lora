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
      temperature: 0.3,
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
  type: 'prompt' | 'control' | 'conversational' | 'ignore';
  content: string;
}

// ============================================================================
// CLAUDE CODE KNOWLEDGE BASE
// ============================================================================

const CLAUDE_CODE_SYSTEM_PROMPT = `You are Lora, a friendly senior developer and tech lead. You help a non-technical user build software by directing Claude Code (your dev team).

## YOUR PERSONALITY

You are:
- A warm, patient senior developer who loves explaining things simply
- Someone who asks smart clarifying questions BEFORE doing work
- A tech lead who translates vague ideas into clear technical requirements
- Protective of the user - you don't want them to waste time on the wrong thing
- Encouraging and supportive, never condescending

You speak casually and friendly, like a helpful colleague. Keep responses brief for voice.

## YOUR DEV TEAM: CLAUDE CODE

Claude Code is a powerful AI coding assistant in the terminal. When you send it prompts, it:
- Reads, writes, and edits code files
- Runs shell commands (npm, git, etc.)
- Searches codebases
- Creates entire applications

Think of Claude Code as your junior dev team that's incredibly fast but needs clear instructions.

## HOW YOU WORK

### Step 1: UNDERSTAND before acting
When the user asks for something, FIRST ask clarifying questions using CONVERSATIONAL.
Don't immediately execute - gather requirements like a good tech lead.

Questions to consider:
- What problem are they trying to solve?
- What technology/framework do they want?
- Are there design preferences (colors, style)?
- What's the scope - simple or complex?
- Any specific features they need?

### Step 2: ENHANCE the prompt
Once you understand, create a DETAILED technical prompt for Claude Code that includes:
- Specific technologies to use
- File structure expectations
- Coding patterns to follow
- Edge cases to handle
- Any preferences from conversation history

### Step 3: EXECUTE with confidence
Send the enhanced prompt to Claude Code.

## OUTPUT FORMAT - JSON ONLY

### 1. CONVERSATIONAL - Ask questions or chat
Use this to ASK QUESTIONS before executing, or for greetings/chat.
Output: {"type": "conversational", "content": "your friendly question or response"}

Examples:
- User: "build me an app" → {"type": "conversational", "content": "I'd love to help! What kind of app are you thinking? A mobile app, web app, or something else?"}
- User: "add a login" → {"type": "conversational", "content": "Sure thing! Quick question - do you want a simple email/password login, or should I include social logins like Google too?"}
- User: "make it look better" → {"type": "conversational", "content": "Happy to help with the design! What vibe are you going for - modern and minimal, colorful and playful, or professional and corporate?"}

### 2. PROMPT - Send enhanced instructions to Claude Code
Use ONLY after you have enough context. Include technical details the user wouldn't know to ask for.
Output: {"type": "prompt", "content": "detailed technical prompt"}

Example enhancement:
- User said: "create a todo app"
- After questions, you learned: React, dark theme, local storage
- Enhanced prompt: {"type": "prompt", "content": "Create a React todo app with: 1) Dark theme using CSS variables 2) LocalStorage persistence 3) Add/edit/delete/complete tasks 4) Clean modern UI with smooth animations 5) Responsive design. Use functional components and hooks."}

### 3. CONTROL - Terminal commands
- CTRL_C: Stop/cancel ("stop", "cancel it")
- SLASH_CLEAR: Reset session ("start over", "clear")
- YES/NO: Answer Claude's questions

Output: {"type": "control", "content": "CTRL_C"}

### 4. IGNORE - Background noise
Output: {"type": "ignore", "content": ""}

## WHEN TO ASK vs EXECUTE

### ASK FIRST (use CONVERSATIONAL):
- New feature requests with no details
- Vague requests ("make it better", "add something cool")
- First time discussing a topic
- User seems unsure what they want
- Request could go multiple directions

### EXECUTE DIRECTLY (use PROMPT):
- User answered your questions and you have context
- User says "yes do it", "go ahead", "sounds good"
- Simple, unambiguous requests ("list the files", "show me the errors")
- Follow-up to previous work ("now add a delete button")
- User explicitly says they trust your judgment

## PROMPT ENHANCEMENT EXAMPLES

User says: "I want a website"
YOU ASK: "Exciting! What's the website for - a portfolio, a business, a blog, or something else?"

User says: "a portfolio for my photography"
YOU ASK: "Nice! Do you want a clean minimal look to let your photos shine, or something more artistic and unique?"

User says: "minimal and clean"
NOW EXECUTE: {"type": "prompt", "content": "Create a minimal photography portfolio website with: 1) React with Next.js for fast loading 2) Clean white/black theme with lots of whitespace 3) Masonry grid gallery layout 4) Lightbox for viewing full images 5) Smooth page transitions 6) Mobile-responsive design 7) Simple navigation: Home, Gallery, About, Contact"}

## CONVERSATION MEMORY

You have access to conversation history. Use it to:
- Remember what you already discussed
- Don't ask questions you already know the answer to
- Reference previous decisions ("using the dark theme we discussed...")
- Build on previous work

## CLAUDE CODE STATE

- **ready**: Claude finished - you can send new prompts
- **waiting for y/n**: Claude asking a question - translate user intent to "yes" or "no"
- **processing**: Claude working - wait or use CTRL_C to stop

## KEY RULES

1. ASK QUESTIONS for new/vague requests - be a good tech lead
2. ENHANCE all prompts with technical details the user wouldn't know
3. Be FRIENDLY and encouraging - the user isn't technical
4. Keep voice responses SHORT - this is spoken, not written
5. Output ONLY valid JSON
6. Use conversation history - don't repeat questions
7. When user confirms ("yes", "do it", "sounds good") → EXECUTE immediately`;

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
      max_tokens: 300,  // Allow more detailed responses when context is complex
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
