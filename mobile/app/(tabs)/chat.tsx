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

// VAD Configuration - Tuned for natural conversation flow
// Based on OpenAI Realtime API best practices
const VAD_CONFIG = {
  // Audio level thresholds (dB)
  SILENCE_THRESHOLD: -35, // dB level below which is considered silence (more negative = less sensitive)
  SPEECH_THRESHOLD: -25, // dB level above which confirms speech is happening

  // Timing settings
  SILENCE_DURATION_MS: 2500, // 2.5s of silence after speech before stopping
  SPEECH_START_MS: 300, // Must have 300ms of speech-level audio to confirm speaking
  MIN_RECORDING_MS: 2000, // Minimum 2s recording before VAD kicks in (allows natural pauses)
  MAX_RECORDING_MS: 60000, // Maximum 60s recording to prevent runaway
  METERING_INTERVAL_MS: 100, // How often to check audio levels
  POST_TTS_DELAY_MS: 2000, // Wait 2s after TTS ends before listening (user thinking time)

  // Wake word settings
  WAKE_WORD_MAX_MS: 5000, // Max 5s recording for wake word detection
  ACTIVE_TIMEOUT_MS: 60000, // Return to sleeping after 60s of inactivity
};

export default function TerminalScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ pendingPrompt?: string; createNewTerminal?: string }>();

  const { currentProjectId, projects, currentProject } = useProjectStore();
  const { bridgeServerUrl, isConnected, setIsConnected } = useSettingsStore();

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
  const meteringIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const silenceStartRef = useRef<number | null>(null);
  const recordingStartRef = useRef<number | null>(null);
  // Wake word tracking
  const isWakeWordModeRef = useRef<boolean>(true); // true = sleeping mode, false = active mode
  const activeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const viewShotRef = useRef<ViewShot>(null);

  const project = currentProject();
  const activeTerminal = terminals[activeTerminalIndex];
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

  // Create initial terminal when project changes
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

    if (terminals.length === 0) {
      createTerminal();
    }

    return () => {
      terminals.forEach((t) => bridgeService.closeTerminal(t.id));
      stopMetering();
    };
  }, [currentProjectId, isConnected]);

  // Cleanup on unmount only
  useEffect(() => {
    return () => {
      stopMetering();
    };
  }, []);

  // Handle pending prompt from preview (console logs to send to Claude)
  useEffect(() => {
    if (params.pendingPrompt && !pendingPromptSentRef.current) {
      pendingPromptRef.current = params.pendingPrompt;
      pendingPromptSentRef.current = false;

      // If requested to create new terminal, do so
      if (params.createNewTerminal === 'true') {
        console.log('[Terminal] Creating new terminal for pending prompt');
        createTerminalWithPrompt(params.pendingPrompt);
      }
    }
  }, [params.pendingPrompt, params.createNewTerminal]);

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
      console.log('[Chat] Enabling voice on terminal:', activeTerminal.id);
      bridgeService.enableVoiceOnTerminal(activeTerminal.id, {
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
        onSpeaking: (text, audioData) => {
          console.log('[Voice-Terminal] Speaking:', text);
          setVoiceProgress('');
          playAudio(audioData);
        },
        onAppControl: (control) => {
          console.log('[Voice-Terminal] App control:', control);
          // Handle app control actions from voice agent
          if (control.action === 'navigate' && control.target) {
            // Navigate to different tabs
            const tabMap: Record<string, string> = {
              'terminal': '/(tabs)/chat',
              'chat': '/(tabs)/chat',
              'preview': '/(tabs)/preview',
              'projects': '/(tabs)',
              'voice': '/(tabs)/voice',
              'editor': '/(tabs)/editor',
            };
            const route = tabMap[control.target.toLowerCase()];
            if (route) {
              router.push(route as any);
            }
          } else if (control.action === 'take_screenshot') {
            // Voice agent requested a fresh screenshot - will be sent with next audio
            console.log('[Voice-Terminal] Screenshot requested by agent');
          }
        },
        onWakeWord: (text) => {
          console.log('[Voice-Terminal] Wake word detected:', text);
          // Haptic feedback for wake word
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          // Switch to active mode
          isWakeWordModeRef.current = false;
          lastActivityRef.current = Date.now();
          // If the wake word had additional content, show it as transcript
          const wakeWords = ['hey lora', 'hey laura', 'hi lora', 'hi laura', 'okay lora', 'ok lora'];
          let remainder = text.toLowerCase();
          for (const ww of wakeWords) {
            if (remainder.startsWith(ww)) {
              remainder = text.substring(ww.length).trim();
              break;
            }
          }
          if (remainder.length > 2) {
            setVoiceTranscript(remainder);
            setVoiceStatus('processing');
          } else {
            // No additional content - start listening for command
            setVoiceStatus('listening');
            setTimeout(() => startListening(), 100);
          }
        },
        onNoWakeWord: () => {
          console.log('[Voice-Terminal] No wake word detected, continuing to sleep');
          // Stay in sleeping mode, start listening again
          setVoiceStatus('sleeping');
          setTimeout(() => startWakeWordListening(), 500);
        },
        onEnabled: () => {
          console.log('[Voice-Terminal] Voice mode enabled, starting active listening');
          isWakeWordModeRef.current = false; // Start in active mode, not wake word mode
          setVoiceTranscript('');
          setVoiceProgress('');
          // Start in active listening mode immediately
          // Only go to sleeping mode after first interaction completes
          setTimeout(() => startListening(), 500);
        },
        onDisabled: () => {
          console.log('[Voice-Terminal] Voice mode disabled');
          // Clear any active timeout
          if (activeTimeoutRef.current) {
            clearTimeout(activeTimeoutRef.current);
            activeTimeoutRef.current = null;
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
          // Go back to sleeping mode on error
          setVoiceStatus('sleeping');
          isWakeWordModeRef.current = true;
          setTimeout(() => startWakeWordListening(), 1000);
        }
      });
    } else {
      // Turn off voice mode
      // Set status to 'off' IMMEDIATELY to prevent double-taps during async cleanup
      setVoiceStatus('off');
      setVoiceTranscript('');

      // Now do async cleanup
      stopMetering();
      if (recordingRef.current) {
        await recordingRef.current.stopAndUnloadAsync();
        recordingRef.current = null;
      }
      if (soundRef.current) {
        await soundRef.current.stopAsync();
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }
      bridgeService.disableVoiceOnTerminal(activeTerminal.id);
    }
  }, [activeTerminal, voiceStatus, setVoiceStatus, setVoiceTranscript, setVoiceProgress]);

  // Wake word listening mode - shorter timeout, only checks for "Hey Lora"
  const startWakeWordListening = async () => {
    console.log('[Voice] startWakeWordListening called, activeTerminal:', !!activeTerminal, 'voiceStatus:', voiceStatus);

    // Check current voice status from store directly to avoid stale closure
    const currentStatus = useVoiceStore.getState().voiceStatus;
    console.log('[Voice] Current status from store:', currentStatus);

    if (!activeTerminal || currentStatus === 'off') {
      console.log('[Voice] Skipping wake word listening - no terminal or voice off');
      return;
    }

    // Don't start if we're already listening or processing
    if (recordingRef.current) {
      console.log('[Voice] Already recording, skipping');
      return;
    }

    try {
      console.log('[Voice] Requesting audio permissions...');
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        console.log('[Voice] Audio permission denied');
        return;
      }
      console.log('[Voice] Audio permission granted');

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync({
        ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
        isMeteringEnabled: true,
      });
      await recording.startAsync();
      console.log('[Voice] Wake word recording started');

      recordingRef.current = recording;
      recordingStartRef.current = Date.now();
      silenceStartRef.current = null;
      isWakeWordModeRef.current = true;
      // Don't change status - stay in 'sleeping'

      let speechDetected = false;
      let speechStartTime: number | null = null;

      // VAD for wake word - shorter timeout
      meteringIntervalRef.current = setInterval(async () => {
        if (!recordingRef.current) return;

        try {
          const status = await recordingRef.current.getStatusAsync();
          if (status.isRecording && status.metering !== undefined) {
            const level = status.metering;
            const now = Date.now();
            const recordingDuration = now - (recordingStartRef.current || now);

            // Shorter max time for wake word detection
            if (recordingDuration > VAD_CONFIG.WAKE_WORD_MAX_MS) {
              console.log('[Voice] Wake word max time reached, restarting...');
              // No speech detected in 5s, restart listening
              stopMetering();
              if (recordingRef.current) {
                await recordingRef.current.stopAndUnloadAsync();
                recordingRef.current = null;
              }
              // Restart wake word listening if still in sleeping mode
              const currentStatus = useVoiceStore.getState().voiceStatus;
              if (currentStatus === 'sleeping') {
                setTimeout(() => startWakeWordListening(), 100);
              }
              return;
            }

            // Detect speech - log audio level periodically for debugging
            if (recordingDuration % 1000 < VAD_CONFIG.METERING_INTERVAL_MS) {
              console.log('[Voice] Wake word audio level:', level.toFixed(1), 'dB');
            }

            if (level >= VAD_CONFIG.SPEECH_THRESHOLD) {
              if (!speechStartTime) speechStartTime = now;
              else if (!speechDetected && now - speechStartTime > VAD_CONFIG.SPEECH_START_MS) {
                speechDetected = true;
                console.log('[Voice] Wake word listening: Speech detected!');
              }
              silenceStartRef.current = null;
            } else if (level < VAD_CONFIG.SILENCE_THRESHOLD) {
              speechStartTime = null;
              if (speechDetected) {
                if (!silenceStartRef.current) {
                  silenceStartRef.current = now;
                } else if (now - silenceStartRef.current > 1000) { // 1s silence after speech
                  console.log('[Voice] Wake word listening: End of speech, sending for check');
                  await stopWakeWordListening();
                }
              }
            }
          }
        } catch (err) {
          // Recording may have stopped
        }
      }, VAD_CONFIG.METERING_INTERVAL_MS);

    } catch (err) {
      console.error('[Voice-Terminal] Failed to start wake word listening:', err);
      // Retry after delay
      setTimeout(() => startWakeWordListening(), 2000);
    }
  };

  // Stop wake word listening and send audio for wake word check
  const stopWakeWordListening = async () => {
    stopMetering();

    if (!recordingRef.current || !activeTerminal) {
      // Restart wake word listening if still sleeping
      if (voiceStatus === 'sleeping') {
        setTimeout(() => startWakeWordListening(), 500);
      }
      return;
    }

    try {
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;
      silenceStartRef.current = null;

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });

      if (uri) {
        console.log('[Voice] Wake word audio captured, sending to server...');
        const response = await fetch(uri);
        const blob = await response.blob();

        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(',')[1];
          const mimeType = blob.type || 'audio/m4a';
          console.log('[Voice] Sending wake word audio for check, size:', base64.length);
          // Send with wakeWordCheck flag
          bridgeService.sendVoiceAudioToTerminal(
            activeTerminal.id,
            base64,
            mimeType,
            undefined, // no screenshot for wake word
            true // wakeWordCheck = true
          );
        };
        reader.readAsDataURL(blob);
      } else {
        // No audio, restart wake word listening
        if (voiceStatus === 'sleeping') {
          setTimeout(() => startWakeWordListening(), 500);
        }
      }
    } catch (err) {
      console.error('[Voice-Terminal] Failed to stop wake word listening:', err);
      if (voiceStatus === 'sleeping') {
        setTimeout(() => startWakeWordListening(), 1000);
      }
    }
  };

  const startListening = async () => {
    console.log('[Voice] startListening called, activeTerminal:', !!activeTerminal);

    if (!activeTerminal) {
      console.log('[Voice] No active terminal, skipping');
      return;
    }

    // Mark as active mode
    isWakeWordModeRef.current = false;
    lastActivityRef.current = Date.now();

    // Get current status from store to avoid stale closure
    const currentStatus = useVoiceStore.getState().voiceStatus;
    console.log('[Voice] Current status from store:', currentStatus);

    // Interrupt if speaking
    if (currentStatus === 'speaking' && soundRef.current) {
      console.log('[Voice] Interrupting current speech');
      await soundRef.current.stopAsync();
      await soundRef.current.unloadAsync();
      soundRef.current = null;
    }

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

      // Track if we've detected actual speech (not just noise)
      let speechDetected = false;
      let speechStartTime: number | null = null;

      // VAD monitoring - Based on OpenAI Realtime best practices
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

            // Check for max recording time
            if (recordingDuration > VAD_CONFIG.MAX_RECORDING_MS) {
              console.log('[Voice-Terminal] VAD: Max recording time reached');
              stopListening();
              return;
            }

            // Detect speech start (audio above speech threshold)
            if (level >= VAD_CONFIG.SPEECH_THRESHOLD) {
              if (!speechStartTime) {
                speechStartTime = now;
              } else if (!speechDetected && now - speechStartTime > VAD_CONFIG.SPEECH_START_MS) {
                // Confirmed speech after sustained audio above threshold
                speechDetected = true;
                console.log('[Voice-Terminal] VAD: Speech confirmed');
              }
              // Reset silence counter when speech detected
              silenceStartRef.current = null;
            }
            // Check for silence (only after speech has been detected)
            else if (level < VAD_CONFIG.SILENCE_THRESHOLD) {
              // Reset speech start if we go below silence threshold
              speechStartTime = null;

              // Only start counting silence after we've confirmed speech
              if (speechDetected) {
                if (!silenceStartRef.current) {
                  silenceStartRef.current = now;
                } else if (now - silenceStartRef.current > VAD_CONFIG.SILENCE_DURATION_MS) {
                  console.log('[Voice-Terminal] VAD: End of speech detected');
                  stopListening();
                }
              }
            }
            // Audio between thresholds - ambiguous, maintain current state
            else {
              speechStartTime = null; // Not clearly speech
              // Don't reset silence timer for ambiguous levels
            }
          }
        } catch (err) {
          // Recording may have stopped
        }
      }, VAD_CONFIG.METERING_INTERVAL_MS);

    } catch (err) {
      console.error('[Voice-Terminal] Failed to start listening:', err);
      // Go back to sleeping mode on error
      setVoiceStatus('sleeping');
      isWakeWordModeRef.current = true;
      setTimeout(() => startWakeWordListening(), 1000);
    }
  };

  const stopListening = async () => {
    stopMetering();
    setAudioLevel(0);

    if (!recordingRef.current || !activeTerminal) {
      // Go back to sleeping mode
      setVoiceStatus('sleeping');
      isWakeWordModeRef.current = true;
      setTimeout(() => startWakeWordListening(), 500);
      return;
    }

    try {
      setVoiceStatus('processing');

      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;
      recordingStartRef.current = null;
      silenceStartRef.current = null;

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });

      if (uri) {
        const response = await fetch(uri);
        const blob = await response.blob();

        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64 = (reader.result as string).split(',')[1];
          const mimeType = blob.type || 'audio/m4a';

          // Capture screenshot of current screen for voice agent vision
          let screenCapture: string | undefined;
          try {
            if (viewShotRef.current?.capture) {
              const screenshotUri = await viewShotRef.current.capture();
              const screenshotResponse = await fetch(screenshotUri);
              const screenshotBlob = await screenshotResponse.blob();
              const screenshotReader = new FileReader();
              screenCapture = await new Promise<string>((resolve) => {
                screenshotReader.onloadend = () => {
                  const base64Screenshot = (screenshotReader.result as string).split(',')[1];
                  resolve(base64Screenshot);
                };
                screenshotReader.readAsDataURL(screenshotBlob);
              });
            }
          } catch (screenshotErr) {
            console.log('[Voice-Terminal] Screenshot capture failed:', screenshotErr);
          }

          // Send to terminal with screenshot (will be transcribed and sent to voice agent)
          bridgeService.sendVoiceAudioToTerminal(activeTerminal.id, base64, mimeType, screenCapture);
        };
        reader.readAsDataURL(blob);
      }
    } catch (err) {
      console.error('[Voice-Terminal] Failed to stop listening:', err);
      // Go back to sleeping mode on error
      setVoiceStatus('sleeping');
      isWakeWordModeRef.current = true;
      setTimeout(() => startWakeWordListening(), 1000);
    }
  };

  const playAudio = async (base64Audio: string) => {
    try {
      setVoiceStatus('speaking');

      if (soundRef.current) {
        await soundRef.current.unloadAsync();
      }

      // Always play through speaker (not earpiece)
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });

      const audioUri = `data:audio/mp3;base64,${base64Audio}`;
      const { sound } = await Audio.Sound.createAsync(
        { uri: audioUri },
        { shouldPlay: true, volume: 1.0 }
      );

      soundRef.current = sound;

      sound.setOnPlaybackStatusUpdate((playbackStatus: AVPlaybackStatus) => {
        if (playbackStatus.isLoaded && playbackStatus.didJustFinish) {
          soundRef.current = null;
          // After speaking, continue in active listening mode
          // Only go to sleep after 1 minute of inactivity
          console.log('[Voice] TTS finished, continuing active listening');
          lastActivityRef.current = Date.now();
          isWakeWordModeRef.current = false;

          // Start inactivity timer - go to sleep after 1 minute
          if (activeTimeoutRef.current) {
            clearTimeout(activeTimeoutRef.current);
          }
          activeTimeoutRef.current = setTimeout(() => {
            const currentStatus = useVoiceStore.getState().voiceStatus;
            console.log('[Voice] Inactivity timeout, current status:', currentStatus);
            if (currentStatus !== 'off') {
              console.log('[Voice] Going to sleep mode after inactivity');
              setVoiceStatus('sleeping');
              isWakeWordModeRef.current = true;
              startWakeWordListening();
            }
          }, VAD_CONFIG.ACTIVE_TIMEOUT_MS);

          // Continue listening after a short delay
          setTimeout(() => {
            const currentStatus = useVoiceStore.getState().voiceStatus;
            if (currentStatus !== 'off' && currentStatus !== 'listening') {
              startListening();
            }
          }, VAD_CONFIG.POST_TTS_DELAY_MS);
        }
      });
    } catch (err) {
      console.error('[Voice] Failed to play audio:', err);
      // Continue listening on error
      isWakeWordModeRef.current = false;
      setTimeout(() => startListening(), 1000);
    }
  };

  const handleVoiceMicPress = useCallback(() => {
    // Haptic feedback
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Get current status from store to avoid stale closure
    const currentStatus = useVoiceStore.getState().voiceStatus;
    console.log('[Voice] Mic press, current status:', currentStatus);

    if (currentStatus === 'listening') {
      // TAP while listening → send what was recorded
      console.log('[Voice] Stopping listening early');
      stopListening();
    } else if (currentStatus === 'sleeping') {
      // TAP while sleeping → wake up and start listening
      console.log('[Voice] Waking from sleep');
      isWakeWordModeRef.current = false;
      lastActivityRef.current = Date.now();
      // Stop any current wake word recording
      stopMetering();
      if (recordingRef.current) {
        recordingRef.current.stopAndUnloadAsync().catch(() => {});
        recordingRef.current = null;
      }
      startListening();
    } else if (currentStatus === 'speaking') {
      // TAP while speaking → interrupt and start listening
      console.log('[Voice] Interrupting speech');
      startListening();
    } else if (currentStatus === 'processing') {
      // TAP while processing → do nothing, wait for response
      console.log('[Voice] Processing, please wait...');
    }
  }, []);

  // Register voice functions with store for tab bar access
  useEffect(() => {
    setToggleVoiceMode(() => toggleVoiceMode);
    setHandleVoiceMicPress(() => handleVoiceMicPress);

    return () => {
      setToggleVoiceMode(null);
      setHandleVoiceMicPress(null);
    };
  }, [toggleVoiceMode, handleVoiceMicPress, setToggleVoiceMode, setHandleVoiceMicPress]);

  // Handle pending voice start from tab bar button (when navigating from another tab)
  useEffect(() => {
    console.log('[Chat] Pending voice check:', { pendingVoiceStart, hasTerminal: !!activeTerminal, voiceStatus });
    if (pendingVoiceStart && activeTerminal && voiceStatus === 'off') {
      console.log('[Chat] Starting voice mode from pending flag');
      setPendingVoiceStart(false);
      // Small delay to ensure terminal is fully ready
      setTimeout(() => {
        console.log('[Chat] Calling toggleVoiceMode now');
        toggleVoiceMode();
      }, 300);
    }
  }, [pendingVoiceStart, activeTerminal, voiceStatus, setPendingVoiceStart, toggleVoiceMode]);

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
      {/* Voice Status Bar - compact display when voice is active */}
      {voiceStatus !== 'off' && (voiceTranscript || voiceProgress) && (
        <View style={styles.voiceStatusBar}>
          {voiceTranscript && (
            <Text style={styles.voiceStatusBarText} numberOfLines={2}>
              <Text style={styles.voiceStatusBarLabel}>You: </Text>
              {voiceTranscript}
            </Text>
          )}
          {voiceProgress && (
            <Text style={styles.voiceStatusBarProgress} numberOfLines={1}>
              {voiceProgress}
            </Text>
          )}
        </View>
      )}

      {/* Terminal Tabs - only show when multiple terminals */}
      {terminals.length > 1 && (
        <View style={styles.tabsContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsContent}>
            {terminals.map((terminal, index) => (
              <TouchableOpacity
                key={terminal.id}
                style={[styles.tab, index === activeTerminalIndex && styles.tabActive]}
                onPress={() => setActiveTerminalIndex(index)}
              >
                <Text style={[styles.tabText, index === activeTerminalIndex && styles.tabTextActive]}>
                  {index + 1}
                </Text>
                <TouchableOpacity
                  style={styles.tabClose}
                  onPress={() => closeTerminal(index)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <X color={index === activeTerminalIndex ? '#FFF' : '#888'} size={10} />
                </TouchableOpacity>
              </TouchableOpacity>
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
  voiceStatusBarProgress: {
    color: colors.brandTiger,
    fontSize: 12,
    marginTop: 4,
    fontWeight: '500',
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
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#1E1E1E',
    borderRadius: 4,
    gap: 6,
  },
  tabActive: {
    backgroundColor: colors.brandTiger,
  },
  tabText: {
    color: '#888',
    fontSize: 11,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#FFF',
  },
  tabClose: {
    padding: 2,
  },
});
