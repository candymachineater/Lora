import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  Dimensions,
  Modal,
  TextInput,
  Text,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Code2, Plus } from 'lucide-react-native';
import { useProjectStore } from '../../stores';
import { FileTree, CodeEditor, TabBar } from '../../components/editor';
import { EmptyState, Button } from '../../components/common';
import { ProjectFile } from '../../types';
import { colors, spacing, radius, typography } from '../../theme';

const { width: screenWidth } = Dimensions.get('window');
const FILE_TREE_WIDTH = 200;

export default function EditorScreen() {
  const router = useRouter();
  const {
    currentProjectId,
    currentProject,
    currentFile,
    setCurrentFile,
    updateFile,
    addFile,
    deleteFile,
  } = useProjectStore();

  const [showFileSidebar, setShowFileSidebar] = useState(screenWidth > 600);
  const [showNewFileModal, setShowNewFileModal] = useState(false);
  const [newFileName, setNewFileName] = useState('');

  const project = currentProject();
  const currentFileData = project?.files.find((f) => f.path === currentFile);

  const handleAddFile = () => {
    if (!newFileName.trim() || !currentProjectId) return;

    let fileName = newFileName.trim();
    if (!fileName.includes('.')) {
      fileName += '.tsx';
    }

    const newFile: ProjectFile = {
      path: fileName,
      content: `import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function Component() {
  return (
    <View style={styles.container}>
      <Text>New Component</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
`,
      type: fileName.endsWith('.tsx') || fileName.endsWith('.jsx') ? 'tsx' : 'ts',
    };

    addFile(currentProjectId, newFile);
    setCurrentFile(newFile.path);
    setNewFileName('');
    setShowNewFileModal(false);
  };

  const handleDeleteFile = (path: string) => {
    if (!currentProjectId) return;
    deleteFile(currentProjectId, path);
  };

  const handleCodeChange = (code: string) => {
    if (!currentProjectId || !currentFile) return;
    updateFile(currentProjectId, currentFile, code);
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

  const openTabs = currentFile
    ? [{ path: currentFile, modified: false }]
    : [];

  return (
    <View style={styles.container}>
      <View style={styles.editorContainer}>
        {/* File Sidebar */}
        {showFileSidebar && (
          <View style={[styles.sidebar, { width: FILE_TREE_WIDTH }]}>
            <FileTree
              files={project.files}
              currentFile={currentFile}
              onSelectFile={setCurrentFile}
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
          {currentFileData ? (
            <CodeEditor
              code={currentFileData.content}
              onChange={handleCodeChange}
              language={currentFileData.type}
            />
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
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
  noFileSelected: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.codeBackground,
  },
  noFileText: {
    ...typography.body,
    color: colors.mutedForeground,
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
