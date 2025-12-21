import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_VOICE_AGENT_MODEL, VoiceAgentModelId } from '../constants';

interface SettingsState {
  bridgeServerUrl: string;
  isConnected: boolean;
  autoPreview: boolean;
  voiceAgentModel: VoiceAgentModelId;
  lastConnectedAt: Date | null;

  // Actions
  setBridgeServerUrl: (url: string) => void;
  setIsConnected: (connected: boolean) => void;
  setAutoPreview: (auto: boolean) => void;
  setVoiceAgentModel: (model: VoiceAgentModelId) => void;
  resetSettings: () => void;
}

const initialState = {
  bridgeServerUrl: '',
  isConnected: false,
  autoPreview: true,
  voiceAgentModel: DEFAULT_VOICE_AGENT_MODEL,
  lastConnectedAt: null,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...initialState,

      setBridgeServerUrl: (url: string) =>
        set({ bridgeServerUrl: url }),

      setIsConnected: (connected: boolean) =>
        set({
          isConnected: connected,
          lastConnectedAt: connected ? new Date() : null,
        }),

      setAutoPreview: (auto: boolean) =>
        set({ autoPreview: auto }),

      setVoiceAgentModel: (model: VoiceAgentModelId) =>
        set({ voiceAgentModel: model }),

      resetSettings: () =>
        set(initialState),
    }),
    {
      name: 'lora-settings',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
