import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  Dimensions,
  Modal,
  TextInput,
  Text,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Code2, RefreshCw, PanelLeftClose, PanelLeft, Save } from 'lucide-react-native';
import { useProjectStore, useSettingsStore } from '../../stores';
import { bridgeService } from '../../services/claude/api';
import { FileTree, CodeEditor, TabBar } from '../../components/editor';
import { EmptyState, Button } from '../../components/common';
import { ProjectFile } from '../../types';
import { colors, spacing, radius, typography } from '../../theme';

const { width: screenWidth } = Dimensions.get('window');
const FILE_TREE_WIDTH = screenWidth < 600 ? 150 : 200; // Smaller on mobile

export default function EditorScreen() {
  const router = useRouter();
  const { currentProjectId, currentProject, currentFile, setCurrentFile } = useProjectStore();
  const { isConnected } = useSettingsStore();

  const [showFileSidebar, setShowFileSidebar] = useState(true); // Always show sidebar
  const [showNewFileModal, setShowNewFileModal] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [fileContent, setFileContent] = useState<string>('');
  const [originalContent, setOriginalContent] = useState<string>('');
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());

  const project = currentProject();

  // Fetch files from bridge server (root level or subdirectory)
  // silent: when true, don't manage isRefreshing state (caller handles it)
  const fetchFiles = useCallback(async (dirPath?: string, isExpand: boolean = false, silent: boolean = false) => {
    if (!currentProjectId || !bridgeService.isConnected()) return [];

    try {
      if (!isExpand && !silent) {
        setIsRefreshing(true);
      }

      const serverFiles = await bridgeService.getFiles(currentProjectId, dirPath);

      // Convert to ProjectFile format with full path
      const formattedFiles: ProjectFile[] = serverFiles.map((f) => ({
        path: f.path,
        name: f.name,
        isDirectory: f.isDirectory,
        type: getFileType(f.name),
      }));

      return formattedFiles;
    } catch (err: any) {
      // Ignore "request already pending" errors - they're expected during polling
      if (err?.message !== 'Request already pending') {
        console.error('[Editor] Failed to fetch files:', err);
      }
      return [];
    } finally {
      if (!isExpand && !silent) {
        setIsRefreshing(false);
      }
    }
  }, [currentProjectId]);

  // Fetch root files
  // silent: when true, don't manage isRefreshing state (caller handles it)
  const fetchRootFiles = useCallback(async (silent: boolean = false) => {
    const rootFiles = await fetchFiles(undefined, false, silent);
    console.log(`[Editor] fetchRootFiles received ${rootFiles.length} files:`, rootFiles.map(f => f.name));
    setFiles(rootFiles);
    return rootFiles;
  }, [fetchFiles]);

  // Fetch file content
  const fetchFileContent = useCallback(async (filePath: string) => {
    if (!currentProjectId || !bridgeService.isConnected()) return;

    try {
      setIsLoading(true);
      const content = await bridgeService.getFileContent(currentProjectId, filePath);
      setFileContent(content);
      setOriginalContent(content);
      setIsDirty(false);
    } catch (err) {
      console.error('[Editor] Failed to fetch file content:', err);
      setFileContent('// Failed to load file content');
      setOriginalContent('');
      setIsDirty(false);
    } finally {
      setIsLoading(false);
    }
  }, [currentProjectId]);

  // Clear state when project changes
  useEffect(() => {
    // Reset all file-related state when project changes
    setFiles([]);
    setFileContent('');
    setOriginalContent('');
    setIsDirty(false);
    setExpandedDirs(new Set());
    setCurrentFile(null);
  }, [currentProjectId, setCurrentFile]);

  // Initial file fetch and polling
  useEffect(() => {
    if (currentProjectId && isConnected) {
      fetchRootFiles();

      // Poll for file changes every 5 seconds (longer to reduce load)
      const pollInterval = setInterval(() => {
        fetchRootFiles();
      }, 5000);

      return () => clearInterval(pollInterval);
    }
  }, [currentProjectId, isConnected, fetchRootFiles]);

  // Handle directory expansion
  const handleExpandDirectory = useCallback(async (dirPath: string) => {
    if (expandedDirs.has(dirPath)) {
      // Collapse: remove directory and its children
      const newExpanded = new Set(expandedDirs);
      newExpanded.delete(dirPath);
      setExpandedDirs(newExpanded);

      // Remove children from files list
      setFiles((prev) => prev.filter((f) => !f.path.startsWith(dirPath + '/')));
    } else {
      // Expand: fetch children and add to files
      setLoadingDirs((prev) => new Set(prev).add(dirPath));

      try {
        const childFiles = await fetchFiles(dirPath, true);

        // Add children after parent in the files list
        setFiles((prev) => {
          const parentIndex = prev.findIndex((f) => f.path === dirPath);
          if (parentIndex === -1) return prev;

          const newFiles = [...prev];
          // Insert children after parent
          newFiles.splice(parentIndex + 1, 0, ...childFiles);
          return newFiles;
        });

        // Mark as expanded
        setExpandedDirs((prev) => new Set(prev).add(dirPath));
      } catch (err) {
        console.error('[Editor] Failed to expand directory:', err);
      } finally {
        setLoadingDirs((prev) => {
          const newSet = new Set(prev);
          newSet.delete(dirPath);
          return newSet;
        });
      }
    }
  }, [expandedDirs, fetchFiles]);

  // Fetch content when file is selected
  useEffect(() => {
    if (currentFile) {
      fetchFileContent(currentFile);
    }
  }, [currentFile, fetchFileContent]);

  const handleSelectFile = (path: string) => {
    setCurrentFile(path);
  };

  const handleRefresh = async () => {
    // Warn if there are unsaved changes
    if (isDirty) {
      // For now, just reset dirty state - could add confirmation dialog later
      console.log('[Editor] Discarding unsaved changes on refresh');
    }

    // Reset expanded state and refetch
    setExpandedDirs(new Set());
    setIsRefreshing(true);

    try {
      // Pass silent: true so we manage isRefreshing here, not in fetchRootFiles
      await fetchRootFiles(true);
      if (currentFile) {
        await fetchFileContent(currentFile);
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleAddFile = () => {
    // TODO: Implement file creation via bridge server
    setShowNewFileModal(false);
  };

  const handleDeleteFile = (path: string) => {
    // TODO: Implement file deletion via bridge server
  };

  const handleCodeChange = (code: string) => {
    setFileContent(code);
    setIsDirty(code !== originalContent);
  };

  const handleSaveFile = async () => {
    if (!currentProjectId || !currentFile || !isDirty) return;

    try {
      setIsSaving(true);
      await bridgeService.saveFile(currentProjectId, currentFile, fileContent);
      setOriginalContent(fileContent);
      setIsDirty(false);
    } catch (err) {
      console.error('[Editor] Failed to save file:', err);
    } finally {
      setIsSaving(false);
    }
  };

  if (!project) {
    return (
      <View style={styles.container}>
        <EmptyState
          icon={<Code2 color={colors.mutedForeground} size={48} />}
          title="No project selected"
          description="Select or create a project to view and edit code"
          action={
            <Button title="Go to Projects" onPress={() => router.push('/')} />
          }
        />
      </View>
    );
  }

  if (!isConnected) {
    return (
      <View style={styles.container}>
        <EmptyState
          icon={<Code2 color={colors.mutedForeground} size={48} />}
          title="Not connected"
          description="Connect to the bridge server to view files"
          action={
            <Button title="Settings" onPress={() => router.push('/settings')} />
          }
        />
      </View>
    );
  }

  const openTabs = currentFile ? [{ path: currentFile, modified: false }] : [];
  const currentFileData = files.find((f) => f.path === currentFile);

  return (
    <View style={styles.container}>
      {/* Header with sidebar toggle and refresh */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity
            style={styles.toggleButton}
            onPress={() => setShowFileSidebar(!showFileSidebar)}
          >
            {showFileSidebar ? (
              <PanelLeftClose color={colors.foreground} size={18} />
            ) : (
              <PanelLeft color={colors.foreground} size={18} />
            )}
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{project.name}</Text>
        </View>
        <View style={styles.headerRight}>
          {isDirty && (
            <TouchableOpacity
              style={styles.saveButton}
              onPress={handleSaveFile}
              disabled={isSaving}
            >
              {isSaving ? (
                <ActivityIndicator size="small" color={colors.brandTiger} />
              ) : (
                <Save color={colors.brandTiger} size={18} />
              )}
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.refreshButton}
            onPress={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw
              color={isRefreshing ? colors.mutedForeground : colors.foreground}
              size={18}
            />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.editorContainer}>
        {/* File Sidebar */}
        {showFileSidebar && (
          <View style={[styles.sidebar, { width: FILE_TREE_WIDTH }]}>
            <FileTree
              files={files}
              currentFile={currentFile}
              onSelectFile={handleSelectFile}
              onExpandDirectory={handleExpandDirectory}
              expandedDirs={expandedDirs}
              loadingDirs={loadingDirs}
              onAddFile={() => setShowNewFileModal(true)}
              onDeleteFile={handleDeleteFile}
            />
          </View>
        )}

        {/* Editor Area */}
        <View style={styles.editorArea}>
          {/* Tab Bar */}
          <TabBar
            tabs={openTabs}
            activeTab={currentFile}
            onSelectTab={setCurrentFile}
          />

          {/* Code Editor */}
          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.brandTiger} />
              <Text style={styles.loadingText}>Loading file...</Text>
            </View>
          ) : currentFileData ? (
            <CodeEditor
              code={fileContent}
              onChange={handleCodeChange}
              language={currentFileData.type || 'tsx'}
            />
          ) : files.length === 0 ? (
            <View style={styles.noFileSelected}>
              <Text style={styles.noFileText}>
                No files in project yet.{'\n'}Use the terminal to create files.
              </Text>
            </View>
          ) : (
            <View style={styles.noFileSelected}>
              <Text style={styles.noFileText}>
                Select a file to view and edit
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* New File Modal */}
      <Modal
        visible={showNewFileModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowNewFileModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Create New File</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="filename.tsx"
              placeholderTextColor={colors.mutedForeground}
              value={newFileName}
              onChangeText={setNewFileName}
              autoFocus
              autoCapitalize="none"
            />
            <View style={styles.modalActions}>
              <Button
                title="Cancel"
                variant="secondary"
                onPress={() => {
                  setNewFileName('');
                  setShowNewFileModal(false);
                }}
              />
              <Button
                title="Create"
                onPress={handleAddFile}
                disabled={!newFileName.trim()}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function getFileType(filename: string): 'tsx' | 'ts' | 'json' | 'css' | 'md' | 'js' | 'jsx' {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'tsx':
      return 'tsx';
    case 'ts':
      return 'ts';
    case 'jsx':
      return 'jsx';
    case 'js':
      return 'js';
    case 'json':
      return 'json';
    case 'css':
      return 'css';
    case 'md':
      return 'md';
    default:
      return 'ts';
  }
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
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.cardBackground,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerTitle: {
    ...typography.h4,
    color: colors.foreground,
  },
  toggleButton: {
    padding: spacing.xs,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  saveButton: {
    padding: spacing.sm,
  },
  refreshButton: {
    padding: spacing.sm,
  },
  editorContainer: {
    flex: 1,
    flexDirection: 'row',
  },
  sidebar: {
    height: '100%',
  },
  editorArea: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.codeBackground,
  },
  loadingText: {
    ...typography.body,
    color: colors.mutedForeground,
    marginTop: spacing.md,
  },
  noFileSelected: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.codeBackground,
    padding: spacing.lg,
  },
  noFileText: {
    ...typography.body,
    color: colors.mutedForeground,
    textAlign: 'center',
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
    fontFamily: 'monospace',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
});
