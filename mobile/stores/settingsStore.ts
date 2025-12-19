import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface SettingsState {
  bridgeServerUrl: string;
  isConnected: boolean;
  autoPreview: boolean;
  lastConnectedAt: Date | null;

  // Actions
  setBridgeServerUrl: (url: string) => void;
  setIsConnected: (connected: boolean) => void;
  setAutoPreview: (auto: boolean) => void;
  resetSettings: () => void;
}

const initialState = {
  bridgeServerUrl: '',
  isConnected: false,
  autoPreview: true,
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

      resetSettings: () =>
        set(initialState),
    }),
    {
      name: 'lora-settings',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
