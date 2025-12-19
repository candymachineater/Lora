# Lora - Personal AI Mobile App Builder

## Project Overview

**Lora** is a personal iOS app that replicates Vibecode's functionality - allowing you to build, test, and iterate on React Native/Expo apps directly from your iPhone, powered by Claude AI.

### Key Features
- Chat-based app development with Claude AI
- Live on-device preview of generated apps
- Code editor with syntax highlighting
- Version control/rollback capability
- Project management (multiple apps)
- Export source code for external use

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    LORA iOS App                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │   Chat UI   │  │ Code Editor │  │  Preview    │         │
│  │  (Claude)   │  │  (Monaco)   │  │  (Expo)     │         │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘         │
│         │                │                │                 │
│  ┌──────┴────────────────┴────────────────┴──────┐         │
│  │              App State Manager                 │         │
│  │  (Projects, Files, Versions, Settings)        │         │
│  └──────────────────────┬────────────────────────┘         │
└─────────────────────────┼───────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          │               │               │
          ▼               ▼               ▼
    ┌───────────┐  ┌───────────────┐  ┌─────────────┐
    │ Claude    │  │ Local Bundle  │  │ Expo Snack  │
    │ API Proxy │  │ Server        │  │ Runtime     │
    │ (Backend) │  │ (On-device)   │  │ (Preview)   │
    └───────────┘  └───────────────┘  └─────────────┘
```

---

## Phase 1: Project Setup & Foundation

### 1.1 Initialize Expo Project
```bash
npx create-expo-app Lora --template blank-typescript
cd Lora
npx expo install expo-dev-client
```

### 1.2 Core Dependencies
```json
{
  "dependencies": {
    "expo": "~52.0.0",
    "expo-dev-client": "~4.0.0",
    "expo-file-system": "~18.0.0",
    "expo-secure-store": "~14.0.0",
    "@react-navigation/native": "^7.0.0",
    "@react-navigation/bottom-tabs": "^7.0.0",
    "react-native-gesture-handler": "~2.20.0",
    "react-native-reanimated": "~3.16.0",
    "zustand": "^5.0.0"
  }
}
```

### 1.3 Project Structure
```
Lora/
├── mobile/                    # iOS App (Expo)
│   ├── app/                   # Expo Router pages
│   │   ├── (tabs)/
│   │   │   ├── index.tsx      # Projects list
│   │   │   ├── chat.tsx       # Chat with Claude
│   │   │   ├── editor.tsx     # Code editor
│   │   │   └── preview.tsx    # App preview
│   │   ├── _layout.tsx
│   │   └── settings.tsx
│   ├── components/
│   │   ├── chat/
│   │   │   ├── ChatInput.tsx
│   │   │   ├── MessageBubble.tsx
│   │   │   └── CodeBlock.tsx
│   │   ├── editor/
│   │   │   ├── CodeEditor.tsx
│   │   │   ├── FileTree.tsx
│   │   │   └── TabBar.tsx
│   │   └── preview/
│   │       ├── PreviewFrame.tsx
│   │       └── DeviceFrame.tsx
│   ├── services/
│   │   ├── claude/
│   │   │   ├── api.ts         # WebSocket client
│   │   │   └── prompts.ts     # System prompts
│   │   ├── bundler/
│   │   │   └── snack.ts       # Expo Snack integration
│   │   └── storage/
│   │       ├── projects.ts    # Project CRUD
│   │       └── versions.ts    # Version control
│   ├── stores/
│   │   ├── projectStore.ts
│   │   ├── chatStore.ts
│   │   └── settingsStore.ts
│   └── types/
│       └── index.ts
│
└── bridge-server/             # Windows Bridge Server
    ├── src/
    │   ├── server.ts          # WebSocket server
    │   ├── claudeHandler.ts   # Claude Code SDK wrapper
    │   └── utils.ts           # Helper functions
    ├── package.json
    └── tsconfig.json
