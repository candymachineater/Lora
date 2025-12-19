# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Lora is a personal iOS app that lets users build React Native/Expo apps from their iPhone using Claude AI. It consists of two parts:
- **mobile/**: Expo/React Native iOS app
- **bridge-server/**: Node.js WebSocket server that connects the mobile app to Claude Code CLI

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
npm start                # Run compiled server
npm run dev              # Run with ts-node (development)
```

### Windows Firewall (for bridge server)
```powershell
New-NetFirewallRule -DisplayName "Lora Bridge" -Direction Inbound -Port 8765 -Protocol TCP -Action Allow
```

## Architecture

```
┌─────────────────┐         WebSocket          ┌─────────────────────────┐
│   Lora iOS App  │ ◄─────────────────────────►│   Windows PC            │
│   (mobile/)     │      (Local Network)       │  ┌─────────────────┐   │
│                 │                            │  │ bridge-server/  │   │
└─────────────────┘                            │  └────────┬────────┘   │
                                               │           │            │
                                               │           ▼            │
                                               │  ┌─────────────────┐   │
                                               │  │   Claude Code   │   │
                                               │  │   (CLI/SDK)     │   │
                                               │  └─────────────────┘   │
                                               └─────────────────────────┘
```

## Mobile App Architecture (mobile/)

**Navigation**: Expo Router with file-based routing in `app/`
- `app/(tabs)/` - Tab screens: Projects, Chat, Editor, Preview
- `app/settings.tsx` - Settings modal
- `app/project/[id].tsx` - Project detail page

**State Management**: Zustand stores in `stores/`
- `projectStore.ts` - Projects, files, current selection
- `chatStore.ts` - Chat messages, streaming state
- `settingsStore.ts` - Bridge server URL, connection status

**Services** in `services/`:
- `claude/api.ts` - WebSocket client connecting to bridge server
- `claude/prompts.ts` - System prompts for React Native code generation
- `storage/projects.ts` - File system operations using expo-file-system
- `bundler/snack.ts` - Expo Snack API for live previews

**Theme**: Lovable-inspired light theme in `theme/` (colors, typography, spacing)

## Bridge Server Architecture (bridge-server/)

Single file server (`src/server.ts`) that:
1. Accepts WebSocket connections from mobile app
2. Spawns Claude Code CLI with `--print --output-format stream-json`
3. Streams responses back to mobile app
4. Handles ping/pong for connection health, cancel for aborting requests

## Key Data Flow

1. User types message in Chat screen
2. `claudeService.sendMessage()` sends via WebSocket to bridge server
3. Bridge server spawns `claude` CLI process with the prompt
4. Claude response streams back chunk by chunk
5. `useChatStore` appends chunks to display
6. Code blocks parsed from response can be applied to project files
7. Preview uploads project to Expo Snack and displays in WebView

## Code Conventions

- TypeScript throughout both projects
- React functional components with hooks
- StyleSheet.create for React Native styles (not inline styles)
- Zustand with persist middleware for state that survives app restarts
- expo-file-system new API: `Paths`, `Directory`, `File` classes (not legacy documentDirectory)
