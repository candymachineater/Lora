import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  TextInput,
  Text,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import ViewShot from 'react-native-view-shot';
import { Code2, ChevronLeft, Save, Plus, RefreshCw } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useProjectStore, useSettingsStore, useVoiceStore } from '../../stores';
import { bridgeService } from '../../services/claude/api';
import { FileTree, CodeEditor } from '../../components/editor';
import { EmptyState, Button } from '../../components/common';
import { ProjectFile } from '../../types';
import { colors, spacing, radius, typography, shadows } from '../../theme';

export default function EditorScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { currentProjectId, currentProject, currentFile, setCurrentFile } = useProjectStore();
  const { isConnected } = useSettingsStore();
  const { pendingEditorAction, clearEditorAction, registerScreenshotCapture, unregisterScreenshotCapture } = useVoiceStore();
  const viewShotRef = useRef<ViewShot>(null);

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

  // Fetch files from bridge server
  const fetchFiles = useCallback(async (dirPath?: string, isExpand: boolean = false, silent: boolean = false) => {
    if (!currentProjectId || !bridgeService.isConnected()) return [];

    try {
      if (!isExpand && !silent) {
        setIsRefreshing(true);
      }

      const serverFiles = await bridgeService.getFiles(currentProjectId, dirPath);

      const formattedFiles: ProjectFile[] = serverFiles.map((f) => ({
        path: f.path,
        name: f.name,
        isDirectory: f.isDirectory,
        type: getFileType(f.name),
      }));

      return formattedFiles;
    } catch (err: any) {
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

  const fetchRootFiles = useCallback(async (silent: boolean = false) => {
    const rootFiles = await fetchFiles(undefined, false, silent);
    setFiles(rootFiles);
    return rootFiles;
  }, [fetchFiles]);

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
    setFiles([]);
    setFileContent('');
    setOriginalContent('');
    setIsDirty(false);
    setExpandedDirs(new Set());
    setCurrentFile(null);
  }, [currentProjectId, setCurrentFile]);

  // Initial file fetch
  useEffect(() => {
    if (currentProjectId && isConnected) {
      fetchRootFiles();
    }
  }, [currentProjectId, isConnected, fetchRootFiles]);

  // Handle directory expansion
  const handleExpandDirectory = useCallback(async (dirPath: string) => {
    if (expandedDirs.has(dirPath)) {
      const newExpanded = new Set(expandedDirs);
      newExpanded.delete(dirPath);
      setExpandedDirs(newExpanded);
      setFiles((prev) => prev.filter((f) => !f.path.startsWith(dirPath + '/')));
    } else {
      setLoadingDirs((prev) => new Set(prev).add(dirPath));

      try {
        const childFiles = await fetchFiles(dirPath, true);
        setFiles((prev) => {
          const parentIndex = prev.findIndex((f) => f.path === dirPath);
          if (parentIndex === -1) return prev;
          const newFiles = [...prev];
          newFiles.splice(parentIndex + 1, 0, ...childFiles);
          return newFiles;
        });
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

  // Handle voice agent editor actions
  useEffect(() => {
    if (pendingEditorAction && pendingEditorAction.type) {
      console.log('[Editor] Handling voice action:', pendingEditorAction);

      const handleAction = async () => {
        switch (pendingEditorAction.type) {
          case 'open_file':
            if (pendingEditorAction.filePath) {
              console.log('[Editor] Opening file:', pendingEditorAction.filePath);
              setCurrentFile(pendingEditorAction.filePath);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }
            break;

          case 'close_file':
            console.log('[Editor] Closing file');
            handleBackToFiles();
            break;

          case 'save_file':
            if (currentFile && isDirty) {
              console.log('[Editor] Saving file');
              await handleSaveFile();
            }
            break;

          case 'refresh_files':
            console.log('[Editor] Refreshing files');
            await handleRefresh();
            break;

          case 'set_file_content':
            if (pendingEditorAction.content !== undefined) {
              console.log('[Editor] Setting file content');
              setFileContent(pendingEditorAction.content);
              setIsDirty(pendingEditorAction.content !== originalContent);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }
            break;
        }

        // Clear the action after handling
        clearEditorAction();
      };

      handleAction();
    }
  }, [pendingEditorAction, clearEditorAction, currentFile, isDirty, originalContent, setCurrentFile]);

  // Register screenshot capture function for voice agent
  useEffect(() => {
    const captureScreenshot = async (): Promise<string | undefined> => {
      if (!viewShotRef.current) {
        console.log('[Editor] ViewShot ref not available');
        return undefined;
      }
      try {
        const uri = await viewShotRef.current.capture();
        console.log('[Editor] Screenshot captured');
        return uri;
      } catch (error) {
        console.error('[Editor] Failed to capture screenshot:', error);
        return undefined;
      }
    };

    registerScreenshotCapture('editor', captureScreenshot);
    console.log('[Editor] Registered screenshot capture');

    return () => {
      unregisterScreenshotCapture('editor');
      console.log('[Editor] Unregistered screenshot capture');
    };
  }, [registerScreenshotCapture, unregisterScreenshotCapture]);

  const handleSelectFile = (path: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCurrentFile(path);
  };

  const handleBackToFiles = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (isDirty) {
      // Could add confirmation dialog here
    }
    setCurrentFile(null);
    setFileContent('');
    setOriginalContent('');
    setIsDirty(false);
  };

  const handleRefresh = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpandedDirs(new Set());
    setIsRefreshing(true);
    try {
      await fetchRootFiles(true);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleCodeChange = (code: string) => {
    setFileContent(code);
    setIsDirty(code !== originalContent);
  };

  const handleSaveFile = async () => {
    if (!currentProjectId || !currentFile || !isDirty) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
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
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <EmptyState
          icon={<Code2 color={colors.mutedForeground} size={48} />}
          title="No project selected"
          description="Select or create a project to view files"
          action={
            <Button title="Go to Projects" onPress={() => router.push('/')} />
          }
        />
      </View>
    );
  }

  if (!isConnected) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
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

  const currentFileData = files.find((f) => f.path === currentFile);

  // Show code editor when file is selected
  if (currentFile && currentFileData) {
    return (
      <ViewShot ref={viewShotRef} style={[styles.container, { paddingTop: insets.top }]} options={{ format: 'png', quality: 0.8, result: 'base64' }}>
        {/* Editor Header */}
        <View style={styles.editorHeader}>
          <TouchableOpacity style={styles.backButton} onPress={handleBackToFiles}>
            <ChevronLeft color={colors.foreground} size={24} />
          </TouchableOpacity>
          <View style={styles.fileInfo}>
            <Text style={styles.fileName} numberOfLines={1}>
              {currentFileData.name}
            </Text>
            {isDirty && <View style={styles.dirtyIndicator} />}
          </View>
          <TouchableOpacity
            style={[styles.saveButton, !isDirty && styles.saveButtonDisabled]}
            onPress={handleSaveFile}
            disabled={!isDirty || isSaving}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color={colors.brandTiger} />
            ) : (
              <Save color={isDirty ? colors.brandTiger : colors.mutedForeground} size={22} />
            )}
          </TouchableOpacity>
        </View>

        {/* Code Editor */}
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.brandTiger} />
            <Text style={styles.loadingText}>Loading file...</Text>
          </View>
        ) : (
          <CodeEditor
            code={fileContent}
            onChange={handleCodeChange}
            language={currentFileData.type || 'tsx'}
          />
        )}
      </ViewShot>
    );
  }

  // Show file tree by default
  return (
    <ViewShot ref={viewShotRef} style={[styles.container, { paddingTop: insets.top }]} options={{ format: 'png', quality: 0.8, result: 'base64' }}>
      {/* File Tree Header */}
      <View style={styles.fileTreeHeader}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <ChevronLeft color={colors.foreground} size={24} />
        </TouchableOpacity>
        <Text style={styles.projectTitle}>{project.name}</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.headerIconButton}
            onPress={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw
              color={isRefreshing ? colors.mutedForeground : colors.foreground}
              size={20}
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerIconButton}
            onPress={() => setShowNewFileModal(true)}
          >
            <Plus color={colors.foreground} size={22} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Full Width File Tree */}
      <View style={styles.fileTreeContainer}>
        {files.length === 0 ? (
          <View style={styles.emptyFiles}>
            <Text style={styles.emptyFilesText}>
              No files yet.{'\n'}Use the terminal to create files.
            </Text>
          </View>
        ) : (
          <FileTree
            files={files}
            currentFile={currentFile}
            onSelectFile={handleSelectFile}
            onExpandDirectory={handleExpandDirectory}
            expandedDirs={expandedDirs}
            loadingDirs={loadingDirs}
            onAddFile={() => setShowNewFileModal(true)}
            onDeleteFile={() => {}}
          />
        )}
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
                onPress={() => {
                  // TODO: Implement file creation
                  setShowNewFileModal(false);
                }}
                disabled={!newFileName.trim()}
              />
            </View>
          </View>
        </View>
      </Modal>
    </ViewShot>
  );
}

