import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import {
  FolderOpen,
  Clock,
  FileCode,
  Trash2,
  Download,
  MessageCircle,
  Code2,
} from 'lucide-react-native';
import { useProjectStore } from '../../stores';
import { exportProject } from '../../services/storage';
import { Button } from '../../components/common';
import { colors, spacing, radius, typography } from '../../theme';

export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { projects, deleteProject, setCurrentProject } = useProjectStore();

  const project = projects.find((p) => p.id === id);

  if (!project) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Project not found</Text>
        <Button title="Go Back" onPress={() => router.back()} />
      </View>
    );
  }

  const handleDelete = () => {
    Alert.alert(
      'Delete Project',
      `Are you sure you want to delete "${project.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteProject(project.id);
            router.back();
          },
        },
      ]
    );
  };

  const handleExport = async () => {
    try {
      const json = await exportProject(project);
      // In a real app, you'd save this to a file or share it
      Alert.alert('Export Ready', 'Project exported successfully. JSON copied.');
      console.log('[Export]', json);
    } catch (error) {
      Alert.alert('Export Failed', 'Could not export the project.');
    }
  };

  const handleOpenChat = () => {
    setCurrentProject(project.id);
    router.push('/chat');
  };

  const handleOpenEditor = () => {
    setCurrentProject(project.id);
    router.push('/editor');
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: project.name,
        }}
      />
      <ScrollView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.iconLarge}>
            <FolderOpen color={colors.brandTiger} size={32} />
          </View>
          <Text style={styles.title}>{project.name}</Text>
          {project.description && (
            <Text style={styles.description}>{project.description}</Text>
          )}
        </View>

        {/* Stats */}
        <View style={styles.statsContainer}>
          <View style={styles.stat}>
            <FileCode color={colors.mutedForeground} size={20} />
            <Text style={styles.statValue}>{project.files.length}</Text>
            <Text style={styles.statLabel}>Files</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Clock color={colors.mutedForeground} size={20} />
            <Text style={styles.statValue}>
              {formatDate(project.updatedAt).split(',')[0]}
            </Text>
            <Text style={styles.statLabel}>Last Updated</Text>
          </View>
        </View>

        {/* Actions */}
        <View style={styles.actionsContainer}>
          <TouchableOpacity style={styles.actionCard} onPress={handleOpenChat}>
            <MessageCircle color={colors.brandSapphire} size={24} />
            <Text style={styles.actionTitle}>Continue Building</Text>
            <Text style={styles.actionDescription}>
              Chat with Claude to add features
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionCard} onPress={handleOpenEditor}>
            <Code2 color={colors.brandTwilight} size={24} />
            <Text style={styles.actionTitle}>Edit Code</Text>
            <Text style={styles.actionDescription}>
              View and modify source files
            </Text>
          </TouchableOpacity>
        </View>

        {/* Files List */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Files</Text>
          {project.files.map((file) => (
            <View key={file.path} style={styles.fileRow}>
              <FileCode color={colors.brandSapphire} size={16} />
              <Text style={styles.fileName}>{file.path}</Text>
              <Text style={styles.fileSize}>
                {Math.round(file.content.length / 100) * 100} chars
              </Text>
            </View>
          ))}
        </View>

        {/* Danger Zone */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Actions</Text>
          <TouchableOpacity style={styles.actionRow} onPress={handleExport}>
            <Download color={colors.foreground} size={18} />
            <Text style={styles.actionRowText}>Export Project</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionRow} onPress={handleDelete}>
            <Trash2 color={colors.destructive} size={18} />
            <Text style={[styles.actionRowText, { color: colors.destructive }]}>
              Delete Project
            </Text>
          </TouchableOpacity>
        </View>

        {/* Timestamps */}
        <View style={styles.timestamps}>
          <Text style={styles.timestamp}>
            Created: {formatDate(project.createdAt)}
          </Text>
          <Text style={styles.timestamp}>
            Updated: {formatDate(project.updatedAt)}
          </Text>
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    alignItems: 'center',
    padding: spacing.xl,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  iconLarge: {
    width: 64,
    height: 64,
    borderRadius: radius.xl,
    backgroundColor: colors.secondary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  title: {
    ...typography.h2,
    color: colors.foreground,
    textAlign: 'center',
  },
  description: {
    ...typography.body,
    color: colors.mutedForeground,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  stat: {
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  statValue: {
    ...typography.h3,
    color: colors.foreground,
    marginTop: spacing.xs,
  },
  statLabel: {
    ...typography.caption,
    color: colors.mutedForeground,
  },
  statDivider: {
    width: 1,
    backgroundColor: colors.border,
  },
  actionsContainer: {
    flexDirection: 'row',
    padding: spacing.md,
    gap: spacing.md,
  },
  actionCard: {
    flex: 1,
    backgroundColor: colors.cardBackground,
    borderRadius: radius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionTitle: {
    ...typography.button,
    color: colors.foreground,
    marginTop: spacing.sm,
  },
  actionDescription: {
    ...typography.caption,
    color: colors.mutedForeground,
    marginTop: spacing.xs,
  },
  section: {
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sectionTitle: {
    ...typography.button,
    color: colors.mutedForeground,
    marginBottom: spacing.md,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  fileName: {
    ...typography.body,
    color: colors.foreground,
    flex: 1,
  },
  fileSize: {
    ...typography.caption,
    color: colors.mutedForeground,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  actionRowText: {
    ...typography.body,
    color: colors.foreground,
  },
  timestamps: {
    padding: spacing.lg,
    alignItems: 'center',
  },
  timestamp: {
    ...typography.caption,
    color: colors.mutedForeground,
  },
  errorText: {
    ...typography.body,
    color: colors.destructive,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
});
