import { create } from 'zustand';

// Voice status
// 'listening' = actively recording user speech
// 'processing' = sending to server, waiting for response
// 'speaking' = playing TTS response
// 'working' = agent is gathering info (screenshot, waiting for Claude)
export type VoiceStatus = 'off' | 'listening' | 'processing' | 'speaking' | 'working';

// Tab names for tracking current visible tab
export type TabName = 'terminal' | 'preview' | 'editor' | 'projects' | 'voice';

// Screenshot capture function type - returns base64 image or undefined
export type ScreenshotCaptureFn = () => Promise<string | undefined>;

// Preview action types that can be triggered by voice agent
export type PreviewAction = 'toggle_console' | 'reload_preview' | 'send_to_claude' | null;

// Editor action types that can be triggered by voice agent
export type EditorActionType = 'open_file' | 'close_file' | 'save_file' | 'refresh_files' | 'set_file_content' | null;

export interface EditorAction {
  type: EditorActionType;
  filePath?: string;       // For open_file
  content?: string;        // For set_file_content
}

interface VoiceState {
  voiceStatus: VoiceStatus;
  audioLevel: number;
  voiceTranscript: string;
  voiceProgress: string;
  pendingVoiceStart: boolean; // Flag to auto-start voice when chat mounts
  currentTab: TabName; // Track which tab is currently active

  // Toggle function reference (set by terminal screen)
  toggleVoiceMode: (() => void) | null;
  handleVoiceMicPress: (() => void) | null;

  // Screenshot capture registry - each tab registers its capture function
  screenshotCaptureFns: Map<TabName, ScreenshotCaptureFn>;

  // Preview action trigger - set by chat.tsx, consumed by preview.tsx
  pendingPreviewAction: PreviewAction;

  // Editor action trigger - set by chat.tsx, consumed by editor.tsx
  pendingEditorAction: EditorAction | null;

  // Actions
  setVoiceStatus: (status: VoiceStatus) => void;
  setAudioLevel: (level: number) => void;
  setVoiceTranscript: (text: string) => void;
  setVoiceProgress: (text: string) => void;
  setPendingVoiceStart: (pending: boolean) => void;
  setCurrentTab: (tab: TabName) => void;
  setToggleVoiceMode: (fn: (() => void) | null) => void;
  setHandleVoiceMicPress: (fn: (() => void) | null) => void;
  registerScreenshotCapture: (tab: TabName, fn: ScreenshotCaptureFn) => void;
  unregisterScreenshotCapture: (tab: TabName) => void;
  captureCurrentTabScreenshot: () => Promise<string | undefined>;
  triggerPreviewAction: (action: PreviewAction) => void;
  clearPreviewAction: () => void;
  triggerEditorAction: (action: EditorAction) => void;
  clearEditorAction: () => void;
  resetVoice: () => void;
}

const initialState = {
  voiceStatus: 'off' as VoiceStatus,
  audioLevel: 0,
  voiceTranscript: '',
  voiceProgress: '',
  pendingVoiceStart: false,
  currentTab: 'terminal' as TabName,
  toggleVoiceMode: null,
  handleVoiceMicPress: null,
  screenshotCaptureFns: new Map<TabName, ScreenshotCaptureFn>(),
  pendingPreviewAction: null as PreviewAction,
  pendingEditorAction: null as EditorAction | null,
};

export const useVoiceStore = create<VoiceState>()((set, get) => ({
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

  setCurrentTab: (tab: TabName) =>
    set({ currentTab: tab }),

  setToggleVoiceMode: (fn: (() => void) | null) =>
    set({ toggleVoiceMode: fn }),

  setHandleVoiceMicPress: (fn: (() => void) | null) =>
    set({ handleVoiceMicPress: fn }),

  registerScreenshotCapture: (tab: TabName, fn: ScreenshotCaptureFn) => {
    const current = get().screenshotCaptureFns;
    const updated = new Map(current);
    updated.set(tab, fn);
    set({ screenshotCaptureFns: updated });
    console.log(`[VoiceStore] Registered screenshot capture for ${tab} tab`);
  },

  unregisterScreenshotCapture: (tab: TabName) => {
    const current = get().screenshotCaptureFns;
    const updated = new Map(current);
    updated.delete(tab);
    set({ screenshotCaptureFns: updated });
    console.log(`[VoiceStore] Unregistered screenshot capture for ${tab} tab`);
  },

  captureCurrentTabScreenshot: async () => {
    const { currentTab, screenshotCaptureFns } = get();
    const captureFn = screenshotCaptureFns.get(currentTab);
    if (!captureFn) {
      console.log(`[VoiceStore] No screenshot capture registered for ${currentTab} tab`);
      return undefined;
    }
    try {
      const screenshot = await captureFn();
      console.log(`[VoiceStore] Captured screenshot from ${currentTab} tab: ${screenshot ? 'success' : 'empty'}`);
      return screenshot;
    } catch (error) {
      console.error(`[VoiceStore] Failed to capture screenshot from ${currentTab} tab:`, error);
      return undefined;
    }
  },

  triggerPreviewAction: (action: PreviewAction) => {
    console.log(`[VoiceStore] Triggering preview action: ${action}`);
    set({ pendingPreviewAction: action });
  },

  clearPreviewAction: () => {
    set({ pendingPreviewAction: null });
  },

  triggerEditorAction: (action: EditorAction) => {
    console.log(`[VoiceStore] Triggering editor action: ${action.type}`, action);
    set({ pendingEditorAction: action });
  },

  clearEditorAction: () => {
    set({ pendingEditorAction: null });
  },

  resetVoice: () =>
    set({ ...initialState, screenshotCaptureFns: new Map(), pendingPreviewAction: null, pendingEditorAction: null }),
}));
