import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Terminal as TerminalIcon, X } from 'lucide-react-native';
import { Audio, AVPlaybackStatus } from 'expo-av';
import ViewShot from 'react-native-view-shot';
import * as Haptics from 'expo-haptics';
import { useProjectStore, useSettingsStore, useVoiceStore } from '../../stores';
import { bridgeService } from '../../services/claude/api';
import { Terminal } from '../../components/terminal';
import { EmptyState, Button } from '../../components/common';
import { colors, spacing } from '../../theme';

interface TerminalSession {
  id: string;
  output: string;
  sandbox: boolean;
}

// VAD Configuration - Adaptive to environment noise level
const VAD_CONFIG = {
  // Adaptive threshold settings
  // Speech threshold = noise floor + SPEECH_ABOVE_NOISE_DB
  CALIBRATION_DURATION_MS: 800, // Measure ambient noise for first 800ms
  SPEECH_ABOVE_NOISE_DB: 8, // Speech must be 8dB above noise floor (optimized for mobile close-mic)
  MIN_SPEECH_THRESHOLD: -30, // Never set threshold below this (too sensitive)
  MAX_SPEECH_THRESHOLD: -10, // Never set threshold above this (too strict, was -5)

  // Timing settings
  SILENCE_DURATION_MS: 700, // 700ms of silence after speech before stopping
  SPEECH_START_MS: 600, // Must have 600ms of sustained speech to confirm
  MIN_RECORDING_MS: 1200, // Minimum 1.2s recording before VAD kicks in
  MAX_RECORDING_MS: 60000, // Maximum 60s recording to prevent runaway
  METERING_INTERVAL_MS: 100, // How often to check audio levels
  POST_TTS_DELAY_MS: 500, // Wait 500ms after TTS ends before listening
  NO_SPEECH_TIMEOUT_MS: 8000, // Turn off after 8s of no speech detected
};

