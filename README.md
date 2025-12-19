# Lora - Personal AI Mobile App Builder

Lora is a personal iOS app that lets you build, test, and iterate on React Native/Expo apps directly from your iPhone, powered by Claude AI.

## Features

- **Chat-based development** - Describe what you want to build and Claude generates the code
- **Live on-device preview** - Test your apps instantly via Expo Snack
- **Code editor** - View and edit generated code with syntax highlighting
- **Version control** - Rollback to previous versions of your project
- **Project management** - Work on multiple apps simultaneously

## Architecture

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

## Project Structure

```
Lora/
├── mobile/              # iOS App (Expo/React Native)
│   ├── app/             # Expo Router pages
│   ├── components/      # UI components
│   ├── services/        # API and storage services
│   └── stores/          # Zustand state management
│
└── bridge-server/       # Windows Bridge Server
    └── src/             # WebSocket server code
```

## Prerequisites

- **Windows PC**: Node.js 18+, Claude Code CLI installed and authenticated
- **iPhone**: iOS 17+ with Expo Go app installed
- **Claude Subscription**: Pro or Max plan for Claude Code access

## Quick Start

### 1. Set up the Bridge Server (Windows)

```bash
# Navigate to bridge server
cd bridge-server

# Install dependencies
npm install

# Build TypeScript
npm run build

# Start the server
npm start
```

The server will display your local IP address for connecting from the iOS app.

### 2. Configure Windows Firewall

```powershell
# Allow port 8765 through Windows Firewall
New-NetFirewallRule -DisplayName "Lora Bridge" -Direction Inbound -Port 8765 -Protocol TCP -Action Allow
```

### 3. Set up the Mobile App

```bash
# Navigate to mobile app
cd mobile

# Install dependencies
npm install

# Start Expo development server
npx expo start
```

### 4. Connect from iPhone

1. Install Expo Go from the App Store
2. Scan the QR code from the Expo dev server
3. In Lora settings, enter your PC's IP address: `ws://192.168.x.x:8765`
4. Start building apps with Claude!

## Usage

1. **Create a new project** in the Projects tab
2. **Chat with Claude** to describe your app idea
3. **Apply code blocks** from Claude's responses to your project
4. **Preview** your app in Expo Go
5. **Iterate** by requesting changes and improvements

## Running Bridge Server as Background Service

### Using PM2 (Recommended)

```bash
npm install -g pm2
pm2 start dist/server.js --name "lora-bridge"
pm2 save
pm2 startup  # Run the command it outputs to enable auto-start
```

### Using PowerShell

```powershell
Start-Process -NoNewWindow -FilePath "node" -ArgumentList "dist/server.js"
```

## Development

### Bridge Server Development

```bash
cd bridge-server
npm run dev  # Uses ts-node for hot reloading
```

### Mobile App Development

```bash
cd mobile
npx expo start --dev-client
```

## Tech Stack

- **Mobile**: React Native, Expo, TypeScript, Zustand
- **Bridge Server**: Node.js, WebSocket (ws), TypeScript
- **AI**: Claude Code CLI/SDK
- **Preview**: Expo Snack API

## License

MIT - Personal use only

## Acknowledgments

Inspired by [Vibecode](https://apps.apple.com/us/app/vibecode-ai-app-builder/id6742912146) and [Lovable](https://lovable.dev/).
