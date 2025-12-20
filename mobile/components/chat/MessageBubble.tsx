import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { User, Bot } from 'lucide-react-native';
import { Message, CodeBlock } from '../../types';
import { CodeBlockComponent } from './CodeBlock';
import { parseCodeBlocks, extractTextContent } from '../../utils';
import { colors, spacing, radius, typography, shadows } from '../../theme';

interface MessageBubbleProps {
  message: Message;
  onApplyCode?: (codeBlock: CodeBlock) => void;
}

export function MessageBubble({ message, onApplyCode }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const textContent = extractTextContent(message.content);
  const codeBlocks = message.codeBlocks || parseCodeBlocks(message.content);

  return (
    <View
      style={[styles.container, isUser ? styles.userContainer : styles.assistantContainer]}
    >
      <View style={[styles.avatar, isUser ? styles.userAvatar : styles.assistantAvatar]}>
        {isUser ? (
          <User color={colors.background} size={16} />
        ) : (
          <Bot color={colors.background} size={16} />
        )}
      </View>
      <View style={[styles.bubble, isUser ? styles.userBubble : styles.assistantBubble]}>
        {textContent.length > 0 && (
          <Text style={[styles.text, isUser ? styles.userText : styles.assistantText]}>
            {textContent}
          </Text>
        )}
        {codeBlocks.map((block, index) => (
          <CodeBlockComponent
            key={`${block.filename}-${index}`}
            codeBlock={block}
            onApply={!isUser ? onApplyCode : undefined}
          />
        ))}
        {message.isStreaming && (
          <Text style={styles.streaming}>...</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    marginVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  userContainer: {
    flexDirection: 'row-reverse',
  },
  assistantContainer: {
    flexDirection: 'row',
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  userAvatar: {
    backgroundColor: colors.foreground,
    marginLeft: spacing.sm,
  },
  assistantAvatar: {
    backgroundColor: colors.brandTiger,
    marginRight: spacing.sm,
  },
  bubble: {
    maxWidth: '80%',
    borderRadius: radius.xl,
    padding: spacing.md,
    ...shadows.card,
  },
  userBubble: {
    backgroundColor: colors.userBubble,
    borderBottomRightRadius: radius.sm,
  },
  assistantBubble: {
    backgroundColor: colors.assistantBubble,
    borderBottomLeftRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  text: {
    ...typography.body,
  },
  userText: {
    color: colors.userBubbleText,
  },
  assistantText: {
    color: colors.assistantBubbleText,
  },
  streaming: {
    ...typography.body,
    color: colors.mutedForeground,
    marginTop: spacing.xs,
  },
});