```

---

## Phase 2: Authentication & Claude Integration

### 2.1 Authentication Strategy: WebSocket to Windows Claude Code

**Architecture**: Your Windows PC runs Claude Code (using your Pro/Max subscription). A WebSocket bridge server runs alongside it, and the Lora iOS app connects to this bridge over your local network.

```
┌─────────────────┐         WebSocket          ┌─────────────────────────┐
│   Lora iOS App  │ ◄─────────────────────────►│   Windows PC            │
│                 │      (Local Network)       │  ┌─────────────────┐   │
│  - Chat UI      │                            │  │ WebSocket Bridge│   │
│  - Code Editor  │                            │  │    (Node.js)    │   │
│  - Preview      │                            │  └────────┬────────┘   │
└─────────────────┘                            │           │            │
                                               │           ▼            │
                                               │  ┌─────────────────┐   │
                                               │  │   Claude Code   │   │
                                               │  │   (CLI/SDK)     │   │
                                               │  └─────────────────┘   │
                                               └─────────────────────────┘
```

**Benefits**:
- Uses your existing Claude Pro/Max subscription
- No API keys needed in the mobile app
- Claude Code handles all authentication
- Full Claude Code capabilities (file access, tools, etc.)

### 2.2 Windows Bridge Server

Create a WebSocket server on Windows that wraps Claude Code SDK:

```typescript
// bridge-server/src/server.ts (runs on Windows)
import { WebSocketServer } from 'ws';
import { spawn } from 'child_process';

const PORT = 8765;
const wss = new WebSocketServer({ port: PORT });

console.log(`Lora Bridge Server running on ws://localhost:${PORT}`);

wss.on('connection', (ws) => {
  console.log('Lora iOS app connected');

  let claudeProcess: any = null;

  ws.on('message', async (data) => {
    const message = JSON.parse(data.toString());

    if (message.type === 'chat') {
      // Use Claude Code SDK in headless mode
      claudeProcess = spawn('claude', [
        '--print',
        '--output-format', 'stream-json',
        message.prompt
      ]);

      claudeProcess.stdout.on('data', (chunk: Buffer) => {
        ws.send(JSON.stringify({
          type: 'stream',
          content: chunk.toString()
        }));
      });

      claudeProcess.on('close', () => {
        ws.send(JSON.stringify({ type: 'done' }));
      });
    }
  });

  ws.on('close', () => {
    if (claudeProcess) claudeProcess.kill();
    console.log('Lora iOS app disconnected');
  });
});
```

### 2.3 iOS Claude Service (WebSocket Client)

```typescript
// services/claude/api.ts
import * as SecureStore from 'expo-secure-store';

class ClaudeService {
  private ws: WebSocket | null = null;
  private serverUrl: string = '';

  async connect(serverUrl: string): Promise<void> {
    this.serverUrl = serverUrl;
    await SecureStore.setItemAsync('bridge_server_url', serverUrl);

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(serverUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (error) => reject(error);
    });
  }

  async sendMessage(
    prompt: string,
    systemPrompt: string,
    onChunk: (chunk: string) => void
  ): Promise<string> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      const savedUrl = await SecureStore.getItemAsync('bridge_server_url');
      if (savedUrl) await this.connect(savedUrl);
      else throw new Error('Not connected to bridge server');
    }

    return new Promise((resolve, reject) => {
      let fullResponse = '';

      this.ws!.onmessage = (event) => {
        const message = JSON.parse(event.data);

        if (message.type === 'stream') {
          fullResponse += message.content;
          onChunk(message.content);
        } else if (message.type === 'done') {
          resolve(fullResponse);
        } else if (message.type === 'error') {
          reject(new Error(message.error));
        }
      };

      this.ws!.send(JSON.stringify({
        type: 'chat',
        prompt,
        systemPrompt
      }));
    });
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

