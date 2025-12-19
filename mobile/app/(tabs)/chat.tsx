import React, { useRef, useEffect } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Text,
} from 'react-native';
import { useRouter } from 'expo-router';
import { MessageCircle } from 'lucide-react-native';
import { useProjectStore, useChatStore, useSettingsStore } from '../../stores';
import { claudeService } from '../../services/claude';
import { ChatInput, MessageBubble } from '../../components/chat';
import { EmptyState, Button } from '../../components/common';
import { parseCodeBlocks, codeBlocksToProjectFiles } from '../../utils';
import { Message, CodeBlock } from '../../types';
import { colors, spacing, typography } from '../../theme';

export default function ChatScreen() {
  const router = useRouter();
  const flatListRef = useRef<FlatList>(null);

  const { currentProjectId, currentProject, applyCodeBlocks } = useProjectStore();
  const {
    messages,
    isStreaming,
    addMessage,
    appendToLastMessage,
    setStreaming,
    setCodeBlocks,
    clearChat,
  } = useChatStore();
  const { bridgeServerUrl, isConnected, setIsConnected } = useSettingsStore();

  const project = currentProject();

  // Connect to bridge server on mount
  useEffect(() => {
    if (bridgeServerUrl && !isConnected) {
      claudeService
        .connect(bridgeServerUrl)
        .then(() => setIsConnected(true))
        .catch(() => setIsConnected(false));
    }
  }, [bridgeServerUrl]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages]);

  const handleSend = async (text: string) => {
    if (!isConnected) {
      router.push('/settings');
      return;
    }

    // Add user message
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: new Date(),
    };
    addMessage(userMessage);

    // Add placeholder for assistant response
    const assistantMessage: Message = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isStreaming: true,
    };
    addMessage(assistantMessage);
    setStreaming(true);

    let fullResponse = '';

    try {
      await claudeService.sendMessage(text, {
        onChunk: (chunk) => {
          fullResponse += chunk;
          appendToLastMessage(chunk);
        },
        onDone: () => {
          setStreaming(false);
          // Parse code blocks from the response
          const codeBlocks = parseCodeBlocks(fullResponse);
          if (codeBlocks.length > 0) {
            setCodeBlocks(assistantMessage.id, codeBlocks);
          }
        },
        onError: (error) => {
          setStreaming(false);
          appendToLastMessage(`\n\nError: ${error}`);
        },
      });
    } catch (error) {
      setStreaming(false);
      appendToLastMessage(`\n\nError: Failed to send message`);
    }
  };

  const handleCancel = () => {
    claudeService.cancel();
    setStreaming(false);
  };

  const handleApplyCode = (codeBlock: CodeBlock) => {
    if (!currentProjectId) return;

    const files = codeBlocksToProjectFiles([codeBlock]);
    applyCodeBlocks(currentProjectId, files);

    // Navigate to editor
    router.push('/editor');
  };

  if (!project) {
    return (
      <View style={styles.container}>
        <EmptyState
          icon={<MessageCircle color={colors.mutedForeground} size={48} />}
          title="No project selected"
          description="Select or create a project to start chatting with Claude"
          action={
            <Button
              title="Go to Projects"
              onPress={() => router.push('/')}
            />
          }
        />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={90}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.projectName}>{project.name}</Text>
        {!isConnected && (
          <Text style={styles.connectionStatus}>Not connected</Text>
        )}
      </View>

      {/* Messages */}
      {messages.length === 0 ? (
        <View style={styles.welcomeContainer}>
          <Text style={styles.welcomeTitle}>Let's build something!</Text>
          <Text style={styles.welcomeText}>
            Describe what you want to create, and I'll help you build it with React Native.
          </Text>
          <View style={styles.suggestions}>
            {[
              'Build a todo app with categories',
              'Create a weather app with location',
              'Make a notes app with dark mode',
            ].map((suggestion) => (
              <Text
                key={suggestion}
                style={styles.suggestion}
                onPress={() => handleSend(suggestion)}
              >
                "{suggestion}"
              </Text>
            ))}
          </View>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <MessageBubble
              message={item}
              onApplyCode={handleApplyCode}
            />
          )}
          contentContainerStyle={styles.messageList}
          onContentSizeChange={() =>
            flatListRef.current?.scrollToEnd({ animated: true })
          }
        />
      )}

      {/* Input */}
      <ChatInput
        onSend={handleSend}
        onCancel={handleCancel}
        isLoading={isStreaming}
        placeholder={
          isConnected
            ? 'Describe what you want to build...'
            : 'Connect to bridge server first...'
        }
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  projectName: {
    ...typography.button,
    color: colors.foreground,
  },
  connectionStatus: {
    ...typography.caption,
    color: colors.destructive,
  },
  welcomeContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  welcomeTitle: {
    ...typography.h2,
    color: colors.foreground,
    marginBottom: spacing.sm,
  },
  welcomeText: {
    ...typography.body,
    color: colors.mutedForeground,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  suggestions: {
    gap: spacing.sm,
  },
  suggestion: {
    ...typography.body,
    color: colors.brandTiger,
    textAlign: 'center',
    paddingVertical: spacing.sm,
  },
  messageList: {
    paddingVertical: spacing.md,
  },
});
