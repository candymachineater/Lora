# Terminal Scroll Implementation Attempts

## Problem
One-finger touch scrolling doesn't work in the xterm.js terminal running inside a React Native WebView on iOS.

## Root Cause
iOS WebView aggressively captures touch events at the native layer before they reach either:
- The web content (JavaScript touch handlers)
- The parent React Native views (PanResponder, Responder system)

## Failed Approaches

### 1. JavaScript Touch Handlers Inside WebView
**What was tried:**
- Added `touchstart`, `touchmove`, `touchend` event listeners to:
  - `document.body`
  - `#terminal` container
  - `.xterm-screen` element
  - `.xterm-viewport` element
- Used `{ passive: false, capture: true }` options
- Called `e.preventDefault()` and `e.stopPropagation()`
- Used `term.scrollLines()` API to scroll programmatically

**Result:** Touch events never fire - iOS WebView intercepts them at native layer

### 2. CSS Approaches
**What was tried:**
- `-webkit-overflow-scrolling: touch` on `.xterm-viewport`
- `touch-action: pan-y` on `.xterm-screen`
- `touch-action: none` to disable native handling
- `overflow-y: auto !important` and `overflow-y: hidden !important`

**Result:** No effect - CSS touch properties don't influence WebView's native touch handling

### 3. WebView scrollEnabled Prop
**What was tried:**
- `scrollEnabled={true}` - WebView scrolls but xterm content doesn't
- `scrollEnabled={false}` - No scrolling at all

**Result:** Neither setting allows xterm.js internal scrolling to work

### 4. PanResponder on Parent View
**What was tried:**
- Created PanResponder with `onMoveShouldSetPanResponder` checking for vertical drag
- Attached `panResponder.panHandlers` to terminal container View
- Injected JavaScript to call `term.scrollLines()` on gesture

**Result:** WebView consumes all touches before they reach parent View's PanResponder

### 5. Transparent Overlay with Responder System
**What was tried:**
- Added absolute-positioned transparent View on top of WebView
- Used `onStartShouldSetResponder`, `onResponderGrant`, `onResponderMove`, `onResponderRelease`
- Added slight background color `rgba(0,0,0,0.01)` to ensure iOS registers touches
- Tap detection to focus terminal, drag detection to scroll

**Result:** Responder events don't fire - overlay doesn't receive touches

### 6. react-native-gesture-handler with Reanimated
**What was tried:**
- Used `Gesture.Pan()` and `Gesture.Tap()` from react-native-gesture-handler
- Used `useSharedValue` and `runOnJS` from react-native-reanimated
- Wrapped overlay with `GestureDetector`

**Result:** Version mismatch error in Expo Go:
```
[WorkletsError: [Worklets] Mismatch between JavaScript part and native part of Worklets (0.7.1 vs 0.5.1)]
```
This approach requires a development build, not compatible with Expo Go.

## Current Solution: Scroll Buttons
Since touch gestures cannot reliably work with WebView on iOS in Expo Go, we implemented scroll buttons:
- ⏫ Scroll to top
- ▲ Scroll up 5 lines
- ▼ Scroll down 5 lines
- ⏬ Scroll to bottom

These buttons are positioned on the right side of the terminal and use `term.scrollLines()` and `term.scrollToTop()`/`term.scrollToBottom()` xterm.js APIs.

## Future: Touch Scrolling with Development Build
To enable proper touch scrolling, would need:
1. Create an Expo development build (not Expo Go)
2. Use react-native-gesture-handler with Reanimated properly installed
3. The GestureDetector overlay approach should work in a dev build
