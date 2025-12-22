import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  TouchableOpacity,
  Share,
  Linking,
  Animated,
} from 'react-native';
import { useRouter } from 'expo-router';
import ViewShot from 'react-native-view-shot';
import {
  Play,
  RefreshCw,
  ExternalLink,
  Share as ShareIcon,
  Terminal,
  ChevronDown,
  ChevronUp,
  Trash2,
  Send,
  AlertCircle,
  AlertTriangle,
  Info,
} from 'lucide-react-native';
import { useProjectStore, useSettingsStore, useVoiceStore } from '../../stores';
import { createSnack, createEmbeddedSnackUrl } from '../../services/bundler';
import { bridgeService } from '../../services/claude';
import { PreviewFrame, ConsoleMessage } from '../../components/preview';
import { EmptyState, Button } from '../../components/common';
import { colors, spacing, radius, typography } from '../../theme';
import { Project, ProjectFile } from '../../types';

const MAX_CONSOLE_MESSAGES = 100;

export default function PreviewScreen() {
  const router = useRouter();
  const { currentProject } = useProjectStore();
  const { isConnected } = useSettingsStore();
  const { registerScreenshotCapture, unregisterScreenshotCapture, pendingPreviewAction, clearPreviewAction } = useVoiceStore();
  const lastProjectIdRef = useRef<string | null>(null);
  const viewShotRef = useRef<ViewShot>(null);

  const [snackUrl, setSnackUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consoleMessages, setConsoleMessages] = useState<ConsoleMessage[]>([]);
  const [consoleExpanded, setConsoleExpanded] = useState(false);
  const [consoleHeight] = useState(new Animated.Value(0));

  const project = currentProject();

  // Count errors and warnings
  const errorCount = consoleMessages.filter(m => m.type === 'error').length;
  const warnCount = consoleMessages.filter(m => m.type === 'warn').length;

  const handleConsoleMessage = useCallback((message: ConsoleMessage) => {
    setConsoleMessages(prev => {
      const updated = [...prev, message];
      // Keep only last N messages
      if (updated.length > MAX_CONSOLE_MESSAGES) {
        return updated.slice(-MAX_CONSOLE_MESSAGES);
      }
      return updated;
    });

    // Auto-expand console on errors
    if (message.type === 'error' && !consoleExpanded) {
      toggleConsole(true);
    }
  }, [consoleExpanded]);

  const toggleConsole = (forceOpen?: boolean) => {
    const shouldExpand = forceOpen !== undefined ? forceOpen : !consoleExpanded;
    setConsoleExpanded(shouldExpand);
    Animated.timing(consoleHeight, {
      toValue: shouldExpand ? 200 : 0,
      duration: 200,
      useNativeDriver: false,
    }).start();
  };

  const clearConsole = () => {
    setConsoleMessages([]);
  };

  const sendToClaude = async () => {
    if (!project || consoleMessages.length === 0) return;

    // Format the logs for Claude
    const logsText = consoleMessages
      .map(m => {
        const time = m.timestamp.toLocaleTimeString();
        const prefix = m.type === 'error' ? '[ERROR]' :
                      m.type === 'warn' ? '[WARN]' :
                      m.type === 'info' ? '[INFO]' : '[LOG]';
        return `${time} ${prefix} ${m.message}`;
      })
      .join('\n');

    const prompt = `I'm getting the following console output from my app preview. Please analyze these logs and help me fix any issues:\n\n\`\`\`\n${logsText}\n\`\`\``;

    // Navigate to chat tab with the prompt - chat tab will handle creating terminal and sending
    // Add timestamp to ensure each click creates a unique navigation (React will detect param change)
    router.push({
      pathname: '/chat',
      params: {
        pendingPrompt: prompt,
        createNewTerminal: 'true',
        timestamp: Date.now().toString() // Make each navigation unique
      }
    });
  };

  const handleGeneratePreview = async () => {
    if (!project) return;

    // Don't try to start preview if not connected
    if (!bridgeService.isConnected()) {
      console.log('[Preview] Not connected to bridge, skipping preview start');
      return;
    }

    setLoading(true);
    setError(null);
    setConsoleMessages([]); // Clear console on refresh

    try {
      console.log('[Preview] Starting local preview server for project:', project.name);

      // First check if a preview server is already running
      const status = await bridgeService.getPreviewStatus(project.id);
      if (status.running && status.url) {
        console.log('[Preview] Using existing preview server:', status.url);
        setSnackUrl(status.url);
        setLoading(false);
        return;
      }

      // Start a new preview server with error callback
      const { url } = await bridgeService.startPreview(project.id, (error, errorType) => {
        // Add server-side errors to console
        const consoleType = errorType === 'error' ? 'error' : errorType === 'warn' ? 'warn' : 'info';
        handleConsoleMessage({
          type: consoleType,
          message: `[Server] ${error}`,
          timestamp: new Date()
        });
      });
      console.log('[Preview] Local preview server started at:', url);
      setSnackUrl(url);
    } catch (err) {
      console.warn('[Preview] Local preview failed, falling back to Snack:', err);

      // Fallback to Snack-based preview if local fails
      try {
        console.log('[Preview] Loading file contents for Snack preview...');

        const filesWithContent: ProjectFile[] = [];

        for (const file of project.files) {
          if (file.isDirectory) continue;
          if (file.path.match(/\.(png|jpg|jpeg|gif|ico|woff|ttf|mp3|mp4|lock)$/i)) continue;

          try {
            if (file.content && file.content.length > 0) {
              filesWithContent.push(file);
            } else {
              const content = await bridgeService.getFileContent(project.id, file.path);
              filesWithContent.push({ ...file, content });
            }
          } catch (fileErr) {
            console.warn('[Preview] Could not load file:', file.path, fileErr);
          }
        }

        const projectWithContent: Project = { ...project, files: filesWithContent };
        const url = await createEmbeddedSnackUrl(projectWithContent);
        setSnackUrl(url);
      } catch (snackErr) {
        setError('Failed to generate preview. Please try again.');
        console.error('[Preview] Error:', snackErr);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    if (!project) return;

    setLoading(true);
    setSnackUrl(null);
    setConsoleMessages([]);

    try {
      // Stop existing preview server first
      console.log('[Preview] Stopping existing preview server...');
      await bridgeService.stopPreview(project.id);
    } catch (err) {
      // Ignore errors if server wasn't running
      console.log('[Preview] No existing server to stop or error stopping:', err);
    }

    setLoading(false);
    // Now start fresh
    handleGeneratePreview();
  };

  const handleOpenExternal = () => {
    if (snackUrl) {
      const baseUrl = snackUrl.split('?')[0];
      Linking.openURL(baseUrl);
    }
  };

  const handleShare = async () => {
    if (!snackUrl || !project) return;

    try {
      const baseUrl = snackUrl.split('?')[0];
      await Share.share({
        message: `Check out "${project.name}" - built with Lora!\n${baseUrl}`,
        url: baseUrl,
      });
    } catch (err) {
      console.error('[Preview] Share error:', err);
    }
  };

  // Reset and regenerate preview when project changes
  useEffect(() => {
    const projectChanged = lastProjectIdRef.current !== project?.id;

    if (projectChanged && lastProjectIdRef.current) {
      // Stop old preview server
      bridgeService.stopPreview(lastProjectIdRef.current).catch(() => {
        // Ignore errors if server wasn't running
      });
    }

    lastProjectIdRef.current = project?.id || null;

    // Reset state when project changes
    setSnackUrl(null);
    setConsoleMessages([]);
    setError(null);
    setLoading(false);
  }, [project?.id]);

  // Auto-generate preview after reset (only when connected)
  useEffect(() => {
    if (project && !snackUrl && !loading && isConnected) {
      handleGeneratePreview();
    }
  }, [project?.id, snackUrl, isConnected]);

  // Register screenshot capture function for voice agent
  useEffect(() => {
    const captureScreenshot = async (): Promise<string | undefined> => {
      if (!viewShotRef.current) {
        console.log('[Preview] ViewShot ref not available');
        return undefined;
      }
      try {
        const uri = await viewShotRef.current.capture();
        // ViewShot returns a file URI, we need to read it as base64
        // The URI is already a base64 data URI when using result: 'base64'
        console.log('[Preview] Screenshot captured');
        return uri;
      } catch (error) {
        console.error('[Preview] Failed to capture screenshot:', error);
        return undefined;
      }
    };

    registerScreenshotCapture('preview', captureScreenshot);
    console.log('[Preview] Registered screenshot capture');

    return () => {
      unregisterScreenshotCapture('preview');
      console.log('[Preview] Unregistered screenshot capture');
    };
  }, [registerScreenshotCapture, unregisterScreenshotCapture]);

  // Handle voice agent preview actions
  useEffect(() => {
    if (pendingPreviewAction) {
      console.log('[Preview] Handling voice action:', pendingPreviewAction);

      if (pendingPreviewAction === 'toggle_console') {
        toggleConsole();
      } else if (pendingPreviewAction === 'reload_preview') {
        handleRefresh();
      } else if (pendingPreviewAction === 'send_to_claude') {
        sendToClaude();
      }

      // Clear the action after handling
      clearPreviewAction();
    }
  }, [pendingPreviewAction, clearPreviewAction]);

  const getMessageIcon = (type: ConsoleMessage['type']) => {
    switch (type) {
      case 'error':
        return <AlertCircle color={colors.destructive} size={14} />;
      case 'warn':
        return <AlertTriangle color="#f59e0b" size={14} />;
      case 'info':
        return <Info color={colors.brandTiger} size={14} />;
      default:
        return null;
    }
  };

  const getMessageColor = (type: ConsoleMessage['type']) => {
    switch (type) {
      case 'error':
        return colors.destructive;
      case 'warn':
        return '#f59e0b';
      case 'info':
        return colors.brandTiger;
      default:
        return colors.foreground;
    }
  };

  if (!project) {
    return (
      <View style={styles.container}>
        <EmptyState
          icon={<Play color={colors.mutedForeground} size={48} />}
          title="No project selected"
          description="Select or create a project to preview your app"
          action={
            <Button title="Go to Projects" onPress={() => router.push('/')} />
          }
        />
      </View>
    );
  }

  return (
    <ViewShot ref={viewShotRef} style={styles.container} options={{ format: 'png', quality: 0.8, result: 'base64' }}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Preview</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.iconButton} onPress={handleRefresh}>
            <RefreshCw color={colors.foreground} size={20} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconButton} onPress={handleOpenExternal}>
            <ExternalLink color={colors.foreground} size={20} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconButton} onPress={handleShare}>
            <ShareIcon color={colors.foreground} size={20} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Preview Content */}
      <View style={styles.previewWrapper}>
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.brandTiger} />
            <Text style={styles.loadingText}>Generating preview...</Text>
            <Text style={styles.loadingSubtext}>
              Starting {project.projectType === 'web' ? 'Vite' : 'Expo'} dev server...
            </Text>
          </View>
        ) : error ? (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{error}</Text>
            <Button
              title="Try Again"
              onPress={handleGeneratePreview}
              icon={<RefreshCw color={colors.background} size={16} />}
              style={{ marginTop: spacing.md }}
            />
          </View>
        ) : snackUrl ? (
          <View style={styles.fullPreview}>
            <PreviewFrame
              url={snackUrl}
              onConsoleMessage={handleConsoleMessage}
            />
          </View>
        ) : (
          <View style={styles.noPreviewContainer}>
            <Play color={colors.mutedForeground} size={48} />
            <Text style={styles.noPreviewText}>
              Generate a preview to see your app
            </Text>
            <Button
              title="Generate Preview"
              onPress={handleGeneratePreview}
              icon={<Play color={colors.background} size={16} />}
              style={{ marginTop: spacing.md }}
            />
          </View>
        )}
      </View>

      {/* Console Panel */}
      {snackUrl && (
        <View style={styles.consoleContainer}>
          {/* Console Header - Always visible */}
          <TouchableOpacity
            style={styles.consoleHeader}
            onPress={() => toggleConsole()}
          >
            <View style={styles.consoleHeaderLeft}>
              <Terminal color={colors.foreground} size={16} />
              <Text style={styles.consoleTitle}>Console</Text>
              {errorCount > 0 && (
                <View style={[styles.badge, styles.errorBadge]}>
                  <Text style={styles.badgeText}>{errorCount}</Text>
                </View>
              )}
              {warnCount > 0 && (
                <View style={[styles.badge, styles.warnBadge]}>
                  <Text style={styles.badgeText}>{warnCount}</Text>
                </View>
              )}
            </View>
            <View style={styles.consoleHeaderRight}>
              {consoleMessages.length > 0 && (
                <>
                  <TouchableOpacity
                    style={styles.consoleAction}
                    onPress={sendToClaude}
                  >
                    <Send color={colors.brandTiger} size={16} />
                    <Text style={styles.sendText}>Send to Claude</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.consoleAction}
                    onPress={clearConsole}
                  >
                    <Trash2 color={colors.mutedForeground} size={16} />
                  </TouchableOpacity>
                </>
              )}
              {consoleExpanded ? (
                <ChevronDown color={colors.foreground} size={20} />
              ) : (
                <ChevronUp color={colors.foreground} size={20} />
              )}
            </View>
          </TouchableOpacity>

          {/* Console Messages */}
          <Animated.View style={[styles.consoleBody, { height: consoleHeight }]}>
            <ScrollView
              style={styles.consoleScroll}
              contentContainerStyle={styles.consoleScrollContent}
            >
              {consoleMessages.length === 0 ? (
                <Text style={styles.consoleEmpty}>No console output yet</Text>
              ) : (
                consoleMessages.map((msg, index) => (
                  <View key={index} style={styles.consoleMessage}>
                    {getMessageIcon(msg.type)}
                    <Text
                      style={[
                        styles.consoleMessageText,
                        { color: getMessageColor(msg.type) }
                      ]}
                      numberOfLines={3}
                    >
                      {msg.message}
                    </Text>
                  </View>
                ))
              )}
            </ScrollView>
          </Animated.View>
        </View>
      )}
    </ViewShot>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    ...typography.h3,
    color: colors.foreground,
  },
  headerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  iconButton: {
    padding: spacing.sm,
  },
  previewWrapper: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  loadingContainer: {
    alignItems: 'center',
    gap: spacing.md,
  },
  loadingText: {
    ...typography.body,
    color: colors.foreground,
  },
  loadingSubtext: {
    ...typography.caption,
    color: colors.mutedForeground,
  },
  errorContainer: {
    alignItems: 'center',
    padding: spacing.xl,
  },
  errorText: {
    ...typography.body,
    color: colors.destructive,
    textAlign: 'center',
  },
  noPreviewContainer: {
    alignItems: 'center',
    gap: spacing.md,
  },
  noPreviewText: {
    ...typography.body,
    color: colors.mutedForeground,
    textAlign: 'center',
  },
  fullPreview: {
    flex: 1,
    width: '100%',
    borderRadius: radius.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  // Console styles
  consoleContainer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.cardBackground,
  },
  consoleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  consoleHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  consoleHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  consoleTitle: {
    ...typography.caption,
    color: colors.foreground,
    fontWeight: '600',
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    minWidth: 20,
    alignItems: 'center',
  },
  errorBadge: {
    backgroundColor: colors.destructive,
  },
  warnBadge: {
    backgroundColor: '#f59e0b',
  },
  badgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  consoleAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  sendText: {
    ...typography.caption,
    color: colors.brandTiger,
    fontWeight: '500',
  },
  consoleBody: {
    overflow: 'hidden',
    backgroundColor: '#1a1a2e',
  },
  consoleScroll: {
    flex: 1,
  },
  consoleScrollContent: {
    padding: spacing.sm,
  },
  consoleEmpty: {
    ...typography.caption,
    color: colors.mutedForeground,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  consoleMessage: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    paddingVertical: 2,
  },
  consoleMessageText: {
    flex: 1,
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 18,
  },
});