function getFileType(filename: string): 'tsx' | 'ts' | 'json' | 'css' | 'md' | 'js' | 'jsx' {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'tsx': return 'tsx';
    case 'ts': return 'ts';
    case 'jsx': return 'jsx';
    case 'js': return 'js';
    case 'json': return 'json';
    case 'css': return 'css';
    case 'md': return 'md';
    default: return 'ts';
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  // File Tree Header
  fileTreeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    ...shadows.sm,
  },
  backButton: {
    padding: spacing.xs,
  },
  projectTitle: {
    flex: 1,
    ...typography.h4,
    color: colors.foreground,
    marginLeft: spacing.sm,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  headerIconButton: {
    padding: spacing.sm,
  },
  // File Tree
  fileTreeContainer: {
    flex: 1,
    backgroundColor: colors.cardBackground,
  },
  emptyFiles: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  emptyFilesText: {
    ...typography.body,
    color: colors.mutedForeground,
    textAlign: 'center',
  },
  // Editor Header
  editorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    ...shadows.sm,
  },
  fileInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: spacing.sm,
  },
  fileName: {
    ...typography.h4,
    color: colors.foreground,
  },
  dirtyIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.brandTiger,
    marginLeft: spacing.sm,
  },
  saveButton: {
    padding: spacing.sm,
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  // Loading
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
  // Modal
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
    ...shadows.lg,
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
