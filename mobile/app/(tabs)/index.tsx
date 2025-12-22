import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  TextInput,
  Modal,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Plus, FolderOpen, Trash2, Settings, RefreshCw, Wifi, WifiOff, Shield, ShieldOff, Smartphone, Globe } from 'lucide-react-native';
import { useProjectStore, useSettingsStore } from '../../stores';
import { bridgeService } from '../../services/claude/api';
import { EmptyState, Button } from '../../components/common';
import { colors, spacing, radius, typography } from '../../theme';

export default function ProjectsScreen() {
  const router = useRouter();
  const { projects, addProject, setProjects, deleteProject, setCurrentProject, showNewProjectModal, setShowNewProjectModal } = useProjectStore();
  const { bridgeServerUrl, isConnected, setIsConnected } = useSettingsStore();
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectSandbox, setNewProjectSandbox] = useState(true); // Default to sandbox mode
  const [newProjectType, setNewProjectType] = useState<'mobile' | 'web'>('mobile'); // Default to mobile
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // Connect to bridge server and sync projects
  const syncProjects = useCallback(async () => {
    if (!bridgeServerUrl) return;

    setIsSyncing(true);
    try {
      if (!bridgeService.isConnected()) {
        const serverProjects = await bridgeService.connect(bridgeServerUrl);
        setIsConnected(true);
        // Sync projects from server (preserve sandbox setting from existing projects)
        if (serverProjects && serverProjects.length > 0) {
          const formattedProjects = serverProjects.map(p => {
            const existing = projects.find(ep => ep.id === p.id);
            return {
              id: p.id,
              name: p.name,
              path: p.path,
              files: [],
              sandbox: existing?.sandbox ?? true, // Preserve existing or default to sandbox
              projectType: p.projectType, // Sync from server
              createdAt: new Date(p.createdAt),
              updatedAt: new Date(p.createdAt),
            };
          });
          setProjects(formattedProjects);
        }
      } else {
        // Already connected, just list projects
        const serverProjects = await bridgeService.listProjects();
        if (serverProjects && serverProjects.length > 0) {
          const formattedProjects = serverProjects.map(p => {
            const existing = projects.find(ep => ep.id === p.id);
            return {
              id: p.id,
              name: p.name,
              path: p.path,
              files: [],
              sandbox: existing?.sandbox ?? true, // Preserve existing or default to sandbox
              projectType: p.projectType, // Sync from server
              createdAt: new Date(p.createdAt),
              updatedAt: new Date(p.createdAt),
            };
          });
          setProjects(formattedProjects);
        }
      }
    } catch (err) {
      console.error('[Projects] Sync failed:', err);
      setIsConnected(false);
    } finally {
      setIsSyncing(false);
    }
  }, [bridgeServerUrl, setIsConnected, setProjects]);

  // Auto-connect on mount
  useEffect(() => {
    if (bridgeServerUrl && !bridgeService.isConnected()) {
      syncProjects();
    }
  }, [bridgeServerUrl]);

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;

    setIsLoading(true);
    try {
      if (bridgeService.isConnected()) {
        // Create on bridge server
        const serverProject = await bridgeService.createProject(newProjectName.trim(), newProjectType);
        const project = {
          id: serverProject.id,
          name: serverProject.name,
          path: serverProject.path,
          files: [],
          sandbox: newProjectSandbox, // Use the selected sandbox mode
          projectType: serverProject.projectType, // From server response
          createdAt: new Date(serverProject.createdAt),
          updatedAt: new Date(serverProject.createdAt),
        };
        addProject(project);
        setCurrentProject(project.id);
      } else {
        Alert.alert('Not Connected', 'Connect to the bridge server first in Settings.');
        setIsLoading(false);
        return;
      }

      setNewProjectName('');
      setNewProjectSandbox(true); // Reset to default
      setNewProjectType('mobile'); // Reset to default
      setShowNewProjectModal(false);
      router.push('/chat');
    } catch (err) {
      console.error('[Projects] Create failed:', err);
      Alert.alert('Error', 'Failed to create project. Check your connection.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectProject = (projectId: string) => {
    setCurrentProject(projectId);
    router.push('/chat');
  };

  const handleDeleteProject = (projectId: string, projectName: string) => {
    Alert.alert(
      'Delete Project',
      `Are you sure you want to delete "${projectName}"? This will also delete all project files on the server. This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              // Delete from server first
              if (bridgeService.isConnected()) {
                await bridgeService.deleteProject(projectId);
              }
              // Then delete from local store
              deleteProject(projectId);
            } catch (err) {
              console.error('[Projects] Delete failed:', err);
              Alert.alert('Error', 'Failed to delete project from server. Local copy removed.');
              deleteProject(projectId);
            }
          },
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
          <View style={styles.statusRow}>
            {isConnected ? (
              <Wifi color="#22C55E" size={14} />
            ) : (
              <WifiOff color="#EF4444" size={14} />
            )}
            <Text style={[styles.subtitle, { color: isConnected ? '#22C55E' : '#EF4444' }]}>
              {isConnected ? 'Connected' : 'Disconnected'}
            </Text>
            <Text style={styles.subtitle}>
              • {projects.length} {projects.length === 1 ? 'project' : 'projects'}
            </Text>
          </View>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={syncProjects}
            style={styles.iconButton}
            disabled={isSyncing}
          >
            {isSyncing ? (
              <ActivityIndicator size="small" color={colors.foreground} />
            ) : (
              <RefreshCw color={colors.foreground} size={22} />
            )}
          </TouchableOpacity>
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
                {item.projectType === 'web' ? (
                  <Globe color={colors.brandTiger} size={24} />
                ) : (
                  <Smartphone color={colors.brandTiger} size={24} />
                )}
              </View>
              <View style={styles.projectInfo}>
                <View style={styles.projectHeader}>
                  <Text style={styles.projectName}>{item.name}</Text>
                  <View style={[
                    styles.typeBadge,
                    item.projectType === 'web' ? styles.webBadge : styles.mobileBadge
                  ]}>
                    <Text style={styles.typeBadgeText}>
                      {item.projectType === 'web' ? 'WEB' : 'MOBILE'}
                    </Text>
                  </View>
                </View>
                <Text style={styles.projectMeta} numberOfLines={1}>
                  {item.path || `Updated ${formatDate(item.updatedAt)}`}
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
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? -100 : 0}
        >
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

            {/* Project Type Selector */}
            <View style={styles.projectTypeSelector}>
              <Text style={styles.selectorLabel}>Project Type</Text>
              <View style={styles.projectTypeOptions}>
                <TouchableOpacity
                  style={[
                    styles.typeOption,
                    newProjectType === 'mobile' && styles.typeOptionSelected
                  ]}
                  onPress={() => setNewProjectType('mobile')}
                >
                  <Smartphone
                    color={newProjectType === 'mobile' ? colors.brandTiger : colors.mutedForeground}
                    size={20}
                  />
                  <Text style={[
                    styles.typeOptionText,
                    newProjectType === 'mobile' && styles.typeOptionTextSelected
                  ]}>
                    Mobile App
                  </Text>
                  <Text style={styles.typeOptionSubtext}>Expo / React Native</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.typeOption,
                    newProjectType === 'web' && styles.typeOptionSelected
                  ]}
                  onPress={() => setNewProjectType('web')}
                >
                  <Globe
                    color={newProjectType === 'web' ? colors.brandTiger : colors.mutedForeground}
                    size={20}
                  />
                  <Text style={[
                    styles.typeOptionText,
                    newProjectType === 'web' && styles.typeOptionTextSelected
                  ]}>
                    Web App
                  </Text>
                  <Text style={styles.typeOptionSubtext}>React + Vite</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Sandbox Mode Toggle */}
            <TouchableOpacity
              style={styles.sandboxToggle}
              onPress={() => setNewProjectSandbox(!newProjectSandbox)}
            >
              <View style={styles.sandboxIconContainer}>
                {newProjectSandbox ? (
                  <Shield color={colors.success} size={20} />
                ) : (
                  <ShieldOff color={colors.warning} size={20} />
                )}
              </View>
              <View style={styles.sandboxTextContainer}>
                <Text style={styles.sandboxLabel}>
                  {newProjectSandbox ? 'Sandbox Mode' : 'Full Access Mode'}
                </Text>
                <Text style={styles.sandboxDescription}>
                  {newProjectSandbox
                    ? 'Terminal restricted to project folder'
                    : 'Terminal has full filesystem access'}
                </Text>
              </View>
              <View style={[
                styles.sandboxIndicator,
                { backgroundColor: newProjectSandbox ? colors.success : colors.warning }
              ]} />
            </TouchableOpacity>

            <View style={styles.modalActions}>
              <Button
                title="Cancel"
                variant="secondary"
                onPress={() => {
                  setNewProjectName('');
                  setNewProjectSandbox(true);
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
        </KeyboardAvoidingView>
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
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
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
  sandboxToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardBackground,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
  },
  sandboxIconContainer: {
    marginRight: spacing.sm,
  },
  sandboxTextContainer: {
    flex: 1,
  },
  sandboxLabel: {
    ...typography.body,
    fontWeight: '500',
    color: colors.foreground,
  },
  sandboxDescription: {
    ...typography.caption,
    color: colors.mutedForeground,
    marginTop: 2,
  },
  sandboxIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  projectTypeSelector: {
    marginBottom: spacing.lg,
  },
  selectorLabel: {
    ...typography.caption,
    color: colors.foreground,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  projectTypeOptions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  typeOption: {
    flex: 1,
    backgroundColor: colors.cardBackground,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    gap: spacing.xs,
  },
  typeOptionSelected: {
    borderColor: colors.brandTiger,
    backgroundColor: colors.secondary,
  },
  typeOptionText: {
    ...typography.caption,
    color: colors.mutedForeground,
    fontWeight: '500',
  },
  typeOptionTextSelected: {
    color: colors.brandTiger,
    fontWeight: '600',
  },
  typeOptionSubtext: {
    ...typography.caption,
    fontSize: 10,
    color: colors.mutedForeground,
  },
  projectHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  typeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  webBadge: {
    backgroundColor: '#3b82f6',
  },
  mobileBadge: {
    backgroundColor: '#10b981',
  },
  typeBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
  },
});