export const claudeService = new ClaudeService();
```

### 2.3 System Prompts for Code Generation

```typescript
// services/claude/prompts.ts
export const REACT_NATIVE_SYSTEM_PROMPT = `You are an expert React Native/Expo developer assistant.

When generating code:
1. Use TypeScript with proper types
2. Use Expo SDK components when available
3. Follow React Native best practices
4. Use functional components with hooks
5. Output complete, runnable code

When asked to build an app:
1. First create App.tsx with the main component
2. Add any necessary screens/components
3. Include all imports
4. Use inline styles or StyleSheet

Format code output as:
\`\`\`typescript:filename.tsx
// code here
\`\`\`
`;
```

---

## Phase 3: Code Editor Implementation

### 3.1 Mobile Code Editor Options

1. **react-native-code-editor** - Monaco-based, full featured
2. **@expensify/react-native-live-markdown** - Lightweight
3. **Custom TextInput with syntax highlighting**

**Recommendation**: Start with a custom solution for simplicity, upgrade later.

### 3.2 File System Management

```typescript
// services/storage/projects.ts
import * as FileSystem from 'expo-file-system';

const PROJECTS_DIR = `${FileSystem.documentDirectory}projects/`;

export interface Project {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  files: ProjectFile[];
}

export interface ProjectFile {
  path: string;
  content: string;
  type: 'tsx' | 'ts' | 'json' | 'css';
}

export async function saveProject(project: Project): Promise<void> {
  const projectDir = `${PROJECTS_DIR}${project.id}/`;
  await FileSystem.makeDirectoryAsync(projectDir, { intermediates: true });

  for (const file of project.files) {
    await FileSystem.writeAsStringAsync(
      `${projectDir}${file.path}`,
      file.content
    );
  }

  // Save metadata
  await FileSystem.writeAsStringAsync(
    `${projectDir}manifest.json`,
    JSON.stringify({ ...project, files: project.files.map(f => f.path) })
  );
}
```

---

## Phase 4: On-Device Preview System

### 4.1 Preview Architecture Options

**Option A: Embedded React Native Runtime** (Complex)
- Bundle and execute RN code on-device
- Requires custom native module
- Similar to Expo Snack runtime

**Option B: WebView with React Native Web** (Simpler)
- Transform RN code to web-compatible
- Preview in WebView
- ~80% visual fidelity

**Option C: Expo Snack Integration** (Recommended)
- Use Expo Snack's public API
- Upload code to Snack
- Preview via Expo Go or embedded WebView

### 4.2 Recommended: Expo Snack Integration

```typescript
// services/bundler/snack.ts
const SNACK_API = 'https://snack.expo.dev/api/v2/snacks';

export async function createSnack(files: Record<string, string>): Promise<string> {
  const snackFiles: Record<string, { type: string; contents: string }> = {};

  for (const [path, content] of Object.entries(files)) {
    snackFiles[path] = {
      type: 'CODE',
      contents: content,
    };
  }

  const response = await fetch(SNACK_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Lora Preview',
      files: snackFiles,
      sdkVersion: '52.0.0',
    }),
  });

  const { id } = await response.json();
  return `https://snack.expo.dev/${id}`;
}
```

### 4.3 Preview Component

```typescript
// components/preview/PreviewFrame.tsx
import { WebView } from 'react-native-webview';

export function PreviewFrame({ snackUrl }: { snackUrl: string }) {
  return (
    <WebView
      source={{ uri: snackUrl }}
      style={{ flex: 1 }}
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
    />
  );
}
```

---

## Phase 5: Chat Interface & Conversation Management

### 5.1 Chat Store

```typescript
// stores/chatStore.ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  codeBlocks?: CodeBlock[];
  timestamp: Date;
}

interface ChatStore {
  messages: Message[];
  isStreaming: boolean;
  addMessage: (message: Message) => void;
  updateLastMessage: (content: string) => void;
  clearChat: () => void;
}

