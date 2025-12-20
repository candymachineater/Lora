# Terminal Scroll Implementation Attempts

## Problem
One-finger touch scrolling doesn't work in the xterm.js terminal running inside a React Native WebView on iOS.

## Root Cause
iOS WebView aggressively captures touch events at the native layer before they reach either:
- The web content (JavaScript touch handlers)
- The parent React Native views (PanResponder, Responder system)

## Failed Approaches

### 1. JavaScript Touch Handlers Inside WebView
**File:** `Terminal.tsx` - XTERM_HTML section
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

**Result:** Responder events don't fire - overlay doesn't receive touches (unknown why)

### 6. Debug Logging
- Added `console.log` in touch handlers
- No logs appear in Metro console when touching terminal area

## Untried Approaches

### A. react-native-gesture-handler
Use `PanGestureHandler` from react-native-gesture-handler library which has better WebView compatibility.

### B. Scroll Buttons UI
Add dedicated up/down scroll buttons instead of touch gestures.

### C. Two-Finger Scroll
Detect two-finger gestures which may bypass WebView's single-touch capture.

### D. Native Module
Create a native iOS module to intercept touches at the UIKit level.

### E. Different Terminal Library
Use a React Native native terminal component instead of xterm.js in WebView.

### F. WebView onTouchStart/onTouchMove Props
Try WebView's direct touch props if available.

### G. Wrap WebView in ScrollView
Use a React Native ScrollView with the WebView inside, sync scroll positions.

## Current State
Terminal works for input/output but cannot be scrolled with touch gestures on iOS.
