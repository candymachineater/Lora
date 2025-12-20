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
- Text-to-speech via OpenAI TTS API
- Voice agent powered by Claude Sonnet for intent classification
- Conversation memory for context-aware interactions
- Four response types: `prompt`, `control`, `conversational`, `ignore`

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
- `voice_terminal_audio` - Send audio to voice-enabled terminal

**Server → Client:**
- `connected` - Initial connection with projects list
- `project_created` / `project_deleted` - Project operation confirmations
- `terminal_created` / `terminal_output` / `terminal_closed` - Terminal events
- `voice_status` - STT/TTS/agent availability
- `voice_terminal_enabled` / `voice_terminal_disabled` - Voice mode status
- `voice_transcription` - STT result
- `voice_terminal_speaking` - TTS audio response
- `error` - Error messages

## Code Conventions

- TypeScript throughout both projects
- React functional components with hooks
- StyleSheet.create for React Native styles (not inline styles)
- Zustand with persist middleware for state that survives app restarts
- expo-file-system new API: `Paths`, `Directory`, `File` classes (not legacy documentDirectory)
- ANSI escape sequence parsing for terminal colors (16-color and 24-bit RGB)

## Terminal Implementation Notes

The terminal uses xterm.js loaded in a WebView:
- Embedded HTML string with xterm.js from CDN
- iOS dictation deduplication logic (handles word-by-word replay)
- Control button bar with Ctrl, Shift modifiers (toggleable)
- Modifier combinations: Ctrl+arrows for word jump, etc.