export const useChatStore = create<ChatStore>()(
  persist(
    (set) => ({
      messages: [],
      isStreaming: false,
      addMessage: (message) =>
        set((state) => ({ messages: [...state.messages, message] })),
      updateLastMessage: (content) =>
        set((state) => ({
          messages: state.messages.map((m, i) =>
            i === state.messages.length - 1 ? { ...m, content } : m
          ),
        })),
      clearChat: () => set({ messages: [] }),
    }),
    {
      name: 'chat-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
```

### 5.2 Code Block Extraction

```typescript
// utils/parseCodeBlocks.ts
export interface CodeBlock {
  filename: string;
  language: string;
  content: string;
}

export function parseCodeBlocks(text: string): CodeBlock[] {
  const regex = /```(\w+)?(?::([^\n]+))?\n([\s\S]*?)```/g;
  const blocks: CodeBlock[] = [];
  let match;

  while ((match = regex.exec(text)) !== null) {
    blocks.push({
      language: match[1] || 'typescript',
      filename: match[2] || 'App.tsx',
      content: match[3].trim(),
    });
  }

  return blocks;
}
```

---

## Phase 6: Version Control System

### 6.1 Simple Git-like Versioning

```typescript
// services/storage/versions.ts
export interface Version {
  id: string;
  projectId: string;
  message: string;
  timestamp: Date;
  files: Record<string, string>;
}

export async function createVersion(
  projectId: string,
  message: string
): Promise<Version> {
  const project = await loadProject(projectId);
  const version: Version = {
    id: crypto.randomUUID(),
    projectId,
    message,
    timestamp: new Date(),
    files: Object.fromEntries(
      project.files.map(f => [f.path, f.content])
    ),
  };

  // Save to versions directory
  await saveVersion(version);
  return version;
}

export async function restoreVersion(versionId: string): Promise<void> {
  const version = await loadVersion(versionId);
  const project = await loadProject(version.projectId);

  project.files = Object.entries(version.files).map(([path, content]) => ({
    path,
    content,
    type: path.split('.').pop() as 'tsx' | 'ts' | 'json',
  }));

  await saveProject(project);
}
```

---

## Phase 7: UI/UX Design

### 7.1 Tab Navigation
- **Projects** - List of all projects
- **Chat** - Conversation with Claude
- **Editor** - Code editor with file tree
- **Preview** - Live app preview

### 7.2 Color Scheme (Dark Mode Focus)
```typescript
const colors = {
  background: '#0D1117',
  surface: '#161B22',
  border: '#30363D',
  text: '#C9D1D9',
  textSecondary: '#8B949E',
  primary: '#58A6FF',
  success: '#3FB950',
  error: '#F85149',
  warning: '#D29922',
};
```

---

## Implementation Phases

### Phase 1: Windows Bridge Server
- [ ] Create bridge-server directory structure
- [ ] Initialize Node.js/TypeScript project
- [ ] Implement WebSocket server with ws library
- [ ] Create Claude Code SDK wrapper (spawn claude CLI)
- [ ] Handle streaming responses
- [ ] Add connection status/health endpoint
- [ ] Test bridge server locally

### Phase 2: iOS App Foundation
- [ ] Initialize Expo project with TypeScript (mobile/)
- [ ] Set up navigation (Expo Router with tabs)
- [ ] Create basic tab structure (Projects, Chat, Editor, Preview)
- [ ] Implement settings screen with bridge server URL input
- [ ] Set up Zustand stores (project, chat, settings)
- [ ] Create connection manager for WebSocket

### Phase 3: Claude Integration
- [ ] Implement WebSocket client service
- [ ] Handle streaming message chunks
- [ ] Create system prompts for React Native code generation
- [ ] Build chat UI with message bubbles
- [ ] Parse and display code blocks from responses
- [ ] Add "Apply to Project" button for code blocks

### Phase 4: Code Editor
- [ ] Implement file system storage (expo-file-system)
- [ ] Create code editor component with TextInput
- [ ] Add basic syntax highlighting
- [ ] Build file tree navigation
- [ ] Implement file CRUD operations
- [ ] Add project management (create/delete/rename)

### Phase 5: Preview System
- [ ] Integrate Expo Snack API for preview
- [ ] Create preview WebView component
- [ ] Add "Preview" button that uploads to Snack
- [ ] Show QR code for Expo Go testing
- [ ] Implement auto-preview on save (optional)

### Phase 6: Polish & Testing
- [ ] Add version control (snapshots)
- [ ] Implement project export (zip download)
- [ ] Connection error handling & reconnection
- [ ] Performance optimization
- [ ] Test end-to-end flow on real device

---

## Windows Bridge Server Setup

### Prerequisites
- Node.js 18+ installed on Windows
- Claude Code CLI installed and authenticated (`claude login`)
- WSL2 or native Windows Node.js

### Installation
```bash
cd bridge-server
npm install
npm run build
npm start
```

### Running as Background Service
```powershell
# PowerShell - Run in background
Start-Process -NoNewWindow -FilePath "node" -ArgumentList "dist/server.js"

# Or use PM2 for process management
npm install -g pm2
pm2 start dist/server.js --name "lora-bridge"
pm2 save
```

### Firewall Configuration
```powershell
# Allow port 8765 through Windows Firewall
New-NetFirewallRule -DisplayName "Lora Bridge" -Direction Inbound -Port 8765 -Protocol TCP -Action Allow
```

### Finding Your IP Address
```powershell
# Get your local IP for iOS app connection
ipconfig | findstr /i "IPv4"
# Use this IP in the Lora app settings, e.g., ws://192.168.1.100:8765
```

---

## Key Files to Create

### Bridge Server (Windows)
1. `bridge-server/package.json` - Dependencies
2. `bridge-server/src/server.ts` - WebSocket server
3. `bridge-server/src/claudeHandler.ts` - Claude Code wrapper

### Mobile App (iOS)
4. `mobile/app/(tabs)/index.tsx` - Projects list screen
5. `mobile/app/(tabs)/chat.tsx` - Chat with Claude
6. `mobile/app/(tabs)/editor.tsx` - Code editor
7. `mobile/app/(tabs)/preview.tsx` - App preview
8. `mobile/app/settings.tsx` - Bridge server URL settings
9. `mobile/services/claude/api.ts` - WebSocket client
10. `mobile/services/claude/prompts.ts` - System prompts
11. `mobile/services/storage/projects.ts` - Project management
12. `mobile/services/bundler/snack.ts` - Expo Snack integration
13. `mobile/stores/projectStore.ts` - Project state
14. `mobile/stores/chatStore.ts` - Chat state
15. `mobile/stores/settingsStore.ts` - Settings state
16. `mobile/components/chat/ChatInput.tsx` - Chat input
17. `mobile/components/chat/MessageBubble.tsx` - Message display
18. `mobile/components/editor/CodeEditor.tsx` - Code editor
19. `mobile/components/preview/PreviewFrame.tsx` - Preview WebView

---

## GitHub Repository Setup

Create the Lora repository:
```bash
# Initialize git in the Lora directory
cd /home/iahme/Repos/Lora
git init

# Create initial commit
git add .
git commit -m "Initial commit: Lora - Personal AI Mobile App Builder

Features:
- iOS app for building React Native apps with AI
- WebSocket bridge to Claude Code on Windows
- On-device preview via Expo Snack
- Project management with version control"

# Create and push to GitHub
gh repo create Lora --public --source=. --push
```

### Repository Structure After Setup
```
Lora/
├── README.md
├── .gitignore
├── mobile/          # Expo app
└── bridge-server/   # Windows server
```

---

## References

- [Vibecode App](https://apps.apple.com/us/app/vibecode-ai-app-builder/id6742912146)
- [Expo Snack](https://snack.expo.dev/)
- [Claude API Docs](https://docs.anthropic.com/en/api/getting-started)
- [Expo Documentation](https://docs.expo.dev/)
- [anthropic-react-native](https://github.com/backmesh/anthropic-react-native)
