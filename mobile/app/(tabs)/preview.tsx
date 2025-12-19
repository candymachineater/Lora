import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  TouchableOpacity,
  Share,
  Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  Play,
  RefreshCw,
  ExternalLink,
  Share as ShareIcon,
  Smartphone,
} from 'lucide-react-native';
import { useProjectStore } from '../../stores';
import { createSnack, createEmbeddedSnackUrl } from '../../services/bundler';
import { PreviewFrame, DeviceFrame } from '../../components/preview';
import { EmptyState, Button } from '../../components/common';
import { colors, spacing, radius, typography } from '../../theme';

export default function PreviewScreen() {
  const router = useRouter();
  const { currentProject } = useProjectStore();

  const [snackUrl, setSnackUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDeviceFrame, setShowDeviceFrame] = useState(true);

  const project = currentProject();

  const handleGeneratePreview = async () => {
    if (!project) return;

    setLoading(true);
    setError(null);

    try {
      const url = await createEmbeddedSnackUrl(project);
      setSnackUrl(url);
    } catch (err) {
      setError('Failed to generate preview. Please try again.');
      console.error('[Preview] Error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = () => {
    setSnackUrl(null);
    handleGeneratePreview();
  };

  const handleOpenExternal = () => {
    if (snackUrl) {
      // Open the non-embedded URL
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

  // Auto-generate preview when project changes
  useEffect(() => {
    if (project && !snackUrl && !loading) {
      handleGeneratePreview();
    }
  }, [project?.id]);

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
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Preview</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.iconButton}
            onPress={() => setShowDeviceFrame(!showDeviceFrame)}
          >
            <Smartphone
              color={showDeviceFrame ? colors.brandTiger : colors.mutedForeground}
              size={20}
            />
          </TouchableOpacity>
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
      <ScrollView
        contentContainerStyle={styles.previewContainer}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.brandTiger} />
            <Text style={styles.loadingText}>Generating preview...</Text>
            <Text style={styles.loadingSubtext}>
              Uploading to Expo Snack
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
          showDeviceFrame ? (
            <DeviceFrame>
              <PreviewFrame url={snackUrl} />
            </DeviceFrame>
          ) : (
            <View style={styles.fullPreview}>
              <PreviewFrame url={snackUrl} />
            </View>
          )
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
      </ScrollView>

      {/* Footer Info */}
      {snackUrl && (
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Preview powered by Expo Snack
          </Text>
          <Text style={styles.footerSubtext}>
            Open with Expo Go for full native experience
          </Text>
        </View>
      )}
    </View>
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
  previewContainer: {
    flexGrow: 1,
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
  footer: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footerText: {
    ...typography.caption,
    color: colors.mutedForeground,
  },
  footerSubtext: {
    ...typography.caption,
    color: colors.mutedForeground,
    fontSize: 11,
  },
});
