import React, { useRef, useEffect, useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  Keyboard,
  ScrollView,
} from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';

interface TerminalProps {
  output: string;
  onInput: (input: string) => void;
  isConnected: boolean;
  sandbox: boolean;
  onResize?: (cols: number, rows: number) => void;
}

// xterm.js HTML content embedded as string
const XTERM_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Lora Terminal</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.css" />
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    html, body {
      width: 100%;
      height: 100%;
      overflow: hidden;
      background-color: #0C0C0C;
    }
    #terminal {
      width: 100%;
      height: 100%;
    }
    .xterm {
      padding: 2px;
    }
    .xterm-viewport {
      overflow-y: hidden !important;
    }
    /* Disable native touch scrolling - we handle it via JS */
    .xterm-screen {
      touch-action: none;
    }
    #terminal {
      touch-action: none;
    }
    .xterm-viewport::-webkit-scrollbar {
      width: 8px;
    }
    .xterm-viewport::-webkit-scrollbar-track {
      background: #1A1A1A;
    }
    .xterm-viewport::-webkit-scrollbar-thumb {
      background: #444;
      border-radius: 4px;
    }
  </style>
</head>
<body>
  <div id="terminal"></div>

  <script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@xterm/addon-web-links@0.11.0/lib/addon-web-links.min.js"></script>
  <script>
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 9,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      lineHeight: 1.0,
      theme: {
        background: '#0C0C0C',
        foreground: '#CCCCCC',
        cursor: '#16C60C',
        cursorAccent: '#0C0C0C',
        selectionBackground: 'rgba(255, 255, 255, 0.3)',
        black: '#0C0C0C',
        red: '#E74856',
        green: '#16C60C',
        yellow: '#F9F1A5',
        blue: '#3B78FF',
        magenta: '#B4009E',
        cyan: '#61D6D6',
        white: '#CCCCCC',
        brightBlack: '#767676',
        brightRed: '#E74856',
        brightGreen: '#16C60C',
        brightYellow: '#F9F1A5',
        brightBlue: '#3B78FF',
        brightMagenta: '#B4009E',
        brightCyan: '#61D6D6',
        brightWhite: '#F2F2F2'
      },
      allowTransparency: false,
      scrollback: 10000,
      tabStopWidth: 8,
      convertEol: false,
      screenReaderMode: false
    });

    // Touch scrolling is handled by React Native PanResponder
    // which calls term.scrollLines() via injectJavaScript
    function setupTouchScroll() {
      // Nothing to set up - React Native handles touch gestures
    }

    const fitAddon = new FitAddon.FitAddon();
    const webLinksAddon = new WebLinksAddon.WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);

    term.open(document.getElementById('terminal'));
    fitAddon.fit();
    setupTouchScroll();

    window.addEventListener('resize', () => {
      fitAddon.fit();
      sendToReactNative({ type: 'resize', cols: term.cols, rows: term.rows });
    });

    function sendToReactNative(message) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify(message));
      }
    }

    // iOS dictation fix: iOS sends text twice - progressively during dictation,
    // then word-by-word after. We only want to send once.
    let dictationText = '';      // The cumulative dictation text
    let dictationSent = false;   // Whether we've sent the dictation result
    let dictationTimeout = null;
    let postDictationIgnore = ''; // Text to ignore after dictation (the word-by-word replay)
    const DICTATION_END_DELAY = 1000; // 1 second - needs to be long enough for pauses during speech

    term.onData(data => {
      // Check if this is part of post-dictation word-by-word replay to ignore
      if (postDictationIgnore) {
        const dataLower = data.toLowerCase();
        // Check if this data matches the start of what we need to ignore
        if (postDictationIgnore.startsWith(dataLower)) {
          postDictationIgnore = postDictationIgnore.slice(dataLower.length);
          sendToReactNative({ type: 'debug', msg: 'Ignoring duplicate: ' + JSON.stringify(data) + ', remaining: ' + postDictationIgnore.length });
          return; // Ignore this - it's a duplicate
        } else if (dataLower.trim() === '' && postDictationIgnore.startsWith(' ')) {
          // Handle space/whitespace
          postDictationIgnore = postDictationIgnore.trimStart();
          sendToReactNative({ type: 'debug', msg: 'Ignoring space, remaining: ' + postDictationIgnore.length });
          return;
        }
        // Doesn't match - clear ignore and process normally
        sendToReactNative({ type: 'debug', msg: 'No match, clearing ignore. data=' + JSON.stringify(dataLower) + ', expected=' + JSON.stringify(postDictationIgnore.slice(0, 20)) });
        postDictationIgnore = '';
      }

      // Multi-character input = dictation in progress
      if (data.length > 1) {
        dictationText = data; // iOS sends cumulative text
        dictationSent = false;

        // Reset timer
        if (dictationTimeout) clearTimeout(dictationTimeout);

        // Wait for dictation to stabilize
        dictationTimeout = setTimeout(() => {
          if (dictationText && !dictationSent) {
            sendToReactNative({ type: 'debug', msg: 'Sending dictation (timeout): ' + JSON.stringify(dictationText) });
            sendToReactNative({ type: 'input', data: dictationText });
            dictationSent = true;
            // Prepare to ignore the word-by-word replay that follows
            postDictationIgnore = dictationText.toLowerCase();
            sendToReactNative({ type: 'debug', msg: 'Set ignore string len=' + postDictationIgnore.length });
          }
          dictationText = '';
          dictationTimeout = null;
        }, DICTATION_END_DELAY);

        return;
      }

      // Single character input while we have pending dictation
      if (dictationText && !dictationSent) {
        const dataLower = data.toLowerCase();
        const dictLower = dictationText.toLowerCase();

        // Check if this single char is the start of word-by-word replay
        // (iOS starts replaying the dictation word-by-word after dictation ends)
        if (dictLower.startsWith(dataLower) || (dataLower.trim() === '' && dictLower.charAt(0) === ' ')) {
          // This is the word-by-word replay starting - send dictation NOW
          if (dictationTimeout) clearTimeout(dictationTimeout);
          sendToReactNative({ type: 'debug', msg: 'Word replay detected, sending: ' + JSON.stringify(dictationText) });
          sendToReactNative({ type: 'input', data: dictationText });
          dictationSent = true;
          // Set up ignore, but skip the character we just received
          postDictationIgnore = dictLower.slice(dataLower.length);
          sendToReactNative({ type: 'debug', msg: 'Set ignore (after first): len=' + postDictationIgnore.length });
          dictationText = '';
          dictationTimeout = null;
          return;
        }

        // Not word replay - might be user typing or control char
        // Send dictation and process this char normally
        if (dictationTimeout) clearTimeout(dictationTimeout);
        sendToReactNative({ type: 'debug', msg: 'Non-replay char, sending dictation: ' + JSON.stringify(dictationText) });
        sendToReactNative({ type: 'input', data: dictationText });
        dictationSent = true;
        dictationText = '';
        dictationTimeout = null;
        // Fall through to send this char
      }

      // Normal typing - send immediately
      sendToReactNative({ type: 'input', data: data });
    });

    term.onResize(size => {
      sendToReactNative({ type: 'resize', cols: size.cols, rows: size.rows });
    });

    setTimeout(() => {
      fitAddon.fit();
      console.log('[Terminal] Ready with dimensions:', term.cols, 'x', term.rows);
      sendToReactNative({
        type: 'ready',
        cols: term.cols,
        rows: term.rows
      });
    }, 100);

    window.handleReactNativeMessage = function(message) {
      try {
        const data = typeof message === 'string' ? JSON.parse(message) : message;

        switch (data.type) {
          case 'output':
            term.write(data.data);
            break;
          case 'clear':
            term.clear();
            break;
          case 'reset':
            term.reset();
            break;
          case 'resize':
            if (data.cols && data.rows) {
              term.resize(data.cols, data.rows);
            }
            break;
          case 'focus':
            term.focus();
            break;
          case 'blur':
            term.blur();
            break;
          case 'scrollToBottom':
            console.log('[Terminal] scrollToBottom called');
            sendToReactNative({ type: 'debug', msg: 'scrollToBottom executed' });
            term.scrollToBottom();
            break;
          case 'scrollToTop':
            console.log('[Terminal] scrollToTop called');
            sendToReactNative({ type: 'debug', msg: 'scrollToTop executed' });
            term.scrollToTop();
            break;
          case 'scrollLines':
            console.log('[Terminal] scrollLines called with:', data.lines);
            sendToReactNative({ type: 'debug', msg: 'scrollLines: ' + data.lines + ', buffer length: ' + term.buffer.active.length });
            if (typeof data.lines === 'number') {
              term.scrollLines(data.lines);
            }
            break;
          case 'paste':
            if (data.text) {
              term.paste(data.text);
            }
            break;
          case 'sendInput':
            sendToReactNative({ type: 'input', data: data.data });
            break;
        }
      } catch (e) {
        console.error('Error handling message:', e);
      }
    };

    term.attachCustomKeyEventHandler(e => {
      if (e.ctrlKey && e.key === 'c' && !term.hasSelection()) {
        return true;
      }
      return true;
    });

    sendToReactNative({ type: 'initialized' });
  </script>
