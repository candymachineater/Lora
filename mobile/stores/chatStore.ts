import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Message, CodeBlock } from '../types';

interface ChatState {
  messages: Message[];
  isStreaming: boolean;
  currentStreamingContent: string;

  // Actions
  addMessage: (message: Message) => void;
  updateMessage: (id: string, updates: Partial<Message>) => void;
  appendToLastMessage: (content: string) => void;
  setStreaming: (streaming: boolean) => void;
  setStreamingContent: (content: string) => void;
  clearChat: () => void;
  setCodeBlocks: (messageId: string, codeBlocks: CodeBlock[]) => void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      messages: [],
      isStreaming: false,
      currentStreamingContent: '',

      addMessage: (message: Message) =>
        set((state) => ({
          messages: [...state.messages, message],
        })),

      updateMessage: (id: string, updates: Partial<Message>) =>
        set((state) => ({
          messages: state.messages.map((m) =>
            m.id === id ? { ...m, ...updates } : m
          ),
        })),

      appendToLastMessage: (content: string) =>
        set((state) => {
          const messages = [...state.messages];
          if (messages.length > 0) {
            const lastMessage = messages[messages.length - 1];
            messages[messages.length - 1] = {
              ...lastMessage,
              content: lastMessage.content + content,
            };
          }
          return { messages };
        }),

      setStreaming: (streaming: boolean) =>
        set({ isStreaming: streaming }),

      setStreamingContent: (content: string) =>
        set({ currentStreamingContent: content }),

      clearChat: () =>
        set({ messages: [], currentStreamingContent: '' }),

      setCodeBlocks: (messageId: string, codeBlocks: CodeBlock[]) =>
        set((state) => ({
          messages: state.messages.map((m) =>
            m.id === messageId ? { ...m, codeBlocks } : m
          ),
        })),
    }),
    {
      name: 'lora-chat',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        messages: state.messages.slice(-50), // Keep last 50 messages
      }),
    }
  )
);