export default function TerminalScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ pendingPrompt?: string; createNewTerminal?: string; timestamp?: string }>();

  const { currentProjectId, projects, currentProject, currentFile } = useProjectStore();
  const { bridgeServerUrl, isConnected, setIsConnected, voiceAgentModel } = useSettingsStore();

  // Multi-terminal state
  const [terminals, setTerminals] = useState<TerminalSession[]>([]);
  const [activeTerminalIndex, setActiveTerminalIndex] = useState(0);
  const lastProjectIdRef = useRef<string | null>(null);
  const terminalCounter = useRef(0);

  // Pending prompt from preview (for sending console logs to Claude)
  const pendingPromptRef = useRef<string | null>(null);
  const pendingPromptSentRef = useRef(false);

  // Voice mode state - now managed via voiceStore for tab bar integration
  const {
    voiceStatus,
    voiceTranscript,
    voiceProgress,
    pendingVoiceStart,
    setVoiceStatus,
    setAudioLevel,
    setVoiceTranscript,
    setVoiceProgress,
    setPendingVoiceStart,
    setToggleVoiceMode,
    setHandleVoiceMicPress,
  } = useVoiceStore();

  const recordingRef = useRef<Audio.Recording | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const thinkingSoundRef = useRef<Audio.Sound | null>(null);
  const meteringIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const silenceStartRef = useRef<number | null>(null);
  const recordingStartRef = useRef<number | null>(null);
  const noSpeechTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewShotRef = useRef<ViewShot>(null);
  const workingScreenshotAttemptsRef = useRef<number>(0); // Limit working loop retries
  const wasVoiceActiveRef = useRef<boolean>(false); // Track if voice was active for cleanup
  const isTTSPlayingRef = useRef<boolean>(false); // Track if TTS is currently playing (prevent thinking sound overlap)
  const activeTerminalRef = useRef<TerminalSession | undefined>(undefined); // Track current active terminal for voice callbacks

  const project = currentProject();
  const activeTerminal = terminals[activeTerminalIndex];

  // Keep ref in sync with active terminal (for use in voice callbacks)
  useEffect(() => {
    activeTerminalRef.current = activeTerminal;
  }, [activeTerminal]);
  const projectSandbox = project?.sandbox ?? true;

  // Connect to bridge server
  useEffect(() => {
    if (bridgeServerUrl && !bridgeService.isConnected()) {
      bridgeService
        .connect(bridgeServerUrl)
        .then((serverProjects) => {
          setIsConnected(true);
          console.log('[Terminal] Connected, got projects:', serverProjects.length);
        })
        .catch((err) => {
          console.error('[Terminal] Connection failed:', err);
          setIsConnected(false);
        });
    }
  }, [bridgeServerUrl]);

  // Clean up terminals when project changes
  useEffect(() => {
    if (!currentProjectId || !bridgeService.isConnected()) return;

    const projectChanged = lastProjectIdRef.current !== currentProjectId;
    lastProjectIdRef.current = currentProjectId;

    if (projectChanged && terminals.length > 0) {
      // Disable voice on all terminals first
      terminals.forEach((t) => {
        bridgeService.disableVoiceOnTerminal(t.id);
        bridgeService.closeTerminal(t.id);
      });
      setTerminals([]);
      setActiveTerminalIndex(0);
      terminalCounter.current = 0;
      setVoiceStatus('off');
    }

    return () => {
      terminals.forEach((t) => bridgeService.closeTerminal(t.id));
      stopMetering();
    };
  }, [currentProjectId, isConnected]);

  // Create initial terminal when needed (separate effect to avoid race condition)
  useEffect(() => {
    if (!currentProjectId || !bridgeService.isConnected()) return;

    if (terminals.length === 0) {
      console.log('[Terminal] No terminals found, creating initial terminal for project:', currentProjectId);
      createTerminal();
    }
  }, [currentProjectId, isConnected, terminals.length, createTerminal]);

  // Cleanup on unmount only
  useEffect(() => {
    return () => {
      stopMetering();
    };
  }, []);

  // Handle pending prompt from preview (console logs to send to Claude)
  useEffect(() => {
    if (params.pendingPrompt && params.timestamp) {
      // Reset the sent flag for each new timestamp (each button click)
      pendingPromptRef.current = params.pendingPrompt;
      pendingPromptSentRef.current = false;

      // If requested to create new terminal, do so
      if (params.createNewTerminal === 'true') {
        console.log('[Terminal] Creating new terminal for pending prompt (timestamp:', params.timestamp, ')');
        createTerminalWithPrompt(params.pendingPrompt);
        pendingPromptSentRef.current = true;
      }
    }
  }, [params.pendingPrompt, params.createNewTerminal, params.timestamp]);

  // Manage thinking/working sound based on voice status
  // IMPORTANT: Don't start thinking sound while TTS is playing to avoid overlap
  useEffect(() => {
    if (voiceStatus === 'processing' || voiceStatus === 'working') {
      // Only start thinking sound if TTS is NOT currently playing
      if (!isTTSPlayingRef.current) {
        playThinkingSound();
      }
    } else {
      // Stop thinking sound when not in processing/working state
      stopThinkingSound();
    }

    // Cleanup on unmount
    return () => {
      stopThinkingSound();
    };
  }, [voiceStatus]);

  // Cleanup when voiceStatus changes to 'off' (e.g., from button press fallback)
  // This ensures resources are cleaned up even if handleVoiceMicPress wasn't called
  useEffect(() => {
    // Track if voice was active
    if (voiceStatus !== 'off') {
      wasVoiceActiveRef.current = true;
    }

    // Cleanup when transitioning from active to off OR when remounting with off status
    // (in case voice was turned off while component was unmounted)
    if (voiceStatus === 'off' && wasVoiceActiveRef.current) {
      wasVoiceActiveRef.current = false;
      console.log('[Voice] Status changed to off, running cleanup');

      // Cleanup any active resources
      const cleanup = async () => {
        // Clear timeouts
        if (noSpeechTimeoutRef.current) {
          clearTimeout(noSpeechTimeoutRef.current);
          noSpeechTimeoutRef.current = null;
        }

        // Stop metering
        stopMetering();

        // Stop any recording
        if (recordingRef.current) {
          try {
            await recordingRef.current.stopAndUnloadAsync();
          } catch (e) {
            // Ignore - may already be stopped
          }
          recordingRef.current = null;
        }

        // Stop any audio playback
        if (soundRef.current) {
          try {
            await soundRef.current.stopAsync();
            await soundRef.current.unloadAsync();
          } catch (e) {
            // Ignore
          }
          soundRef.current = null;
        }

        // Stop thinking sound
        if (thinkingSoundRef.current) {
          try {
            await thinkingSoundRef.current.stopAsync();
            await thinkingSoundRef.current.unloadAsync();
          } catch (e) {
            // Ignore
          }
          thinkingSoundRef.current = null;
        }

        // Notify server and disable voice on terminal
        if (activeTerminal) {
          bridgeService.sendVoiceInterrupt(activeTerminal.id);
          bridgeService.disableVoiceOnTerminal(activeTerminal.id);
        }
      };

      cleanup();
    }
  }, [voiceStatus, activeTerminal]);

  // On mount, if voice status is 'off', ensure all terminals have voice disabled
  // This handles the case where voice was turned off while component was unmounted
  useEffect(() => {
    if (voiceStatus === 'off' && terminals.length > 0) {
      console.log('[Voice] Component mounted with voice off, ensuring all terminals disabled');
      terminals.forEach((t) => {
        bridgeService.disableVoiceOnTerminal(t.id);
      });
    }
  }, []);

  // Create terminal with initial prompt passed directly to Claude Code
  const createTerminalWithPrompt = async (prompt: string) => {
    if (!currentProjectId) return;

    try {
      terminalCounter.current += 1;
      pendingPromptSentRef.current = true; // Mark as sent since it's passed as initial prompt

      // Create terminal with initial prompt - Claude will start with this prompt automatically
      const id = await bridgeService.createTerminal(
        currentProjectId,
        {
          onOutput: (data) => {
            setTerminals((prev) =>
              prev.map((t) => (t.id === id ? { ...t, output: t.output + data } : t))
            );
          },
          onClose: () => {
            setTerminals((prev) => {
              const newTerminals = prev.filter((t) => t.id !== id);
              setActiveTerminalIndex((idx) => Math.min(idx, Math.max(0, newTerminals.length - 1)));
              return newTerminals;
            });
          },
        },
        80,
        50,
        projectSandbox,
        prompt  // Pass the prompt directly to Claude Code startup
      );

      const newSession: TerminalSession = { id, output: '', sandbox: projectSandbox };
      setTerminals((prev) => [...prev, newSession]);
      setActiveTerminalIndex(terminals.length);
      console.log('[Terminal] Created terminal with initial prompt:', id);

    } catch (err) {
      console.error('[Terminal] Failed to create terminal with prompt:', err);
    }
  };

  const stopMetering = () => {
    if (meteringIntervalRef.current) {
      clearInterval(meteringIntervalRef.current);
      meteringIntervalRef.current = null;
    }
  };

  // Thinking/working sound - loops while processing
  const playThinkingSound = async () => {
    try {
      // Don't start if TTS is currently playing
      if (isTTSPlayingRef.current) {
        console.log('[Voice] Skipping thinking sound - TTS is playing');
        return;
      }

      // Stop any existing thinking sound first
      await stopThinkingSound();

      // Check again after async operation - TTS might have started
      if (isTTSPlayingRef.current) {
        console.log('[Voice] Aborting thinking sound - TTS started during setup');
        return;
      }

      // Set audio mode for playback
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        playThroughEarpieceAndroid: false,
      });

      // Final check before playing
      if (isTTSPlayingRef.current) {
        console.log('[Voice] Aborting thinking sound - TTS started during audio mode setup');
        return;
      }

      // Load and play the thinking sound with looping
      const { sound } = await Audio.Sound.createAsync(
        require('../../assets/thinking-chime.mp3'),
        { isLooping: true, volume: 0.5 }
      );

      // One more check before actually playing
      if (isTTSPlayingRef.current) {
        console.log('[Voice] Aborting thinking sound - TTS started during sound loading');
        await sound.unloadAsync();
        return;
      }

      thinkingSoundRef.current = sound;
      await sound.playAsync();
      console.log('[Voice] Thinking sound started (looping)');
    } catch (err) {
      console.log('[Voice] Failed to play thinking sound:', err);
    }
  };

  const stopThinkingSound = async () => {
    if (thinkingSoundRef.current) {
      try {
        await thinkingSoundRef.current.stopAsync();
        await thinkingSoundRef.current.unloadAsync();
        console.log('[Voice] Thinking sound stopped');
      } catch (err) {
        // Ignore - sound may already be stopped
      }
      thinkingSoundRef.current = null;
    }
  };

  const createTerminal = useCallback(async () => {
    if (!currentProjectId) return;

    try {
      terminalCounter.current += 1;
      const termNum = terminalCounter.current;

      const id = await bridgeService.createTerminal(
        currentProjectId,
        {
          onOutput: (data) => {
            setTerminals((prev) =>
              prev.map((t) => (t.id === id ? { ...t, output: t.output + data } : t))
            );
          },
          onClose: () => {
            setTerminals((prev) => {
              const newTerminals = prev.filter((t) => t.id !== id);
              setActiveTerminalIndex((idx) => Math.min(idx, Math.max(0, newTerminals.length - 1)));
              return newTerminals;
            });
          },
        },
        80,
        50,
        projectSandbox
      );

      const newSession: TerminalSession = { id, output: '', sandbox: projectSandbox };
      setTerminals((prev) => [...prev, newSession]);
      setActiveTerminalIndex((prev) => terminals.length);
      console.log('[Terminal] Created:', id, 'tab:', termNum, 'sandbox:', projectSandbox);
    } catch (err) {
      console.error('[Terminal] Failed to create:', err);
      Alert.alert('Error', 'Failed to create terminal session');
    }
  }, [currentProjectId, projectSandbox, terminals.length]);

  const closeTerminal = useCallback((index: number) => {
    const terminal = terminals[index];
    if (!terminal) return;

    bridgeService.closeTerminal(terminal.id);
    setTerminals((prev) => prev.filter((_, i) => i !== index));
    setActiveTerminalIndex((idx) => Math.min(idx, Math.max(0, terminals.length - 2)));
  }, [terminals]);

  const handleInput = useCallback(
    (input: string) => {
      if (activeTerminal) {
        bridgeService.sendTerminalInput(activeTerminal.id, input);
      }
    },
    [activeTerminal]
  );

  const handleResize = useCallback(
    (cols: number, rows: number) => {
      if (activeTerminal) {
        bridgeService.resizeTerminal(activeTerminal.id, cols, rows);
      }
    },
    [activeTerminal]
  );

  const handleNewTerminal = useCallback(() => {
    createTerminal();
  }, [createTerminal]);

  // Voice Mode Functions - exposed to tab bar via store
  const toggleVoiceMode = useCallback(async () => {
    console.log('[Chat] toggleVoiceMode called, activeTerminal:', !!activeTerminal, 'voiceStatus:', voiceStatus);

    if (!activeTerminal) {
      console.log('[Chat] No active terminal!');
      Alert.alert('No Terminal', 'Please wait for terminal to be ready');
      return;
    }

    if (voiceStatus === 'off') {
      // Turn on voice mode for this terminal
      console.log('[Chat] Enabling voice on terminal:', activeTerminal.id, 'with model:', voiceAgentModel);
      bridgeService.enableVoiceOnTerminal(activeTerminal.id, voiceAgentModel, {
        onTranscription: (text) => {
          console.log('[Voice-Terminal] Transcribed:', text);
          setVoiceTranscript(text);
          setVoiceProgress('');
          setVoiceStatus('processing');
        },
        onProgress: (text) => {
          console.log('[Voice-Terminal] Progress:', text);
          setVoiceProgress(text);
        },
        onSpeaking: (text, audioData, isComplete) => {
          console.log('[Voice-Terminal] Speaking:', text, 'isComplete:', isComplete);
          setVoiceProgress('');
          playAudio(audioData, isComplete);
        },
        onAppControl: async (control) => {
          console.log('[Voice-Terminal] App control:', control);
          const params = control.params as Record<string, unknown> | undefined;

          // Handle app control actions from voice agent
          switch (control.action) {
            case 'navigate':
              // Navigate to different tabs
              if (control.target) {
                const tabMap: Record<string, string> = {
                  'terminal': '/(tabs)/chat',
                  'chat': '/(tabs)/chat',
                  'preview': '/(tabs)/preview',
                  'projects': '/(tabs)',
                  'editor': '/(tabs)/editor',
                  'settings': '/settings',
                };
                const route = tabMap[control.target.toLowerCase()];
                if (route) {
                  router.push(route as any);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }
              }
              break;

            case 'take_screenshot':
              // Voice agent requested a fresh screenshot - capture CURRENT TAB (not terminal!)
              console.log('[Voice-Terminal] Screenshot requested by agent');
              try {
                // Use the registered screenshot capture for the CURRENT tab (preview, editor, etc.)
                const captureScreenshot = useVoiceStore.getState().captureCurrentTabScreenshot;
                const uri = await captureScreenshot();
                console.log('[Voice-Terminal] Screenshot captured from current tab:', uri ? `${uri.length} chars` : 'empty');

                // Send screenshot back to server for vision analysis
                if (uri && activeTerminal) {
                  bridgeService.send({
                    type: 'screenshot_captured' as any,
                    terminalId: activeTerminal.id,
                    screenshot: uri
                  } as any);
                  console.log('[Voice-Terminal] Screenshot sent to server for analysis');
                } else if (!uri && activeTerminal) {
                  // Screenshot failed - send empty response so server doesn't wait
                  bridgeService.send({
                    type: 'screenshot_captured' as any,
                    terminalId: activeTerminal.id,
                    screenshot: ''
                  } as any);
                  console.log('[Voice-Terminal] Screenshot capture failed, sent empty response');
                }
              } catch (err) {
                console.log('[Voice-Terminal] On-demand screenshot failed:', err);
                // Send empty response on error so server doesn't wait forever
                if (activeTerminal) {
                  bridgeService.send({
                    type: 'screenshot_captured' as any,
                    terminalId: activeTerminal.id,
                    screenshot: ''
                  } as any);
                }
              }
              break;

            case 'send_input':
              // Send text input to terminal
              if (params?.text && activeTerminal) {
                bridgeService.sendTerminalInput(activeTerminal.id, String(params.text));
                console.log('[Voice-Terminal] Sent input to terminal:', params.text);
              }
              break;

            case 'send_control':
              // Send control key to terminal (escape, ctrl+c, arrows, etc)
              if (params?.key && activeTerminal) {
                const key = String(params.key).toUpperCase();
                let input = '';
                switch (key) {
                  case 'ESCAPE': input = '\x1b'; break;
                  case 'CTRL_C': input = '\x03'; break;
                  case 'CTRL_D': input = '\x04'; break;
                  case 'ENTER': input = '\r'; break;
                  case 'TAB': input = '\t'; break;
                  case 'UP': input = '\x1b[A'; break;
                  case 'DOWN': input = '\x1b[B'; break;
                  case 'LEFT': input = '\x1b[C'; break;
                  case 'RIGHT': input = '\x1b[D'; break;
                  case 'YES': input = 'y\r'; break;
                  case 'NO': input = 'n\r'; break;
                }
                if (input) {
                  bridgeService.sendTerminalInput(activeTerminal.id, input);
                  console.log('[Voice-Terminal] Sent control key:', key);
                }
              }
              break;

            case 'new_terminal':
              // Create a new terminal tab
              createTerminal();
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              console.log('[Voice-Terminal] Creating new terminal');
              break;

            case 'close_terminal':
              // Close current terminal
              if (terminals.length > 1 && activeTerminalIndex >= 0) {
                closeTerminal(activeTerminalIndex);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                console.log('[Voice-Terminal] Closed current terminal');
              }
              break;

            case 'switch_terminal':
              // Switch to a specific terminal tab (by index or direction)
              // First navigate to Chat tab if not already there
              router.push('/(tabs)/chat');

              if (params?.index !== undefined) {
                const idx = Number(params.index);
                if (idx >= 0 && idx < terminals.length) {
                  setActiveTerminalIndex(idx);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  console.log(`[Voice-Terminal] Switched to terminal ${idx + 1}`);
                }
              } else if (params?.direction === 'next') {
                setActiveTerminalIndex((prev) => (prev + 1) % terminals.length);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                console.log('[Voice-Terminal] Switched to next terminal');
              } else if (params?.direction === 'prev') {
                setActiveTerminalIndex((prev) => (prev - 1 + terminals.length) % terminals.length);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                console.log('[Voice-Terminal] Switched to previous terminal');
              }
              break;

            case 'toggle_voice':
              // Toggle voice mode on/off
              console.log('[Voice-Terminal] Voice toggle requested');
              // Don't actually toggle - just acknowledge (agent shouldn't turn itself off)
              break;

            case 'refresh_files':
              // Refresh file list - navigate to editor to trigger refresh
              router.push('/(tabs)/editor' as any);
              console.log('[Voice-Terminal] Refreshing files by navigating to editor');
              break;

            case 'show_settings':
              // Open settings modal
              router.push('/settings' as any);
              console.log('[Voice-Terminal] Opening settings');
              break;

            case 'scroll':
              // Scroll terminal (handled by sending Page Up/Down)
              if (params?.direction && activeTerminal) {
                const scrollInput = params.direction === 'up' ? '\x1b[5~' : '\x1b[6~'; // Page Up/Down
                const count = Number(params.count) || 1;
                for (let i = 0; i < count; i++) {
                  bridgeService.sendTerminalInput(activeTerminal.id, scrollInput);
                }
                console.log('[Voice-Terminal] Scrolled', params.direction, count, 'times');
              }
              break;

            case 'toggle_console':
              // Toggle console panel in Preview tab
              console.log('[Voice-Terminal] Toggling console panel');
              useVoiceStore.getState().triggerPreviewAction('toggle_console');
              break;

            case 'reload_preview':
              // Reload the preview webview
              console.log('[Voice-Terminal] Reloading preview');
              useVoiceStore.getState().triggerPreviewAction('reload_preview');
              break;

            case 'send_to_claude':
              // Send console logs to Claude
              console.log('[Voice-Terminal] Sending console logs to Claude');
              useVoiceStore.getState().triggerPreviewAction('send_to_claude');
              break;

            // Editor actions
            case 'open_file':
              // Open a file in the editor
              console.log('[Voice-Terminal] Opening file:', params?.filePath);
              if (params?.filePath) {
                router.push('/(tabs)/editor' as any);
                useVoiceStore.getState().triggerEditorAction({
                  type: 'open_file',
                  filePath: String(params.filePath),
                });
              }
              break;

            case 'close_file':
              // Close the current file and go back to file list
              console.log('[Voice-Terminal] Closing file');
              useVoiceStore.getState().triggerEditorAction({ type: 'close_file' });
              break;

            case 'save_file':
              // Save the current file
              console.log('[Voice-Terminal] Saving file');
              useVoiceStore.getState().triggerEditorAction({ type: 'save_file' });
              break;

            case 'set_file_content':
              // Replace file content
              console.log('[Voice-Terminal] Setting file content');
              if (params?.content !== undefined) {
                useVoiceStore.getState().triggerEditorAction({
                  type: 'set_file_content',
                  content: String(params.content),
                });
              }
              break;

            default:
              console.log('[Voice-Terminal] Unknown app control action:', control.action);
          }
        },
        onWorking: async (workingState) => {
          console.log('[Voice-Terminal] Working state:', workingState);
          // Agent is gathering info - don't return to listening yet
          setVoiceStatus('working');

          // Show progress message based on what we're doing
          const workingMessages: Record<string, string> = {
            'screenshot': 'Analyzing screen...',
            'claude_action': 'Waiting for Claude Code...',
            'gathering_info': 'Gathering information...',
            'analyzing': 'Thinking...',
          };
          setVoiceProgress(workingMessages[workingState.reason] || 'Working...');

          // Handle follow-up actions
          if (workingState.followUpAction === 'take_screenshot') {
            // Get the ACTUAL current tab from store
            const actualCurrentTab = useVoiceStore.getState().currentTab;
            console.log('[Voice-Terminal] Take screenshot requested, current tab:', actualCurrentTab);
            workingScreenshotAttemptsRef.current = 0;

            let screenshot: string | undefined;
            let terminalContent: string | undefined;

            if (actualCurrentTab === 'terminal') {
              // Terminal tab uses WebView (xterm.js) which cannot be captured by ViewShot
              // Use terminal output text instead
              console.log('[Voice-Terminal] Using terminal output for Terminal tab');
              terminalContent = activeTerminal?.output
                ? activeTerminal.output.slice(-120000) // ~120k chars (~30k tokens) for context
                : undefined;
            } else {
              // Other tabs (Preview, Editor, etc.) - use registered capture function
              console.log('[Voice-Terminal] Capturing screenshot for', actualCurrentTab, 'tab');
              const captureScreenshot = useVoiceStore.getState().captureCurrentTabScreenshot;
              screenshot = await captureScreenshot();
              if (screenshot) {
                console.log('[Voice-Terminal] Screenshot captured successfully');
              } else {
                console.log('[Voice-Terminal] Screenshot capture returned empty');
              }
            }

            bridgeService.sendVoiceAudioToTerminal(
              activeTerminal.id,
              '', // No audio
              'audio/wav',
              screenshot, // Real screenshot from the current tab
              terminalContent,
              {
                currentTab: actualCurrentTab,
                projectName: project?.name,
                projectId: project?.id,
                // Multi-terminal info
                terminalCount: terminals.length,
                activeTerminalIndex: activeTerminalIndex,
                activeTerminalId: activeTerminal?.id,
                // Editor info - which file is currently open (if any)
                currentFile: currentFile || undefined,
              }
            );
            return;
          } else if (workingState.followUpAction === 'wait_for_claude') {
            // Agent is waiting for Claude Code response - stay in working state
            console.log('[Voice-Terminal] Waiting for Claude Code response...');
            // The response will come through normal terminal output handling
          }
          // For other follow-up actions, stay in working state until agent responds
        },
        onBackgroundTaskStarted: (taskId, description) => {
          console.log('[Voice-Terminal] Background task started:', taskId, description);
          // Optional: Show a subtle indicator that a background task is running
          // For now we just log it - the agent already spoke about starting it
        },
        onBackgroundTaskComplete: async (taskId, description, result) => {
          console.log('[Voice-Terminal] Background task complete:', taskId, description);

          // Get current status - only notify if user is still in voice mode and listening
          const currentStatus = useVoiceStore.getState().voiceStatus;
          if (currentStatus !== 'off' && currentStatus !== 'speaking' && currentStatus !== 'processing') {
            // Interrupt current listening to notify about completed task
            setVoiceProgress(`Claude finished: ${description}`);

            // The server has already sent a summary, so we can construct a notification message
            // and add it to the conversation context for the agent to reference
            console.log('[Voice-Terminal] Task result summary:', result);
          }
        },
        onEnabled: () => {
          console.log('[Voice-Terminal] Voice mode enabled, starting listening');
          setVoiceTranscript('');
          setVoiceProgress('');
          // Clear pending flag to prevent duplicate enable attempts
          setPendingVoiceStart(false);
          // Start listening immediately
          setTimeout(() => startListening(), 500);
        },
        onDisabled: () => {
          console.log('[Voice-Terminal] Voice mode disabled');
          // Clear any timeouts
          if (noSpeechTimeoutRef.current) {
            clearTimeout(noSpeechTimeoutRef.current);
            noSpeechTimeoutRef.current = null;
          }
          setVoiceStatus('off');
        },
        onError: (error) => {
          console.error('[Voice-Terminal] Error:', error);

          // Check if terminal was not found (stale session)
          if (error.includes('Terminal not found')) {
            console.log('[Voice-Terminal] Terminal stale, clearing and recreating...');
            setVoiceStatus('off');
            // Clear stale terminals and recreate
            setTerminals([]);
            terminalCounter.current = 0;
            // Set pending flag to retry voice after new terminal is created
            setPendingVoiceStart(true);
            // Create new terminal
            createTerminal();
            return;
          }

          Alert.alert('Voice Error', error);
          setVoiceStatus('off');
        }
      });
    } else {
      // Turn off voice mode
      // Set status to 'off' IMMEDIATELY to prevent double-taps during async cleanup
      setVoiceStatus('off');
      setVoiceTranscript('');
      setVoiceProgress('');

      // Now do async cleanup (with error handling)
      stopMetering();
      try {
        if (recordingRef.current) {
          await recordingRef.current.stopAndUnloadAsync();
          recordingRef.current = null;
        }
      } catch (e) {
        console.log('[Voice] Error stopping recording:', e);
        recordingRef.current = null;
      }
      try {
        if (soundRef.current) {
          await soundRef.current.stopAsync();
          await soundRef.current.unloadAsync();
          soundRef.current = null;
        }
      } catch (e) {
        console.log('[Voice] Error stopping sound:', e);
        soundRef.current = null;
      }
      try {
        bridgeService.disableVoiceOnTerminal(activeTerminal.id);
      } catch (e) {
        console.log('[Voice] Error disabling voice on terminal:', e);
      }
    }
  }, [activeTerminal, voiceStatus, setVoiceStatus, setVoiceTranscript, setVoiceProgress]);

  // Helper to cleanup any active recording
  const cleanupRecording = async () => {
    stopMetering(); // Stop metering first

    if (recordingRef.current) {
      const recordingToCleanup = recordingRef.current;
      recordingRef.current = null; // Clear ref immediately to prevent race conditions

      try {
        // Always try to stop and unload, regardless of current state
        await recordingToCleanup.stopAndUnloadAsync();
        console.log('[Voice] Cleaned up existing recording');
      } catch (e) {
        // Ignore - recording may already be stopped or not started
        console.log('[Voice] Cleanup: recording already stopped or not started');
      }
    }
  };

  const startListening = async () => {
    console.log('[Voice] startListening called, activeTerminal:', !!activeTerminal);

    if (!activeTerminal) {
      console.log('[Voice] No active terminal, skipping');
      return;
    }

    // Get current status from store to avoid stale closure
    const currentStatus = useVoiceStore.getState().voiceStatus;
    console.log('[Voice] Current status from store:', currentStatus);

    // Clear any no-speech timeout when starting to listen
    if (noSpeechTimeoutRef.current) {
      clearTimeout(noSpeechTimeoutRef.current);
      noSpeechTimeoutRef.current = null;
    }

    // Interrupt if speaking
    if (currentStatus === 'speaking' && soundRef.current) {
      console.log('[Voice] Interrupting current speech');
      await soundRef.current.stopAsync();
      await soundRef.current.unloadAsync();
      soundRef.current = null;
    }

    // Stop any existing recording first to prevent conflict
    await cleanupRecording();

    try {
      console.log('[Voice] Requesting audio permissions for listening...');
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        console.log('[Voice] Permission denied');
        Alert.alert('Permission Denied', 'Microphone permission is required');
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
      });

      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync({
        ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
        isMeteringEnabled: true,
      });
      await recording.startAsync();
      console.log('[Voice] Active listening recording started');

      recordingRef.current = recording;
      recordingStartRef.current = Date.now();
      silenceStartRef.current = null;
      setVoiceStatus('listening');
      console.log('[Voice] Status set to listening');
      setAudioLevel(0);

      // Adaptive VAD state
      let speechDetected = false;
      let speechStartTime: number | null = null;
      let calibrationSamples: number[] = [];
      let noiseFloor: number | null = null;
      let speechThreshold: number | null = null;
      let lastLogTime = 0; // For periodic level logging

      // VAD monitoring with adaptive calibration
      meteringIntervalRef.current = setInterval(async () => {
        if (!recordingRef.current) return;

        try {
          const status = await recordingRef.current.getStatusAsync();
          if (status.isRecording && status.metering !== undefined) {
            const level = status.metering;
            const normalizedLevel = Math.max(0, Math.min(1, (level + 60) / 60));
            setAudioLevel(normalizedLevel);

            const now = Date.now();
            const recordingDuration = now - (recordingStartRef.current || now);

            // CALIBRATION PHASE: Collect ambient noise samples
            if (recordingDuration < VAD_CONFIG.CALIBRATION_DURATION_MS) {
              calibrationSamples.push(level);
              return; // Don't do speech detection during calibration
            }

            // Calculate noise floor once calibration is complete
            if (noiseFloor === null && calibrationSamples.length > 0) {
              // Use 25th percentile as noise floor (more robust to spikes than median)
              const sorted = [...calibrationSamples].sort((a, b) => a - b);
              const p25Index = Math.floor(sorted.length * 0.25);
              noiseFloor = sorted[p25Index];

              // Set speech threshold relative to noise floor
              const rawThreshold = noiseFloor + VAD_CONFIG.SPEECH_ABOVE_NOISE_DB;
              speechThreshold = Math.max(
                VAD_CONFIG.MIN_SPEECH_THRESHOLD,
                Math.min(VAD_CONFIG.MAX_SPEECH_THRESHOLD, rawThreshold)
              );

              const silenceThresh = noiseFloor + 5;
              console.log(`[VAD] Calibrated! Noise floor: ${noiseFloor.toFixed(1)} dB (p25 of ${calibrationSamples.length} samples)`);
              console.log(`[VAD] Thresholds - Speech: >${speechThreshold.toFixed(1)} dB, Silence: <${silenceThresh.toFixed(1)} dB`);
            }

            // Skip if not calibrated yet
            if (speechThreshold === null) return;

            // Silence threshold: when audio drops back to near noise floor levels
            // Use noise floor + 5dB as "silence" (halfway between noise and speech)
            const silenceThreshold = noiseFloor! + 5;

            // Log audio level every 500ms for debugging
            if (now - lastLogTime > 500) {
              lastLogTime = now;
              const status = level >= speechThreshold ? '[SPEECH]' : level < silenceThreshold ? '[silence]' : '[ambient]';
              console.log(`[VAD] Level: ${level.toFixed(1)} dB ${status} (threshold: ${speechThreshold.toFixed(1)})`);
            }

            // Check for max recording time
            if (recordingDuration > VAD_CONFIG.MAX_RECORDING_MS) {
              console.log('[Voice-Terminal] VAD: Max recording time reached');
              stopListening();
              return;
            }

            // Detect speech start (audio above adaptive threshold)
            if (level >= speechThreshold) {
              // Clear the no-speech timeout as soon as any speech is detected
              // This prevents the 8s auto-off from firing while user is speaking
              if (noSpeechTimeoutRef.current) {
                console.log('[VAD] Speech detected, clearing no-speech timeout');
                clearTimeout(noSpeechTimeoutRef.current);
                noSpeechTimeoutRef.current = null;
              }

              if (!speechStartTime) {
                speechStartTime = now;
              } else if (!speechDetected && now - speechStartTime > VAD_CONFIG.SPEECH_START_MS) {
                speechDetected = true;
                console.log(`[Voice-Terminal] VAD: Speech confirmed (level: ${level.toFixed(1)} dB > threshold: ${speechThreshold.toFixed(1)} dB)`);
              }
              silenceStartRef.current = null;
            }
            // Check for silence (only after speech has been detected)
            else if (level < silenceThreshold) {
              speechStartTime = null;

              if (speechDetected) {
                if (!silenceStartRef.current) {
                  silenceStartRef.current = now;
                } else if (now - silenceStartRef.current > VAD_CONFIG.SILENCE_DURATION_MS) {
                  console.log('[Voice-Terminal] VAD: End of speech detected');
                  stopListening();
                }
              }
            }
            else {
              speechStartTime = null;
            }
          }
        } catch (err) {
          // Recording may have stopped
        }
      }, VAD_CONFIG.METERING_INTERVAL_MS);

    } catch (err) {
      console.error('[Voice-Terminal] Failed to start listening:', err);
      setVoiceStatus('off');
    }
  };

  const stopListening = async (sendAudio: boolean = true) => {
    stopMetering();
    setAudioLevel(0);

    // Use ref to get current active terminal (avoids stale closure issues)
    const currentActiveTerminal = activeTerminalRef.current;
    if (!recordingRef.current || !currentActiveTerminal) {
      return;
    }

    try {
      if (sendAudio) {
        setVoiceStatus('processing');
        // Reset working screenshot counter for new user interaction
        workingScreenshotAttemptsRef.current = 0;
      }

      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;
      recordingStartRef.current = null;
      silenceStartRef.current = null;

      // Reset audio mode for playback - add delay to ensure iOS audio system resets
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        playThroughEarpieceAndroid: false,
      });
      await new Promise(resolve => setTimeout(resolve, 100));

      if (uri && sendAudio) {
        const response = await fetch(uri);
        const blob = await response.blob();

        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64 = (reader.result as string).split(',')[1];
          const mimeType = blob.type || 'audio/m4a';

          // Note: Screenshot capture is skipped on Terminal tab because the Terminal
          // component uses a WebView (xterm.js), and React Native ViewShot cannot
          // capture WebView content on iOS. Instead, we rely on terminal output text.
          // Screenshots would work on other tabs that use native React Native views.
          console.log('[Voice-Terminal] Skipping screenshot (Terminal uses WebView which cannot be captured)');
          const screenCapture: string | undefined = undefined;

          // Get terminal content (~120k chars for context, roughly 30k tokens)
          const terminalContent = currentActiveTerminal?.output
            ? currentActiveTerminal.output.slice(-120000)
            : undefined;

          // Build app state for context
          const appState = {
            currentTab: 'terminal',
            projectName: project?.name,
            projectId: project?.id,
            hasPreview: false,
            fileCount: 0,
            // Multi-terminal info
            terminalCount: terminals.length,
            activeTerminalIndex: activeTerminalIndex,
            activeTerminalId: currentActiveTerminal?.id,
            // Editor info - which file is currently open (if any)
            currentFile: currentFile || undefined,
          };

          // Send to terminal with screenshot, terminal content, and app state
          bridgeService.sendVoiceAudioToTerminal(
            currentActiveTerminal.id,
            base64,
            mimeType,
            screenCapture,
            terminalContent,
            appState
          );
        };
        reader.readAsDataURL(blob);
      }
    } catch (err) {
      console.error('[Voice-Terminal] Failed to stop listening:', err);
      setVoiceStatus('off');
    }
  };

  // isComplete=true means this is the final TTS response, return to listening after
  // isComplete=false/undefined means more processing is coming (stay in working state)
  const playAudio = async (base64Audio: string, isComplete?: boolean) => {
    try {
      // Mark TTS as playing FIRST - prevents thinking sound from starting
      isTTSPlayingRef.current = true;

      // Stop thinking sound before TTS plays
      await stopThinkingSound();

      // Set status to 'speaking' for final responses, or stay in 'working' for interim
      if (isComplete) {
        console.log('[Voice] Playing final TTS response (will return to listening after)');
        setVoiceStatus('speaking');
      } else {
        console.log('[Voice] Playing interim TTS (staying in working state)');
        // Don't change status - stay in working or whatever current state is
      }

      if (soundRef.current) {
        await soundRef.current.unloadAsync();
      }

      // Clear any existing no-speech timeout
      if (noSpeechTimeoutRef.current) {
        clearTimeout(noSpeechTimeoutRef.current);
        noSpeechTimeoutRef.current = null;
      }

      // CRITICAL: Set audio mode for playback BEFORE creating sound
      // allowsRecordingIOS: false must be set to route audio to speaker
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,        // Disable recording mode to enable speaker output
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,  // Force speaker on Android
      });

      // Small delay to let iOS audio system reset from recording mode
      await new Promise(resolve => setTimeout(resolve, 100));

      const audioUri = `data:audio/mp3;base64,${base64Audio}`;
      const { sound } = await Audio.Sound.createAsync(
        { uri: audioUri },
        { shouldPlay: true, volume: 1.0 }
      );

      soundRef.current = sound;

      sound.setOnPlaybackStatusUpdate((playbackStatus: AVPlaybackStatus) => {
        if (playbackStatus.isLoaded && playbackStatus.didJustFinish) {
          soundRef.current = null;
          // TTS finished - clear the flag so thinking sound can play again if needed
          isTTSPlayingRef.current = false;

          console.log('[Voice] TTS finished, isComplete:', isComplete);

          // If this is NOT the final response (isComplete=false/undefined), stay in current state
          // The server will send another response when Claude finishes
          if (!isComplete) {
            console.log('[Voice] Interim TTS finished, waiting for final response from server');
            // Start thinking sound now since TTS is done (if we're in working state)
            const currentStatus = useVoiceStore.getState().voiceStatus;
            if (currentStatus === 'working' || currentStatus === 'processing') {
              playThinkingSound();
            }
            return;
          }

          console.log('[Voice] Final TTS finished, continuing active listening');

          // Start listening after a short delay
          setTimeout(() => {
            const currentStatus = useVoiceStore.getState().voiceStatus;
            if (currentStatus !== 'off' && currentStatus !== 'listening') {
              startListening();

              // Set 8s no-speech timeout to auto turn off
              noSpeechTimeoutRef.current = setTimeout(() => {
                const status = useVoiceStore.getState().voiceStatus;
                if (status === 'listening') {
                  console.log('[Voice] No speech for 8s, turning off');
                  stopListening(false);  // Don't send audio
                  setVoiceStatus('off');
                  // Notify server of interrupt
                  if (activeTerminal) {
                    bridgeService.sendVoiceInterrupt(activeTerminal.id);
                  }
                }
              }, VAD_CONFIG.NO_SPEECH_TIMEOUT_MS);
            }
          }, VAD_CONFIG.POST_TTS_DELAY_MS);
        }
      });
    } catch (err) {
      console.error('[Voice] Failed to play audio:', err);
      // Clear TTS playing flag on error
      isTTSPlayingRef.current = false;
      // Try to continue listening on error
      setTimeout(() => startListening(), 1000);
    }
  };

  const handleVoiceMicPress = useCallback(async () => {
    // Haptic feedback
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Get current status from store to avoid stale closure
    const currentStatus = useVoiceStore.getState().voiceStatus;
    console.log('[Voice] Mic press, current status:', currentStatus);

    // Any active state → interrupt and turn off
    if (currentStatus !== 'off') {
      console.log('[Voice] Interrupting voice mode');

      // IMMEDIATELY set status to off to prevent re-entry and update UI
      setVoiceStatus('off');
      setVoiceTranscript('');
      setVoiceProgress('');

      // Clear TTS playing flag
      isTTSPlayingRef.current = false;

      // Clear timeouts
      if (noSpeechTimeoutRef.current) {
        clearTimeout(noSpeechTimeoutRef.current);
        noSpeechTimeoutRef.current = null;
      }

      // Stop any audio playback (TTS)
      if (soundRef.current) {
        try {
          await soundRef.current.stopAsync();
          await soundRef.current.unloadAsync();
        } catch (e) {
          // Ignore
        }
        soundRef.current = null;
      }

      // Stop thinking sound
      await stopThinkingSound();

      // Stop any recording
      await cleanupRecording();

      // Notify server and disable voice (wrap in try-catch to prevent blocking)
      try {
        if (activeTerminal) {
          bridgeService.sendVoiceInterrupt(activeTerminal.id);
          bridgeService.disableVoiceOnTerminal(activeTerminal.id);
        }
      } catch (e) {
        console.log('[Voice] Error notifying server:', e);
      }
    }
  }, [activeTerminal, setVoiceStatus, setVoiceTranscript, setVoiceProgress]);

  // Register voice functions with store for tab bar access
  useEffect(() => {
    setToggleVoiceMode(toggleVoiceMode);
    setHandleVoiceMicPress(handleVoiceMicPress);

    return () => {
      setToggleVoiceMode(null);
      setHandleVoiceMicPress(null);
    };
  }, [toggleVoiceMode, handleVoiceMicPress, setToggleVoiceMode, setHandleVoiceMicPress]);

  // Handle pending voice start from tab bar button (when navigating from another tab)
  useEffect(() => {
    if (pendingVoiceStart && activeTerminal && voiceStatus === 'off') {
      console.log('[Chat] Starting voice mode from pending flag');
      setPendingVoiceStart(false);
      // Small delay to ensure terminal is fully ready
      setTimeout(() => {
        console.log('[Chat] Calling toggleVoiceMode now');
        toggleVoiceMode();
      }, 300);
    }
    // Note: Don't include toggleVoiceMode in deps - it's not a dependency, we're calling it
    // Including it causes infinite loops since toggleVoiceMode recreates on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingVoiceStart, activeTerminal, voiceStatus, setPendingVoiceStart]);

  if (!project) {
    return (
      <View style={styles.container}>
        <EmptyState
          icon={<TerminalIcon color={colors.mutedForeground} size={48} />}
          title="No project selected"
          description="Select or create a project to open a terminal"
          action={
            <Button title="Go to Projects" onPress={() => router.push('/')} />
          }
        />
      </View>
    );
  }

  if (!isConnected) {
    return (
      <View style={styles.container}>
        <EmptyState
          icon={<TerminalIcon color={colors.mutedForeground} size={48} />}
          title="Not connected"
          description="Connect to the bridge server to use the terminal"
          action={
            <Button title="Settings" onPress={() => router.push('/settings')} />
          }
        />
      </View>
    );
  }

  return (
    <ViewShot ref={viewShotRef} style={styles.container} options={{ format: 'png', quality: 0.8 }}>
      {/* Voice Transcript Bar - show what user said (status moved to voice button) */}
      {voiceStatus !== 'off' && voiceTranscript && (
        <View style={styles.voiceStatusBar}>
          <Text style={styles.voiceStatusBarText} numberOfLines={2}>
            <Text style={styles.voiceStatusBarLabel}>You: </Text>
            {voiceTranscript}
          </Text>
        </View>
      )}

      {/* Terminal Tabs - only show when multiple terminals */}
      {terminals.length > 1 && (
        <View style={styles.tabsContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsContent}>
            {terminals.map((terminal, index) => (
              <View key={terminal.id} style={[styles.tab, index === activeTerminalIndex && styles.tabActive]}>
                <TouchableOpacity
                  style={styles.tabLabel}
                  onPress={() => setActiveTerminalIndex(index)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.tabText, index === activeTerminalIndex && styles.tabTextActive]}>
                    Term {index + 1}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.tabClose}
                  onPress={() => closeTerminal(index)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <X color={index === activeTerminalIndex ? '#FFF' : '#666'} size={12} />
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Terminal */}
      <Terminal
        output={activeTerminal?.output || ''}
        onInput={handleInput}
        onResize={handleResize}
        onNewTerminal={handleNewTerminal}
      />
    </ViewShot>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1E1E1E',
  },
  voiceStatusBar: {
    backgroundColor: '#1A1A1A',
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A2A',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  voiceStatusBarText: {
    color: '#FFF',
    fontSize: 13,
    lineHeight: 18,
  },
  voiceStatusBarLabel: {
    color: '#22C55E',
    fontWeight: '600',
  },
  tabsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#252525',
    borderBottomWidth: 1,
    borderBottomColor: '#3D3D3D',
    paddingRight: 8,
  },
  tabsContent: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 4,
    flex: 1,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E1E1E',
    borderRadius: 6,
    gap: 4,
    overflow: 'hidden',
  },
  tabActive: {
    backgroundColor: colors.brandTiger,
  },
  tabLabel: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  tabText: {
    color: '#888',
    fontSize: 13,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#FFF',
  },
  tabClose: {
    padding: 8,
    marginLeft: -4,
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(255,255,255,0.1)',
  },
});