</body>
</html>`;

export function Terminal({
  output,
  onInput,
  isConnected,
  sandbox,
  onResize,
}: TerminalProps) {
  const webViewRef = useRef<WebView>(null);
  const lastOutputRef = useRef<string>('');

  // Modifier key states (toggleable)
  const [ctrlActive, setCtrlActive] = useState(false);
  const [shiftActive, setShiftActive] = useState(false);
  const isReadyRef = useRef<boolean>(false);
  const pendingOutputRef = useRef<string>('');

  // Send message to WebView
  const sendToWebView = useCallback((message: object) => {
    if (webViewRef.current && isReadyRef.current) {
      const script = `window.handleReactNativeMessage(${JSON.stringify(JSON.stringify(message))}); true;`;
      webViewRef.current.injectJavaScript(script);
    }
  }, []);

  // Scroll button handlers - use sendToWebView to route through handleReactNativeMessage
  const handleScrollUp = useCallback(() => {
    sendToWebView({ type: 'scrollLines', lines: -5 });
  }, [sendToWebView]);

  const handleScrollDown = useCallback(() => {
    sendToWebView({ type: 'scrollLines', lines: 5 });
  }, [sendToWebView]);

  const handleScrollToTop = useCallback(() => {
    sendToWebView({ type: 'scrollToTop' });
  }, [sendToWebView]);

  const handleScrollToBottom = useCallback(() => {
    sendToWebView({ type: 'scrollToBottom' });
  }, [sendToWebView]);

  // Handle new output - only send the delta, or clear if output is reset
  useEffect(() => {
    if (output !== lastOutputRef.current) {
      // Check if output was reset (new terminal or project switch)
      if (output.length < lastOutputRef.current.length || output === '') {
        // Output is shorter - terminal was reset, clear and resend
        lastOutputRef.current = output;
        if (isReadyRef.current) {
          sendToWebView({ type: 'clear' });
          if (output) {
            sendToWebView({ type: 'output', data: output });
          }
        } else {
          pendingOutputRef.current = output;
        }
        return;
      }

      // Calculate the new portion of output (delta)
      const newContent = output.slice(lastOutputRef.current.length);
      lastOutputRef.current = output;

      if (newContent) {
        if (isReadyRef.current) {
          sendToWebView({ type: 'output', data: newContent });
        } else {
          // Queue output if terminal isn't ready yet
          pendingOutputRef.current += newContent;
        }
      }
    }
  }, [output, sendToWebView]);

  // Handle messages from WebView
  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);

      switch (data.type) {
        case 'input':
          onInput(data.data);
          break;
        case 'resize':
          onResize?.(data.cols, data.rows);
          break;
        case 'ready':
          isReadyRef.current = true;
          // Send any pending output
          if (pendingOutputRef.current) {
            sendToWebView({ type: 'output', data: pendingOutputRef.current });
            pendingOutputRef.current = '';
          }
          // Send initial resize
          onResize?.(data.cols, data.rows);
          break;
        case 'initialized':
          // Terminal is initialized, wait for ready
          break;
        case 'debug':
          // Debug logging disabled to reduce noise
          break;
      }
    } catch (e) {
      console.error('Error parsing WebView message:', e);
    }
  }, [onInput, onResize, sendToWebView]);

  // Control button handlers
  const handleInterrupt = useCallback(() => {
    onInput('\x03'); // Ctrl+C
  }, [onInput]);

  const handleEOF = useCallback(() => {
    onInput('\x04'); // Ctrl+D
  }, [onInput]);

  const handleClear = useCallback(() => {
    sendToWebView({ type: 'clear' });
    onInput('\x0c'); // Ctrl+L
  }, [onInput, sendToWebView]);

  const handleTab = useCallback(() => {
    onInput('\t');
  }, [onInput]);

  // Escape key handler
  const handleEscape = useCallback(() => {
    onInput('\x1b');
  }, [onInput]);

  // More common Ctrl shortcuts
  const handleCtrlA = useCallback(() => {
    onInput('\x01'); // Ctrl+A - beginning of line
    setCtrlActive(false);
    setShiftActive(false);
  }, [onInput]);

  const handleCtrlE = useCallback(() => {
    onInput('\x05'); // Ctrl+E - end of line
    setCtrlActive(false);
    setShiftActive(false);
  }, [onInput]);

  const handleCtrlU = useCallback(() => {
    onInput('\x15'); // Ctrl+U - clear line to beginning
    setCtrlActive(false);
    setShiftActive(false);
  }, [onInput]);

  const handleCtrlZ = useCallback(() => {
    onInput('\x1a'); // Ctrl+Z - suspend
    setCtrlActive(false);
    setShiftActive(false);
  }, [onInput]);

  // Helper to send input with modifiers and reset modifier states
  const sendWithModifiers = useCallback((key: string, ctrlCode?: string) => {
    if (ctrlActive && ctrlCode) {
      onInput(ctrlCode);
    } else if (shiftActive) {
      // For shift, send uppercase if it's a letter
      onInput(key.toUpperCase());
    } else {
      onInput(key);
    }
    // Reset modifiers after use
    setCtrlActive(false);
    setShiftActive(false);
  }, [ctrlActive, shiftActive, onInput]);

  // Toggle Ctrl modifier
  const toggleCtrl = useCallback(() => {
    setCtrlActive(prev => !prev);
  }, []);

  // Toggle Shift modifier
  const toggleShift = useCallback(() => {
    setShiftActive(prev => !prev);
  }, []);

  const handleArrowUp = useCallback(() => {
    // Ctrl+Up or Shift+Up variants
    if (ctrlActive) {
      onInput('\x1b[1;5A'); // Ctrl+Up
    } else if (shiftActive) {
      onInput('\x1b[1;2A'); // Shift+Up
    } else {
      onInput('\x1b[A');
    }
    setCtrlActive(false);
    setShiftActive(false);
  }, [onInput, ctrlActive, shiftActive]);

  const handleArrowDown = useCallback(() => {
    if (ctrlActive) {
      onInput('\x1b[1;5B'); // Ctrl+Down
    } else if (shiftActive) {
      onInput('\x1b[1;2B'); // Shift+Down
    } else {
      onInput('\x1b[B');
    }
    setCtrlActive(false);
    setShiftActive(false);
  }, [onInput, ctrlActive, shiftActive]);

  const handleArrowLeft = useCallback(() => {
    if (ctrlActive) {
      onInput('\x1b[1;5D'); // Ctrl+Left (word jump)
    } else if (shiftActive) {
      onInput('\x1b[1;2D'); // Shift+Left
    } else {
      onInput('\x1b[D');
    }
    setCtrlActive(false);
    setShiftActive(false);
  }, [onInput, ctrlActive, shiftActive]);

  const handleArrowRight = useCallback(() => {
    if (ctrlActive) {
      onInput('\x1b[1;5C'); // Ctrl+Right (word jump)
    } else if (shiftActive) {
      onInput('\x1b[1;2C'); // Shift+Right
    } else {
      onInput('\x1b[C');
    }
    setCtrlActive(false);
    setShiftActive(false);
  }, [onInput, ctrlActive, shiftActive]);

  // Reset terminal when reconnecting
  useEffect(() => {
    if (isConnected && isReadyRef.current) {
      // Don't reset, just keep existing content
    }
  }, [isConnected]);

  // Scroll to bottom when keyboard hides
  useEffect(() => {
    const keyboardDidHide = Keyboard.addListener('keyboardDidHide', () => {
      if (isReadyRef.current) {
        sendToWebView({ type: 'scrollToBottom' });
        // Don't refocus - let user dismiss keyboard
      }
    });

    const keyboardDidShow = Keyboard.addListener('keyboardDidShow', () => {
      if (isReadyRef.current) {
        sendToWebView({ type: 'scrollToBottom' });
      }
    });

    return () => {
      keyboardDidHide.remove();
      keyboardDidShow.remove();
    };
  }, [sendToWebView]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={100}
    >
      {/* Status bar */}
      <View style={styles.statusBar}>
        <View style={styles.statusLeft}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: isConnected ? '#22C55E' : '#D10808' },
            ]}
          />
          <Text style={styles.statusText}>
            {isConnected ? 'Connected' : 'Disconnected'}
          </Text>
        </View>
        <View style={styles.statusRight}>
          <View
            style={[
              styles.sandboxBadge,
              { backgroundColor: sandbox ? '#22C55E' : '#F59E0B' },
            ]}
          >
            <Text style={[styles.sandboxText, !sandbox && { color: '#1C1C1C' }]}>
              {sandbox ? 'Sandbox' : 'Full Access'}
            </Text>
          </View>
        </View>
      </View>


      {/* xterm.js WebView */}
      <View style={styles.terminalContainer}>
        <WebView
          ref={webViewRef}
          source={{ html: XTERM_HTML }}
          style={styles.webView}
          onMessage={handleMessage}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          originWhitelist={['*']}
          scrollEnabled={false}
          bounces={false}
          keyboardDisplayRequiresUserAction={false}
          hideKeyboardAccessoryView={false}
          allowsInlineMediaPlayback={true}
          mediaPlaybackRequiresUserAction={false}
          startInLoadingState={false}
          scalesPageToFit={false}
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          contentMode="mobile"
          automaticallyAdjustContentInsets={false}
        />
        {/* Scroll buttons on the right side */}
        <View style={styles.scrollButtonsContainer}>
          <TouchableOpacity style={styles.scrollButton} onPress={handleScrollToTop}>
            <Text style={styles.scrollButtonText}>⏫</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.scrollButton} onPress={handleScrollUp}>
            <Text style={styles.scrollButtonText}>▲</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.scrollButton} onPress={handleScrollDown}>
            <Text style={styles.scrollButtonText}>▼</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.scrollButton} onPress={handleScrollToBottom}>
            <Text style={styles.scrollButtonText}>⏬</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Control buttons */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.controlBar}
        contentContainerStyle={styles.controlBarContent}
      >
        {/* Modifier keys - toggleable */}
        <TouchableOpacity
          style={[styles.controlButton, ctrlActive && styles.controlButtonActive]}
          onPress={toggleCtrl}
        >
          <Text style={[styles.controlButtonText, ctrlActive && styles.controlButtonTextActive]}>Ctrl</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.controlButton, shiftActive && styles.controlButtonActive]}
          onPress={toggleShift}
        >
          <Text style={[styles.controlButtonText, shiftActive && styles.controlButtonTextActive]}>Shift</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.controlButton} onPress={handleEscape}>
          <Text style={styles.controlButtonText}>Esc</Text>
        </TouchableOpacity>

        {/* Common control sequences */}
        <TouchableOpacity style={styles.controlButton} onPress={handleInterrupt}>
          <Text style={styles.controlButtonText}>^C</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.controlButton} onPress={handleEOF}>
          <Text style={styles.controlButtonText}>^D</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.controlButton} onPress={handleCtrlZ}>
          <Text style={styles.controlButtonText}>^Z</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.controlButton} onPress={handleTab}>
          <Text style={styles.controlButtonText}>Tab</Text>
        </TouchableOpacity>

        {/* Line navigation */}
        <TouchableOpacity style={styles.controlButton} onPress={handleCtrlA}>
          <Text style={styles.controlButtonText}>^A</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.controlButton} onPress={handleCtrlE}>
          <Text style={styles.controlButtonText}>^E</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.controlButton} onPress={handleCtrlU}>
          <Text style={styles.controlButtonText}>^U</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.controlButton} onPress={handleClear}>
          <Text style={styles.controlButtonText}>Clear</Text>
        </TouchableOpacity>

        {/* Arrow keys */}
        <TouchableOpacity style={styles.controlButton} onPress={handleArrowUp}>
          <Text style={styles.controlButtonText}>↑</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.controlButton} onPress={handleArrowDown}>
          <Text style={styles.controlButtonText}>↓</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.controlButton} onPress={handleArrowLeft}>
          <Text style={styles.controlButtonText}>←</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.controlButton} onPress={handleArrowRight}>
          <Text style={styles.controlButtonText}>→</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0C0C0C',
  },
  statusBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#161616',
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A2A',
  },
  statusLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  statusText: {
    color: '#999',
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  statusRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sandboxBadge: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
  },
  sandboxText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '600',
  },
  terminalContainer: {
    flex: 1,
    backgroundColor: '#0C0C0C',
    position: 'relative',
  },
  webView: {
    flex: 1,
    backgroundColor: '#0C0C0C',
  },
  scrollButtonsContainer: {
    position: 'absolute',
    right: 8,
    top: '50%',
    transform: [{ translateY: -80 }],
    flexDirection: 'column',
    gap: 6,
    backgroundColor: 'rgba(22, 22, 22, 0.9)',
    borderRadius: 12,
    padding: 6,
    borderWidth: 1,
    borderColor: '#333',
  },
  scrollButton: {
    width: 38,
    height: 38,
    backgroundColor: '#252525',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#3A3A3A',
  },
  scrollButtonText: {
    fontSize: 16,
    color: '#AAA',
  },
  controlBar: {
    backgroundColor: '#161616',
    maxHeight: 52,
    borderTopWidth: 1,
    borderTopColor: '#2A2A2A',
  },
  controlBarContent: {
    flexDirection: 'row',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
    alignItems: 'center',
  },
  controlButton: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: '#252525',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#3A3A3A',
  },
  controlButtonActive: {
    backgroundColor: '#C53307',
    borderColor: '#C53307',
  },
  controlButtonText: {
    color: '#BBB',
    fontSize: 12,
    fontWeight: '500',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  controlButtonTextActive: {
    color: '#FFF',
    fontWeight: '600',
  },
});
