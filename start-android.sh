#!/bin/bash
# Helper script to start Expo on Android emulator from WSL

echo "🔌 Setting up ADB reverse port forwarding..."
echo "  - Forwarding 8081 (Expo Metro bundler)"
~/Android/Sdk/platform-tools/adb reverse tcp:8081 tcp:8081
echo "  - Forwarding 8082 (Expo dev tools)"
~/Android/Sdk/platform-tools/adb reverse tcp:8082 tcp:8082
echo "  - Forwarding 8765 (Lora bridge server)"
~/Android/Sdk/platform-tools/adb reverse tcp:8765 tcp:8765

echo "  - Forwarding preview server ports (19006-19020)..."
for port in {19006..19020}; do
  ~/Android/Sdk/platform-tools/adb reverse tcp:$port tcp:$port 2>/dev/null
done
echo "    ✓ Preview ports ready"

echo ""
echo "📱 Android Emulator Configuration:"
echo "  Bridge Server URL: ws://localhost:8765"
echo "  (Forwards to WSL bridge server)"
echo ""
echo "📱 iPhone Configuration (via Tailscale):"
echo "  Bridge Server URL: ws://100.109.229.86:8765"
echo "  (Unchanged - Tailscale setup preserved)"
echo ""

echo "🚀 Starting Expo on Android emulator..."
cd ~/Repos/Lora/mobile

export PATH="$HOME/.local/bin:$HOME/Android/Sdk/platform-tools:$PATH"
export ANDROID_HOME="$HOME/Android/Sdk"

npx expo start --android --localhost
