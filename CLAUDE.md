# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Lora is a personal iOS app that provides a **terminal interface** to Claude Code from your iPhone. It connects to a WebSocket bridge server running on your PC (Windows/WSL) to provide a full PTY terminal experience with optional voice control.

**Key Components:**
- **mobile/**: Expo/React Native iOS app with terminal emulator
- **bridge-server/**: Node.js WebSocket server with node-pty + tmux for persistent terminal sessions
- **projects/**: Directory where project files are stored (created by Claude Code)
- **logs/**: Server and terminal logs for debugging

## Commands

### Unified Development (from project root)
```bash
npm run dev              # Start both bridge server and Expo with tunnel (recommended)
npm run install:all      # Install dependencies for all packages
```

### Mobile App (mobile/)
```bash
npm install              # Install dependencies
npx expo start           # Start Expo dev server
npx expo start --ios     # Start with iOS simulator
npx tsc --noEmit         # Type check without emitting
npx expo install --fix   # Fix package version mismatches
```

### Bridge Server (bridge-server/)
```bash
npm install              # Install dependencies
npm run build            # Compile TypeScript to dist/
npm start                # Run compiled server (port 8765)
npm run dev              # Run with ts-node (development)
```

### Firewall Rules
```powershell
# Windows Firewall
New-NetFirewallRule -DisplayName "Lora Bridge" -Direction Inbound -Port 8765 -Protocol TCP -Action Allow
```

```bash
# WSL/Linux (if using UFW)
sudo ufw allow 8765/tcp
```

## Architecture

```
┌─────────────────┐         WebSocket          ┌─────────────────────────────┐
│   Lora iOS App  │ ◄─────────────────────────►│   WSL/Linux/Windows PC      │
│   (mobile/)     │   (Tailscale/Local Net)    │                             │
│                 │                            │  ┌─────────────────────┐    │
│  ┌───────────┐  │                            │  │  bridge-server/     │    │
│  │ Terminal  │  │                            │  │  - WebSocket :8765  │    │
│  │ Component │  │                            │  │  - node-pty + tmux  │    │
│  └───────────┘  │                            │  │  - voice-service    │    │
│                 │                            │  └──────────┬──────────┘    │
│  ┌───────────┐  │                            │             │               │
│  │   Voice   │  │                            │             ▼               │
│  │   Mode    │  │                            │  ┌─────────────────────┐    │
│  └───────────┘  │                            │  │   tmux Sessions     │    │
└─────────────────┘                            │  │   (persistent)      │    │
                                               │  │   └─► Claude Code   │    │
                                               │  └─────────────────────┘    │
                                               │                             │
                                               │  📁 projects/               │
                                               │  📁 logs/                   │
                                               └─────────────────────────────┘
```

## Mobile App Architecture (mobile/)

**Navigation**: Expo Router with file-based routing in `app/`
- `app/(tabs)/` - Tab screens: Projects (index), Chat, Editor, Preview, Voice
- `app/settings.tsx` - Settings modal (bridge server URL)
- `app/project/[id].tsx` - Project detail page

**State Management**: Zustand stores in `stores/`
- `projectStore.ts` - Projects, files, current selection
- `chatStore.ts` - Chat/terminal output, streaming state
- `settingsStore.ts` - Bridge server URL, connection status

**Key Components** in `components/`:
- `terminal/Terminal.tsx` - xterm.js-based terminal in WebView with ANSI color support, iOS dictation handling, control buttons (Ctrl+C, Ctrl+D, arrows, Tab, Esc)

**Services** in `services/`:
- `claude/api.ts` - WebSocket client (`bridgeService`) for bridge server communication, handles terminal and voice callbacks
- `storage/projects.ts` - File system operations using expo-file-system
- `bundler/snack.ts` - Expo Snack API for live previews

**Theme**: Lovable-inspired light theme in `theme/` (colors, typography, spacing)

## Bridge Server Architecture (bridge-server/)

**Main server** (`src/server.ts`):
1. Accepts WebSocket connections from mobile app on port 8765
2. Manages projects (create, delete, list, file operations)
3. Manages terminal sessions with tmux + PTY hybrid approach
4. Handles voice-terminal integration for hands-free Claude Code control
5. Logs all activity to `logs/bridge-server.log` and `logs/terminal.log`

**Tmux Service** (`src/tmux-service.ts`):
- Session creation/destruction with `lora-` prefix
- Reliable command sending with separate Enter key
- Control key support (Ctrl+C, Ctrl+D, etc.)
- Output capture via `capture-pane`
- Response detection with output stability polling
- Session persistence across app disconnects

**Voice Service** (`src/voice-service.ts`):
- Speech-to-text via OpenAI Whisper API
- Text-to-speech via OpenAI TTS API (nova voice)
- Voice agent powered by Claude Haiku 4.5 for intent classification
- Conversation memory with auto-compaction at 200k tokens
- Screen capture support (receives phone screenshots for vision context)
- Six response types: `prompt`, `control`, `conversational`, `ignore`, `app_control`, `action_sequence`
- `action_sequence` enables multi-step operations (switch terminal + send command)
- App control allows voice agent to navigate tabs and interact with mobile UI

**Claude State Service** (`src/claude-state-service.ts`):
- Hook-based Claude Code state detection (more reliable than pattern matching)
- Watches `/tmp/lora-claude-state-{sessionName}.json` for state changes
- States: `idle`, `permission`, `processing`, `stopped`, `unknown`
- Falls back to pattern matching if hooks aren't working after 10 seconds

### Claude Code Hooks Integration
Each project gets `.claude/settings.json` with hooks that notify the bridge server of state changes:
- `SessionStart`: Writes marker file to verify hooks are working
- `Stop`: Fires immediately when Claude finishes (primary detection)
- `Notification (idle_prompt)`: Backup for 60-second idle detection

Hook state files are written to `/tmp/lora-claude-state-{sessionName}.json` and `/tmp/lora-hooks-ready-{sessionName}`.

### Session Persistence
- **Tmux sessions persist** when mobile app disconnects
- **Claude sessions are registered** per project for reconnection
- App reconnection auto-reattaches to existing Claude Code session
- PTY connects to tmux via `tmux attach` for real-time streaming

### Environment Variables
```bash
# Required for voice features
OPENAI_API_KEY=sk-...      # For Whisper STT and TTS
ANTHROPIC_API_KEY=sk-...   # For voice agent LLM

# Optional
PORT=8765                  # WebSocket port (default: 8765)
PROJECTS_DIR=...           # Projects directory (default: ../projects)
```

## Networking

**Recommended: Tailscale** for reliable iPhone-to-PC connection
- Install Tailscale on both PC and iPhone
- Connect using Tailscale IP: `ws://100.x.x.x:8765`

**Alternative: Local Network**
- Ensure iPhone and PC are on same WiFi
- Use PC's local IP: `ws://192.168.x.x:8765`

## Key Data Flow

1. User opens project in Projects tab
2. Chat tab shows PTY session connected via WebSocket
3. User types commands or uses voice (e.g., `claude "create a todo app"`)
4. Bridge server relays I/O between mobile app and tmux session
5. Terminal component parses ANSI codes for colored output
6. Files created by Claude Code appear in `projects/{project-id}/`

## Logging

All logs are stored in `logs/` directory (relative to project root):
- `bridge-server.log` - Connection events, terminal creation/exit, voice processing
- `terminal.log` - All terminal input/output (truncated for large outputs)

Logs are cleared on server restart.

## WebSocket Protocol

Messages between mobile app and bridge server use JSON with a `type` field:

**Client → Server:**
- `ping` - Heartbeat
- `create_project` / `delete_project` / `list_projects` - Project management
- `get_files` / `get_file_content` / `save_file` - File operations
- `terminal_create` - Spawn PTY+tmux session (with cols, rows, sandbox, autoStartClaude)
- `terminal_input` / `terminal_resize` / `terminal_close` - Terminal control
- `voice_status` - Check voice service availability
- `voice_terminal_enable` / `voice_terminal_disable` - Toggle voice mode on terminal
- `voice_terminal_audio` - Send audio to voice-enabled terminal (with optional `screenCapture` for vision)

**Server → Client:**
- `connected` - Initial connection with projects list
- `project_created` / `project_deleted` - Project operation confirmations
- `terminal_created` / `terminal_output` / `terminal_closed` - Terminal events
- `voice_status` - STT/TTS/agent availability
- `voice_terminal_enabled` / `voice_terminal_disabled` - Voice mode status
- `voice_transcription` - STT result
- `voice_terminal_speaking` - TTS audio response
- `voice_app_control` - App UI control command (navigate tabs, press buttons)
- `error` - Error messages

## Voice Agent Architecture (Critical Implementation Details)

### Multi-Action Sequences (`action_sequence` type)
The voice agent supports executing multiple actions sequentially (e.g., "go to terminal 1 and tell Claude to do X"):

**Server-side (`server.ts:1463-1605`):**
- Actions execute in order with tracking of `targetTmuxSession`
- When `switch_terminal` is detected, all subsequent actions use the new terminal
- Each action waits for completion before starting the next
- Final response uses `presentClaudeResponse()` for contextual attribution

**Client-side (`chat.tsx:445-560`):**
- `onAppControl` callback handles app control actions
- `switch_terminal` MUST navigate to Chat tab first: `router.push('/(tabs)/chat')`
- Then switches terminal index with haptic feedback
- Other actions: `navigate`, `send_input`, `send_control`, `new_terminal`, `close_terminal`, `take_screenshot`

**WebSocket Message Format:**
```typescript
// Server → Client (CRITICAL: field name is appControl, not appAction)
{
  type: 'voice_app_control',
  terminalId: string,
  appControl: {  // NOT appAction!
    action: string,
    target?: string,
    params?: Record<string, unknown>
  }
}
```

### Voice Response Attribution
- Use `presentClaudeResponse()` instead of `summarizeForVoice()` when presenting Claude Code's responses
- The voice agent intelligently varies attribution based on conversation context
- Never hard-code attribution like "Claude Code said:" - let the agent decide naturally
- Pass the user's original request as context for proper attribution

### JSON Parsing (Programmatic, Not AI-Reliant)
Voice agent responses use bulletproof JSON extraction (`voice-service.ts:1102-1134`):
- Finds first `{` and extracts complete JSON using brace depth tracking
- State machine parser handles escaped characters and strings correctly
- Self-correction: If validation fails, error is sent back to AI for retry
- Multi-step detection uses regex patterns, not AI instructions

### Conversation Memory
- Memory keyed by **projectId** (not terminalId) for persistence across terminals
- Auto-compaction at 200k tokens → 25k tokens
- Maintains `importantInfo` array for critical context
- Recent turns always preserved (minimum 5 turns after compaction)

## Code Conventions

- TypeScript throughout both projects
- React functional components with hooks
- StyleSheet.create for React Native styles (not inline styles)
- Zustand with persist middleware for state that survives app restarts
- expo-file-system new API: `Paths`, `Directory`, `File` classes (not legacy documentDirectory)
- ANSI escape sequence parsing for terminal colors (16-color and 24-bit RGB)

### Voice Service Conventions
- All voice agent fixes MUST be programmatic, not relying on AI instructions
- Use validation with semantic checks and self-correction retry loops
- Session IDs for voice: use `projectId` for cross-terminal persistence
- Model selection: Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) for voice agent, user-configurable for Claude Code

## Terminal Implementation Notes

The terminal uses xterm.js loaded in a WebView:
- Embedded HTML string with xterm.js from CDN
- iOS dictation deduplication logic (handles word-by-word replay)
- Control button bar with Ctrl, Shift modifiers (toggleable)
- Modifier combinations: Ctrl+arrows for word jump, etc.

## Debugging

### Hook Debug Logs
All hook activity is logged to `/tmp/lora-hook-debug.log`:
```bash
tail -f /tmp/lora-hook-debug.log
```

### Bridge Server Logs
```bash
tail -f logs/bridge-server.log
tail -f logs/terminal.log

# Filter for bridge server only when running unified dev
tail -f /tmp/lora-dev.log | grep "^\[bridge\]"
```

### Check if Hooks are Working
```bash
# SessionStart marker (created when Claude Code starts with working hooks)
ls -la /tmp/lora-hooks-ready-*

# Current Claude state
cat /tmp/lora-claude-state-lora-{projectId}.json
```

### Common Issues and Fixes

**Voice agent not switching terminals:**
- Check WebSocket message field name: must be `appControl` not `appAction`
- Verify mobile app callback receives the message: check for log `[Voice-Terminal] App control:`
- Ensure `switch_terminal` navigates to Chat tab first before switching terminal index

**Terminal commands going to wrong terminal in action sequences:**
- Verify `targetTmuxSession` is updated when `switch_terminal` is detected
- All subsequent prompt actions must use `targetTmuxSession`, not `session.tmuxSessionName`

**Voice agent responses not attributed to Claude Code:**
- Use `presentClaudeResponse()` with user's request as context
- Never hard-code "Claude Code said:" - let agent decide based on conversation flow

**JSON parsing errors from voice agent:**
- Ensure using programmatic extraction (`extractFirstJsonObject`) not regex
- Validation errors should trigger self-correction retry, not fail
- Check multi-step regex patterns match the user's input correctly

**Voice mode can't be terminated by pressing voice button:**
- The voice button can terminate voice mode in ANY state (listening, processing, working, speaking)
- If user navigates away from Terminal tab while voice is active, pressing the button will navigate back to Terminal for cleanup
- The chat component cleanup effect ensures voice is disabled on all terminals when mounting with voice off
- Check logs for `[VoiceButton] Interrupting voice mode` and `[Voice] Status changed to off, running cleanup`
