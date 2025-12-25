import React, { useState, useRef } from 'react';
import { View, StyleSheet, ActivityIndicator, Text } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { colors, spacing, typography } from '../../theme';

export interface ConsoleMessage {
  type: 'log' | 'warn' | 'error' | 'info';
  message: string;
  timestamp: Date;
}

interface PreviewFrameProps {
  url: string;
  onError?: (error: string) => void;
  onConsoleMessage?: (message: ConsoleMessage) => void;
}

// Injected script to capture console messages
const CONSOLE_CAPTURE_SCRIPT = `
  (function() {
    const originalConsole = {
      log: console.log,
      warn: console.warn,
      error: console.error,
      info: console.info
    };

    function sendToRN(type, args) {
      try {
        const message = Array.from(args).map(arg => {
          if (typeof arg === 'object') {
            try {
              return JSON.stringify(arg, null, 2);
            } catch (e) {
              return String(arg);
            }
          }
          return String(arg);
        }).join(' ');

        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'console',
          level: type,
          message: message
        }));
      } catch (e) {}
    }

    console.log = function() {
      sendToRN('log', arguments);
      originalConsole.log.apply(console, arguments);
    };

    console.warn = function() {
      sendToRN('warn', arguments);
      originalConsole.warn.apply(console, arguments);
    };

    console.error = function() {
      sendToRN('error', arguments);
      originalConsole.error.apply(console, arguments);
    };

    console.info = function() {
      sendToRN('info', arguments);
      originalConsole.info.apply(console, arguments);
    };

    // Capture unhandled errors
    window.onerror = function(message, source, lineno, colno, error) {
      sendToRN('error', ['Uncaught Error: ' + message + ' at ' + source + ':' + lineno + ':' + colno]);
      return false;
    };

    // Capture unhandled promise rejections
    window.onunhandledrejection = function(event) {
      sendToRN('error', ['Unhandled Promise Rejection: ' + event.reason]);
    };

    true;
  })();
`;

export function PreviewFrame({ url, onError, onConsoleMessage }: PreviewFrameProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const webViewRef = useRef<WebView>(null);

  const handleMessage = (event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'console' && onConsoleMessage) {
        console.log('[PreviewFrame] Captured console message:', data.level, data.message.substring(0, 100));
        onConsoleMessage({
          type: data.level,
          message: data.message,
          timestamp: new Date(),
        });
      }
    } catch (e) {
      // Ignore parse errors - might be non-JSON messages
      const msgPreview = event.nativeEvent.data?.substring(0, 100);
      if (msgPreview && !msgPreview.includes('webpack') && !msgPreview.includes('HMR')) {
        console.log('[PreviewFrame] Non-JSON message:', msgPreview);
      }
    }
  };

  const handleHttpError = (syntheticEvent: any) => {
    const { nativeEvent } = syntheticEvent;
    console.warn('[PreviewFrame] HTTP error:', nativeEvent.statusCode, nativeEvent.description);
    onConsoleMessage?.({
      type: 'error',
      message: `HTTP Error ${nativeEvent.statusCode}: ${nativeEvent.description || nativeEvent.url}`,
      timestamp: new Date(),
    });
  };

  const handleRenderProcessGone = (syntheticEvent: any) => {
    const { nativeEvent } = syntheticEvent;
    console.warn('[PreviewFrame] Render process gone:', nativeEvent);
    onConsoleMessage?.({
      type: 'error',
      message: `WebView crashed: ${nativeEvent?.didCrash ? 'Process crashed' : 'Process killed'}`,
      timestamp: new Date(),
    });
  };

  if (!url) {
    return (
      <View style={styles.placeholder}>
        <Text style={styles.placeholderText}>No preview available</Text>
        <Text style={styles.placeholderSubtext}>
          Generate or select a project to preview
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={colors.brandTiger} />
          <Text style={styles.loadingText}>Loading preview...</Text>
        </View>
      )}
      {error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Failed to load preview</Text>
          <Text style={styles.errorDetail}>{error}</Text>
        </View>
      )}
      <WebView
        ref={webViewRef}
        source={{ uri: url }}
        style={styles.webview}
        onLoadStart={() => {
          console.log('[PreviewFrame] Load started:', url);
          setLoading(true);
          setError(null);
        }}
        onLoadEnd={() => {
          console.log('[PreviewFrame] Load ended');
          setLoading(false);
        }}
        onLoadProgress={({ nativeEvent }) => {
          if (nativeEvent.progress === 1) {
            console.log('[PreviewFrame] Load complete');
          }
        }}
        onError={(e) => {
          const errorMsg = e.nativeEvent.description || 'Unknown error';
          console.error('[PreviewFrame] Load error:', errorMsg);
          setError(errorMsg);
          setLoading(false);
          onError?.(errorMsg);
          onConsoleMessage?.({
            type: 'error',
            message: `WebView Error: ${errorMsg}`,
            timestamp: new Date(),
          });
        }}
        onHttpError={handleHttpError}
        renderError={(errorName) => (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>Failed to load: {errorName}</Text>
          </View>
        )}
        onMessage={handleMessage}
        injectedJavaScript={CONSOLE_CAPTURE_SCRIPT}
        injectedJavaScriptBeforeContentLoaded={CONSOLE_CAPTURE_SCRIPT}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        startInLoadingState={true}
        originWhitelist={['*']}
        mixedContentMode="always"
        allowUniversalAccessFromFileURLs={true}
        allowFileAccessFromFileURLs={true}
        allowsFullscreenVideo={true}
        cacheEnabled={false}
        incognito={false}
        thirdPartyCookiesEnabled={true}
        sharedCookiesEnabled={true}
        userAgent="Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  webview: {
    flex: 1,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  loadingText: {
    ...typography.body,
    color: colors.mutedForeground,
    marginTop: spacing.md,
  },
  placeholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.cardBackground,
    padding: spacing.xl,
  },
  placeholderText: {
    ...typography.h3,
    color: colors.foreground,
    marginBottom: spacing.sm,
  },
  placeholderSubtext: {
    ...typography.body,
    color: colors.mutedForeground,
    textAlign: 'center',
  },
  errorContainer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
    zIndex: 1,
  },
  errorText: {
    ...typography.h3,
    color: colors.destructive,
    marginBottom: spacing.sm,
  },
  errorDetail: {
    ...typography.caption,
    color: colors.mutedForeground,
    textAlign: 'center',
  },
});
