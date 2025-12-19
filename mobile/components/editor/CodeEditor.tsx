import React, { useState, useRef } from 'react';
import {
  View,
  TextInput,
  ScrollView,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { colors, spacing, typography } from '../../theme';

interface CodeEditorProps {
  code: string;
  onChange: (code: string) => void;
  language?: string;
  readOnly?: boolean;
}

export function CodeEditor({
  code,
  onChange,
  language = 'typescript',
  readOnly = false,
}: CodeEditorProps) {
  const [cursorPosition, setCursorPosition] = useState({ start: 0, end: 0 });
  const inputRef = useRef<TextInput>(null);

  const lines = code.split('\n');
  const lineNumberWidth = Math.max(lines.length.toString().length * 10 + 16, 40);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        style={styles.scrollView}
        horizontal={false}
        showsVerticalScrollIndicator
      >
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.editorContent}>
            {/* Line numbers */}
            <View style={[styles.lineNumbers, { width: lineNumberWidth }]}>
              {lines.map((_, index) => (
                <Text key={index} style={styles.lineNumber}>
                  {index + 1}
                </Text>
              ))}
            </View>

            {/* Code input */}
            <View style={styles.codeContainer}>
              <TextInput
                ref={inputRef}
                style={styles.codeInput}
                value={code}
                onChangeText={onChange}
                multiline
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                editable={!readOnly}
                placeholder="// Start coding..."
                placeholderTextColor={colors.lineNumbers}
                onSelectionChange={(e) => setCursorPosition(e.nativeEvent.selection)}
              />
            </View>
          </View>
        </ScrollView>
      </ScrollView>

      {/* Footer with cursor position */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Ln {getCurrentLine(code, cursorPosition.start)}, Col{' '}
          {getCurrentColumn(code, cursorPosition.start)}
        </Text>
        <Text style={styles.footerText}>{language.toUpperCase()}</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

// Helper functions
function getCurrentLine(code: string, position: number): number {
  const beforeCursor = code.substring(0, position);
  return beforeCursor.split('\n').length;
}

function getCurrentColumn(code: string, position: number): number {
  const beforeCursor = code.substring(0, position);
  const lines = beforeCursor.split('\n');
  return lines[lines.length - 1].length + 1;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.codeBackground,
  },
  scrollView: {
    flex: 1,
  },
  editorContent: {
    flexDirection: 'row',
    minHeight: '100%',
  },
  lineNumbers: {
    backgroundColor: 'rgba(0,0,0,0.2)',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: 'flex-end',
  },
  lineNumber: {
    ...typography.code,
    color: colors.lineNumbers,
    height: 20,
  },
  codeContainer: {
    flex: 1,
    padding: spacing.md,
  },
  codeInput: {
    ...typography.code,
    color: colors.codeForeground,
    minWidth: 500,
    textAlignVertical: 'top',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  footerText: {
    ...typography.caption,
    color: colors.lineNumbers,
  },
});
