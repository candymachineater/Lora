import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { FileCode, FolderOpen, Plus, Trash2 } from 'lucide-react-native';
import { ProjectFile } from '../../types';
import { colors, spacing, radius, typography } from '../../theme';

interface FileTreeProps {
  files: ProjectFile[];
  currentFile: string | null;
  onSelectFile: (path: string) => void;
  onAddFile?: () => void;
  onDeleteFile?: (path: string) => void;
}

export function FileTree({
  files,
  currentFile,
  onSelectFile,
  onAddFile,
  onDeleteFile,
}: FileTreeProps) {
  const getFileIcon = (type: string) => {
    switch (type) {
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
        {files.map((file) => (
          <TouchableOpacity
            key={file.path}
            style={[
              styles.fileItem,
              currentFile === file.path && styles.fileItemActive,
            ]}
            onPress={() => onSelectFile(file.path)}
          >
            {getFileIcon(file.type)}
            <Text
              style={[
                styles.fileName,
                currentFile === file.path && styles.fileNameActive,
              ]}
              numberOfLines={1}
            >
              {file.path}
            </Text>
            {onDeleteFile && file.path !== 'App.tsx' && (
              <TouchableOpacity
                onPress={() => onDeleteFile(file.path)}
                style={styles.deleteButton}
              >
                <Trash2 color={colors.destructive} size={14} />
              </TouchableOpacity>
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
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
  fileName: {
    ...typography.caption,
    color: colors.foreground,
    flex: 1,
  },
  fileNameActive: {
    fontWeight: '500',
  },
  deleteButton: {
    padding: spacing.xs,
    opacity: 0.6,
  },
});
