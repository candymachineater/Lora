import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { FileCode, FolderOpen, FolderClosed, Plus, Trash2, ChevronRight, ChevronDown } from 'lucide-react-native';
import { ProjectFile } from '../../types';
import { colors, spacing, radius, typography } from '../../theme';

interface FileTreeProps {
  files: ProjectFile[];
  currentFile: string | null;
  onSelectFile: (path: string) => void;
  onExpandDirectory: (path: string) => void;
  expandedDirs: Set<string>;
  loadingDirs: Set<string>;
  onAddFile?: () => void;
  onDeleteFile?: (path: string) => void;
}

export function FileTree({
  files,
  currentFile,
  onSelectFile,
  onExpandDirectory,
  expandedDirs,
  loadingDirs,
  onAddFile,
  onDeleteFile,
}: FileTreeProps) {
  const getFileIcon = (name: string) => {
    const ext = name.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'tsx':
      case 'ts':
      case 'js':
      case 'jsx':
        return <FileCode color={colors.brandSapphire} size={16} />;
      case 'json':
        return <FileCode color={colors.warning} size={16} />;
      case 'css':
        return <FileCode color={colors.brandBubblegum} size={16} />;
      default:
        return <FileCode color={colors.mutedForeground} size={16} />;
    }
  };

  // Calculate indentation level from path
  const getIndentLevel = (path: string) => {
    return path.split('/').length - 1;
  };

  // Sort files: directories first, then files, alphabetically
  const sortedFiles = [...files].sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTitle}>
          <FolderOpen color={colors.foreground} size={16} />
          <Text style={styles.title}>Files</Text>
        </View>
        {onAddFile && (
          <TouchableOpacity onPress={onAddFile} style={styles.addButton}>
            <Plus color={colors.foreground} size={18} />
          </TouchableOpacity>
        )}
      </View>
      <ScrollView style={styles.fileList}>
        {sortedFiles.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No files yet</Text>
          </View>
        ) : (
          sortedFiles.map((file) => {
            const isExpanded = expandedDirs.has(file.path);
            const isLoading = loadingDirs.has(file.path);
            const indentLevel = getIndentLevel(file.path);

            return (
              <TouchableOpacity
                key={file.path}
                style={[
                  styles.fileItem,
                  currentFile === file.path && styles.fileItemActive,
                  { paddingLeft: spacing.md + (indentLevel * 16) },
                ]}
                onPress={() => {
                  if (file.isDirectory) {
                    onExpandDirectory(file.path);
                  } else {
                    onSelectFile(file.path);
                  }
                }}
              >
                {/* Directory expand/collapse indicator */}
                {file.isDirectory ? (
                  <View style={styles.expandIcon}>
                    {isLoading ? (
                      <ActivityIndicator size="small" color={colors.mutedForeground} />
                    ) : isExpanded ? (
                      <ChevronDown color={colors.mutedForeground} size={14} />
                    ) : (
                      <ChevronRight color={colors.mutedForeground} size={14} />
                    )}
                  </View>
                ) : (
                  <View style={styles.expandIcon} />
                )}

                {/* File/folder icon */}
                {file.isDirectory ? (
                  isExpanded ? (
                    <FolderOpen color={colors.warning} size={16} />
                  ) : (
                    <FolderClosed color={colors.warning} size={16} />
                  )
                ) : (
                  getFileIcon(file.name)
                )}

                {/* File name */}
                <Text
                  style={[
                    styles.fileName,
                    currentFile === file.path && styles.fileNameActive,
                    file.isDirectory && styles.directoryName,
                  ]}
                  numberOfLines={1}
                >
                  {file.name}
                </Text>

                {/* Delete button (only for files, not directories) */}
                {onDeleteFile && !file.isDirectory && file.name !== 'App.tsx' && (
                  <TouchableOpacity
                    onPress={() => onDeleteFile(file.path)}
                    style={styles.deleteButton}
                  >
                    <Trash2 color={colors.destructive} size={14} />
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.cardBackground,
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  title: {
    ...typography.button,
    color: colors.foreground,
  },
  addButton: {
    padding: spacing.xs,
  },
  fileList: {
    flex: 1,
  },
  emptyState: {
    padding: spacing.lg,
    alignItems: 'center',
  },
  emptyText: {
    ...typography.caption,
    color: colors.mutedForeground,
  },
  fileItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  fileItemActive: {
    backgroundColor: colors.secondary,
  },
  expandIcon: {
    width: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileName: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400',
    color: colors.foreground,
    flex: 1,
  },
  fileNameActive: {
    fontWeight: '600',
    color: colors.brandTiger,
  },
  directoryName: {
    fontWeight: '500',
  },
  deleteButton: {
    padding: spacing.xs,
    opacity: 0.6,
  },
});
