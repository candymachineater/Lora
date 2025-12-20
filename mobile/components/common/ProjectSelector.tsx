import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  FlatList,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import {
  ChevronDown,
  FolderOpen,
  Plus,
  Trash2,
  RefreshCw,
  Settings,
  Shield,
  ShieldOff,
  X,
} from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useProjectStore, useSettingsStore } from '../../stores';
import { bridgeService } from '../../services/claude/api';
import { colors, spacing, radius, typography } from '../../theme';

export function ProjectSelector() {
  const router = useRouter();
  const { projects, currentProjectId, addProject, setProjects, deleteProject, setCurrentProject, currentProject } = useProjectStore();
  const { bridgeServerUrl, isConnected, setIsConnected } = useSettingsStore();

  const [showDropdown, setShowDropdown] = useState(false);
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectSandbox, setNewProjectSandbox] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const project = currentProject();

  // Sync projects from server
  const syncProjects = useCallback(async () => {
    if (!bridgeServerUrl) return;

    setIsSyncing(true);
    try {
      if (!bridgeService.isConnected()) {
        const serverProjects = await bridgeService.connect(bridgeServerUrl);
        setIsConnected(true);
        if (serverProjects && serverProjects.length > 0) {
          const formattedProjects = serverProjects.map(p => {
            const existing = projects.find(ep => ep.id === p.id);
            return {
              id: p.id,
              name: p.name,
              path: p.path,
              files: [],
              sandbox: existing?.sandbox ?? true,
              createdAt: new Date(p.createdAt),
              updatedAt: new Date(p.createdAt),
            };
          });
          setProjects(formattedProjects);
        }
      } else {
        const serverProjects = await bridgeService.listProjects();
        if (serverProjects && serverProjects.length > 0) {
          const formattedProjects = serverProjects.map(p => {
            const existing = projects.find(ep => ep.id === p.id);
            return {
              id: p.id,
              name: p.name,
              path: p.path,
              files: [],
              sandbox: existing?.sandbox ?? true,
              createdAt: new Date(p.createdAt),
              updatedAt: new Date(p.createdAt),
            };
          });
          setProjects(formattedProjects);
        }
      }
    } catch (err) {
      console.error('[ProjectSelector] Sync failed:', err);
      setIsConnected(false);
    } finally {
      setIsSyncing(false);
    }
  }, [bridgeServerUrl, projects, setIsConnected, setProjects]);

  // Auto-sync on mount
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
        const serverProject = await bridgeService.createProject(newProjectName.trim());
        const newProject = {
          id: serverProject.id,
          name: serverProject.name,
          path: serverProject.path,
          files: [],
          sandbox: newProjectSandbox,
          createdAt: new Date(serverProject.createdAt),
          updatedAt: new Date(serverProject.createdAt),
        };
        addProject(newProject);
        setCurrentProject(newProject.id);
      } else {
        Alert.alert('Not Connected', 'Connect to the bridge server first in Settings.');
        setIsLoading(false);
        return;
      }

      setNewProjectName('');
      setNewProjectSandbox(true);
      setShowNewProjectModal(false);
      setShowDropdown(false);
    } catch (err) {
      console.error('[ProjectSelector] Create failed:', err);
      Alert.alert('Error', 'Failed to create project.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectProject = (projectId: string) => {
    if (projectId !== currentProjectId) {
      setCurrentProject(projectId);
    }
    setShowDropdown(false);
  };

  const handleDeleteProject = (projectId: string, projectName: string) => {
    Alert.alert(
      'Delete Project',
      `Are you sure you want to delete "${projectName}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              if (bridgeService.isConnected()) {
                await bridgeService.deleteProject(projectId);
              }
              deleteProject(projectId);
              // If we deleted the current project, clear selection
              if (projectId === currentProjectId) {
                const remaining = projects.filter(p => p.id !== projectId);
                if (remaining.length > 0) {
                  setCurrentProject(remaining[0].id);
                }
              }
            } catch (err) {
              console.error('[ProjectSelector] Delete failed:', err);
              Alert.alert('Error', 'Failed to delete project.');
              deleteProject(projectId);
            }
          },
        },
      ]
    );
  };

  return (
    <>
      {/* Main Selector Button */}
      <TouchableOpacity
        style={styles.selectorButton}
        onPress={() => setShowDropdown(true)}
      >
        <FolderOpen color={colors.brandTiger} size={16} />
        <Text style={styles.selectorText} numberOfLines={1}>
          {project?.name || 'Select Project'}
        </Text>
        <ChevronDown color={colors.mutedForeground} size={16} />
      </TouchableOpacity>

      {/* Dropdown Modal */}
      <Modal
        visible={showDropdown}
        animationType="fade"
        transparent
        onRequestClose={() => setShowDropdown(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowDropdown(false)}
        >
          <View style={styles.dropdownContainer}>
            {/* Header */}
            <View style={styles.dropdownHeader}>
              <Text style={styles.dropdownTitle}>Projects</Text>
              <View style={styles.dropdownActions}>
                <TouchableOpacity
                  onPress={syncProjects}
                  style={styles.headerButton}
                  disabled={isSyncing}
                >
                  {isSyncing ? (
                    <ActivityIndicator size="small" color={colors.foreground} />
                  ) : (
                    <RefreshCw color={colors.foreground} size={18} />
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    setShowDropdown(false);
                    router.push('/settings');
                  }}
                  style={styles.headerButton}
                >
                  <Settings color={colors.foreground} size={18} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setShowDropdown(false)}
                  style={styles.headerButton}
                >
                  <X color={colors.foreground} size={18} />
                </TouchableOpacity>
              </View>
            </View>

            {/* Project List */}
            <FlatList
              data={projects}
              keyExtractor={(item) => item.id}
              style={styles.projectList}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.projectItem,
                    item.id === currentProjectId && styles.projectItemSelected,
                  ]}
                  onPress={() => handleSelectProject(item.id)}
                >
                  <FolderOpen
                    color={item.id === currentProjectId ? colors.brandTiger : colors.mutedForeground}
                    size={18}
                  />
                  <Text
                    style={[
                      styles.projectName,
                      item.id === currentProjectId && styles.projectNameSelected,
                    ]}
                    numberOfLines={1}
                  >
                    {item.name}
                  </Text>
                  <TouchableOpacity
                    onPress={(e) => {
                      e.stopPropagation();
                      handleDeleteProject(item.id, item.name);
                    }}
                    style={styles.deleteButton}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Trash2 color={colors.destructive} size={16} />
                  </TouchableOpacity>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <Text style={styles.emptyText}>No projects yet</Text>
                </View>
              }
            />

            {/* New Project Button */}
            <TouchableOpacity
              style={styles.newProjectButton}
              onPress={() => {
                setShowDropdown(false);
                setShowNewProjectModal(true);
              }}
            >
              <Plus color={colors.brandTiger} size={18} />
              <Text style={styles.newProjectText}>New Project</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* New Project Modal */}
      <Modal
        visible={showNewProjectModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowNewProjectModal(false)}
      >
        <View style={styles.newProjectOverlay}>
          <View style={styles.newProjectContent}>
            <Text style={styles.modalTitle}>Create New Project</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Project name"
              placeholderTextColor={colors.mutedForeground}
              value={newProjectName}
              onChangeText={setNewProjectName}
              autoFocus
            />

            {/* Sandbox Toggle */}
            <TouchableOpacity
              style={styles.sandboxToggle}
              onPress={() => setNewProjectSandbox(!newProjectSandbox)}
            >
              {newProjectSandbox ? (
                <Shield color={colors.success} size={20} />
              ) : (
                <ShieldOff color={colors.warning} size={20} />
              )}
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
              <View
                style={[
                  styles.sandboxIndicator,
                  { backgroundColor: newProjectSandbox ? colors.success : colors.warning },
                ]}
              />
            </TouchableOpacity>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => {
                  setNewProjectName('');
                  setNewProjectSandbox(true);
                  setShowNewProjectModal(false);
                }}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.createButton,
                  !newProjectName.trim() && styles.createButtonDisabled,
                ]}
                onPress={handleCreateProject}
                disabled={!newProjectName.trim() || isLoading}
              >
                {isLoading ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={styles.createButtonText}>Create</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  selectorButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardBackground,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
    minWidth: 140,
    maxWidth: 220,
  },
  selectorText: {
    fontSize: 15,
    color: colors.foreground,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-start',
    paddingTop: 100,
    paddingHorizontal: spacing.lg,
  },
  dropdownContainer: {
    backgroundColor: colors.background,
    borderRadius: radius.xl,
    maxHeight: 400,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  dropdownHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  dropdownTitle: {
    ...typography.h4,
    color: colors.foreground,
  },
  dropdownActions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  headerButton: {
    padding: spacing.xs,
  },
  projectList: {
    maxHeight: 250,
  },
  projectItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  projectItemSelected: {
    backgroundColor: colors.secondary,
  },
  projectName: {
    ...typography.body,
    color: colors.foreground,
    flex: 1,
  },
  projectNameSelected: {
    color: colors.brandTiger,
    fontWeight: '600',
  },
  deleteButton: {
    padding: spacing.xs,
  },
  emptyState: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyText: {
    ...typography.body,
    color: colors.mutedForeground,
  },
  newProjectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.secondary,
  },
  newProjectText: {
    ...typography.button,
    color: colors.brandTiger,
  },
  newProjectOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  newProjectContent: {
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
    marginBottom: spacing.md,
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
    gap: spacing.sm,
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
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  cancelButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.secondary,
  },
  cancelButtonText: {
    ...typography.button,
    color: colors.foreground,
  },
  createButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.brandTiger,
  },
  createButtonDisabled: {
    opacity: 0.5,
  },
  createButtonText: {
    ...typography.button,
    color: '#FFF',
  },
});
