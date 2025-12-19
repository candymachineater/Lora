import React, { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  TextInput,
  Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Plus, FolderOpen, Trash2, Settings, MoreVertical } from 'lucide-react-native';
import { useProjectStore } from '../../stores';
import { createNewProject } from '../../services/storage';
import { EmptyState, Button } from '../../components/common';
import { colors, spacing, radius, typography } from '../../theme';

export default function ProjectsScreen() {
  const router = useRouter();
  const { projects, addProject, deleteProject, setCurrentProject } = useProjectStore();
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');

  const handleCreateProject = () => {
    if (!newProjectName.trim()) return;

    const project = createNewProject(newProjectName.trim());
    addProject(project);
    setNewProjectName('');
    setShowNewProjectModal(false);
    setCurrentProject(project.id);
    router.push('/chat');
  };

  const handleSelectProject = (projectId: string) => {
    setCurrentProject(projectId);
    router.push('/chat');
  };

  const handleDeleteProject = (projectId: string, projectName: string) => {
    Alert.alert(
      'Delete Project',
      `Are you sure you want to delete "${projectName}"? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteProject(projectId),
        },
      ]
    );
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Projects</Text>
          <Text style={styles.subtitle}>
            {projects.length} {projects.length === 1 ? 'project' : 'projects'}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={() => router.push('/settings')}
            style={styles.iconButton}
          >
            <Settings color={colors.foreground} size={24} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Project List or Empty State */}
      {projects.length === 0 ? (
        <EmptyState
          icon={<FolderOpen color={colors.mutedForeground} size={48} />}
          title="No projects yet"
          description="Create your first project and start building with AI"
          action={
            <Button
              title="Create Project"
              onPress={() => setShowNewProjectModal(true)}
              icon={<Plus color={colors.background} size={18} />}
            />
          }
        />
      ) : (
        <FlatList
          data={projects}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.projectCard}
              onPress={() => handleSelectProject(item.id)}
              activeOpacity={0.7}
            >
              <View style={styles.projectIcon}>
                <FolderOpen color={colors.brandTiger} size={24} />
              </View>
              <View style={styles.projectInfo}>
                <Text style={styles.projectName}>{item.name}</Text>
                <Text style={styles.projectMeta}>
                  {item.files.length} files • Updated {formatDate(item.updatedAt)}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => handleDeleteProject(item.id, item.name)}
                style={styles.deleteButton}
              >
                <Trash2 color={colors.destructive} size={18} />
              </TouchableOpacity>
            </TouchableOpacity>
          )}
          ListFooterComponent={
            <TouchableOpacity
              style={styles.addProjectCard}
              onPress={() => setShowNewProjectModal(true)}
            >
              <Plus color={colors.brandTiger} size={24} />
              <Text style={styles.addProjectText}>New Project</Text>
            </TouchableOpacity>
          }
        />
      )}

      {/* New Project Modal */}
      <Modal
        visible={showNewProjectModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowNewProjectModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Create New Project</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Project name"
              placeholderTextColor={colors.mutedForeground}
              value={newProjectName}
              onChangeText={setNewProjectName}
              autoFocus
            />
            <View style={styles.modalActions}>
              <Button
                title="Cancel"
                variant="secondary"
                onPress={() => {
                  setNewProjectName('');
                  setShowNewProjectModal(false);
                }}
              />
              <Button
                title="Create"
                onPress={handleCreateProject}
                disabled={!newProjectName.trim()}
              />
            </View>
          </View>
        </View>
      </Modal>
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
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  title: {
    ...typography.h2,
    color: colors.foreground,
  },
  subtitle: {
    ...typography.caption,
    color: colors.mutedForeground,
    marginTop: spacing.xs,
  },
  headerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  iconButton: {
    padding: spacing.sm,
  },
  list: {
    padding: spacing.md,
  },
  projectCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardBackground,
    borderRadius: radius.xl,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  projectIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.lg,
    backgroundColor: colors.secondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  projectInfo: {
    flex: 1,
    marginLeft: spacing.md,
  },
  projectName: {
    ...typography.body,
    fontWeight: '500',
    color: colors.foreground,
  },
  projectMeta: {
    ...typography.caption,
    color: colors.mutedForeground,
    marginTop: spacing.xs,
  },
  deleteButton: {
    padding: spacing.sm,
  },
  addProjectCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.secondary,
    borderRadius: radius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    gap: spacing.sm,
  },
  addProjectText: {
    ...typography.button,
    color: colors.brandTiger,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modalContent: {
    backgroundColor: colors.background,
    borderRadius: radius.xl,
    padding: spacing.xl,
    width: '100%',
    maxWidth: 400,
  },
  modalTitle: {
    ...typography.h3,
    color: colors.foreground,
    marginBottom: spacing.lg,
  },
  modalInput: {
    ...typography.body,
    color: colors.foreground,
    backgroundColor: colors.cardBackground,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
});
