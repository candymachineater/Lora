import React, { useState } from 'react';
import { View, StyleSheet, ActivityIndicator, Text } from 'react-native';
import { WebView } from 'react-native-webview';
import { colors, spacing, typography } from '../../theme';

interface PreviewFrameProps {
  url: string;
  onError?: (error: string) => void;
}

export function PreviewFrame({ url, onError }: PreviewFrameProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        source={{ uri: url }}
        style={styles.webview}
        onLoadStart={() => {
          setLoading(true);
          setError(null);
        }}
        onLoadEnd={() => setLoading(false)}
        onError={(e) => {
          const errorMsg = e.nativeEvent.description || 'Unknown error';
          setError(errorMsg);
          setLoading(false);
          onError?.(errorMsg);
        }}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        javaScriptEnabled
        domStorageEnabled
        startInLoadingState
        scalesPageToFit
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
