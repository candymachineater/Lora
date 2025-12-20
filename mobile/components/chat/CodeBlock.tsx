import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Check, Copy, FileCode } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import { CodeBlock as CodeBlockType } from '../../types';
import { colors, spacing, radius, typography } from '../../theme';

interface CodeBlockProps {
  codeBlock: CodeBlockType;
  onApply?: (codeBlock: CodeBlockType) => void;
}

export function CodeBlockComponent({ codeBlock, onApply }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await Clipboard.setStringAsync(codeBlock.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.fileInfo}>
          <FileCode color={colors.mutedForeground} size={14} />
          <Text style={styles.filename}>{codeBlock.filename}</Text>
          <Text style={styles.language}>{codeBlock.language}</Text>
        </View>
        <View style={styles.actions}>
          <TouchableOpacity style={styles.actionButton} onPress={handleCopy}>
            {copied ? (
              <Check color={colors.success} size={16} />
            ) : (
              <Copy color={colors.mutedForeground} size={16} />
            )}
          </TouchableOpacity>
          {onApply && (
            <TouchableOpacity
              style={styles.applyButton}
              onPress={() => onApply(codeBlock)}
            >
              <Text style={styles.applyButtonText}>Apply</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.codeContainer}>
          <Text style={styles.code}>{codeBlock.content}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.codeBackground,
    borderRadius: radius.lg,
    marginTop: spacing.sm,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.15)',
  },
  fileInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  filename: {
    ...typography.caption,
    color: colors.codeForeground,
    fontWeight: '500',
  },
  language: {
    ...typography.caption,
    color: colors.mutedForeground,
    marginLeft: spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  actionButton: {
    padding: spacing.xs,
  },
  applyButton: {
    backgroundColor: colors.brandTiger,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
  },
  applyButtonText: {
    ...typography.button,
    color: '#FFFFFF',
  },
  codeContainer: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  code: {
    ...typography.code,
    color: colors.codeForeground,
  },
});
