import { create } from 'zustand';

// Voice status
// 'listening' = actively recording user speech
// 'processing' = sending to server, waiting for response
// 'speaking' = playing TTS response
// 'working' = agent is gathering info (screenshot, waiting for Claude)
export type VoiceStatus = 'off' | 'listening' | 'processing' | 'speaking' | 'working';

interface VoiceState {
  voiceStatus: VoiceStatus;
  audioLevel: number;
  voiceTranscript: string;
  voiceProgress: string;
  pendingVoiceStart: boolean; // Flag to auto-start voice when chat mounts

  // Toggle function reference (set by terminal screen)
  toggleVoiceMode: (() => void) | null;
  handleVoiceMicPress: (() => void) | null;

  // Actions
  setVoiceStatus: (status: VoiceStatus) => void;
  setAudioLevel: (level: number) => void;
  setVoiceTranscript: (text: string) => void;
  setVoiceProgress: (text: string) => void;
  setPendingVoiceStart: (pending: boolean) => void;
  setToggleVoiceMode: (fn: (() => void) | null) => void;
  setHandleVoiceMicPress: (fn: (() => void) | null) => void;
  resetVoice: () => void;
}

const initialState = {
  voiceStatus: 'off' as VoiceStatus,
  audioLevel: 0,
  voiceTranscript: '',
  voiceProgress: '',
  pendingVoiceStart: false,
  toggleVoiceMode: null,
  handleVoiceMicPress: null,
};

export const useVoiceStore = create<VoiceState>()((set) => ({
  ...initialState,

  setVoiceStatus: (status: VoiceStatus) =>
    set({ voiceStatus: status }),

  setAudioLevel: (level: number) =>
    set({ audioLevel: level }),

  setVoiceTranscript: (text: string) =>
    set({ voiceTranscript: text }),

  setVoiceProgress: (text: string) =>
    set({ voiceProgress: text }),

  setPendingVoiceStart: (pending: boolean) =>
    set({ pendingVoiceStart: pending }),

  setToggleVoiceMode: (fn: (() => void) | null) =>
    set({ toggleVoiceMode: fn }),

  setHandleVoiceMicPress: (fn: (() => void) | null) =>
    set({ handleVoiceMicPress: fn }),

  resetVoice: () =>
    set(initialState),
}));
