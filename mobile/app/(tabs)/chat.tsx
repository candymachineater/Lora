import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView, Animated, Easing } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Terminal as TerminalIcon, Plus, X, Mic, MicOff, Volume2, Square } from 'lucide-react-native';
import { Audio, AVPlaybackStatus } from 'expo-av';
import ViewShot from 'react-native-view-shot';
import * as Haptics from 'expo-haptics';
import { useProjectStore, useSettingsStore } from '../../stores';
import { bridgeService } from '../../services/claude/api';
import { Terminal } from '../../components/terminal';
import { EmptyState, Button } from '../../components/common';
import { colors, spacing, shadows } from '../../theme';

interface TerminalSession {
  id: string;
  output: string;
  sandbox: boolean;
}

type VoiceStatus = 'off' | 'idle' | 'listening' | 'processing' | 'speaking';

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
};

// Helper to strip ANSI codes for display
const stripAnsi = (str: string) => str.replace(/\x1b\[[0-9;]*m/g, '');

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

  // Voice mode state - now integrated directly with terminal
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('off');
  const [audioLevel, setAudioLevel] = useState(0);
  const [voiceTranscript, setVoiceTranscript] = useState<string>('');
  const [voiceProgress, setVoiceProgress] = useState<string>('');

  const recordingRef = useRef<Audio.Recording | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const meteringIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const silenceStartRef = useRef<number | null>(null);
  const recordingStartRef = useRef<number | null>(null);
  // Multiple orb animations for ChatGPT-style effect
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const ring1Anim = useRef(new Animated.Value(1)).current;
  const ring2Anim = useRef(new Animated.Value(1)).current;
  const ring3Anim = useRef(new Animated.Value(1)).current;
  const ring1Opacity = useRef(new Animated.Value(0.3)).current;
  const ring2Opacity = useRef(new Animated.Value(0.2)).current;
  const ring3Opacity = useRef(new Animated.Value(0.1)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;
  const viewShotRef = useRef<ViewShot>(null);
  const lastScreenshotRef = useRef<string | undefined>(undefined);
  const terminalContentRef = useRef<string>(''); // Store terminal output for voice context

  const project = currentProject();
  const activeTerminal = terminals[activeTerminalIndex];
  const projectSandbox = project?.sandbox ?? true;

  // Enhanced orb animations for voice mode (ChatGPT-style)
  useEffect(() => {
    if (voiceStatus === 'listening') {
      // Main pulse
      const mainPulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.15, duration: 600, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        ])
      );

      // Concentric ring animations with staggered timing
      const ring1Pulse = Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(ring1Anim, { toValue: 1.8, duration: 1500, useNativeDriver: true, easing: Easing.out(Easing.ease) }),
            Animated.timing(ring1Opacity, { toValue: 0, duration: 1500, useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.timing(ring1Anim, { toValue: 1, duration: 0, useNativeDriver: true }),
            Animated.timing(ring1Opacity, { toValue: 0.3, duration: 0, useNativeDriver: true }),
          ]),
        ])
      );

      const ring2Pulse = Animated.loop(
        Animated.sequence([
          Animated.delay(500),
          Animated.parallel([
            Animated.timing(ring2Anim, { toValue: 2.2, duration: 1500, useNativeDriver: true, easing: Easing.out(Easing.ease) }),
            Animated.timing(ring2Opacity, { toValue: 0, duration: 1500, useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.timing(ring2Anim, { toValue: 1, duration: 0, useNativeDriver: true }),
            Animated.timing(ring2Opacity, { toValue: 0.2, duration: 0, useNativeDriver: true }),
          ]),
        ])
      );

      const ring3Pulse = Animated.loop(
        Animated.sequence([
          Animated.delay(1000),
          Animated.parallel([
            Animated.timing(ring3Anim, { toValue: 2.6, duration: 1500, useNativeDriver: true, easing: Easing.out(Easing.ease) }),
            Animated.timing(ring3Opacity, { toValue: 0, duration: 1500, useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.timing(ring3Anim, { toValue: 1, duration: 0, useNativeDriver: true }),
            Animated.timing(ring3Opacity, { toValue: 0.1, duration: 0, useNativeDriver: true }),
          ]),
        ])
      );

      mainPulse.start();
      ring1Pulse.start();
      ring2Pulse.start();
      ring3Pulse.start();

      return () => {
        mainPulse.stop();
        ring1Pulse.stop();
        ring2Pulse.stop();
        ring3Pulse.stop();
      };
    } else if (voiceStatus === 'speaking') {
      // Gentle breathing animation when speaking
      const breathe = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.08, duration: 800, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        ])
      );
      // Glow effect
      const glow = Animated.loop(
        Animated.sequence([
          Animated.timing(glowAnim, { toValue: 1, duration: 1000, useNativeDriver: false }),
          Animated.timing(glowAnim, { toValue: 0.5, duration: 1000, useNativeDriver: false }),
        ])
      );
      breathe.start();
      glow.start();
      return () => {
        breathe.stop();
        glow.stop();
      };
    } else {
      pulseAnim.setValue(1);
      ring1Anim.setValue(1);
      ring2Anim.setValue(1);
      ring3Anim.setValue(1);
      ring1Opacity.setValue(0.3);
      ring2Opacity.setValue(0.2);
      ring3Opacity.setValue(0.1);
      glowAnim.setValue(0);
    }
  }, [voiceStatus]);

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

  // Capture screenshot before voice overlay appears
  const captureScreenshot = async (): Promise<string | undefined> => {
    try {
      if (viewShotRef.current?.capture) {
        const screenshotUri = await viewShotRef.current.capture();
        const screenshotResponse = await fetch(screenshotUri);
        const screenshotBlob = await screenshotResponse.blob();
        return new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64Screenshot = (reader.result as string).split(',')[1];
            resolve(base64Screenshot);
          };
          reader.readAsDataURL(screenshotBlob);
        });
      }
    } catch (err) {
      console.log('[Voice-Terminal] Screenshot capture failed:', err);
    }
    return undefined;
  };

  // Keep track of terminal content for voice agent context
  useEffect(() => {
    if (activeTerminal?.output) {
      // Store last 3000 chars of terminal output for context
      terminalContentRef.current = activeTerminal.output.slice(-3000);
    }
  }, [activeTerminal?.output]);

  // Voice Mode Functions - now integrated directly with terminal
  const toggleVoiceMode = async () => {
    if (!activeTerminal) {
      Alert.alert('No Terminal', 'Please wait for terminal to be ready');
      return;
    }

    if (voiceStatus === 'off') {
      // Capture screenshot BEFORE voice overlay appears
      console.log('[Voice-Terminal] Capturing screenshot before enabling voice mode...');
      lastScreenshotRef.current = await captureScreenshot();
      console.log('[Voice-Terminal] Screenshot captured:', lastScreenshotRef.current ? 'success' : 'failed');

      // Turn on voice mode for this terminal
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
        onAppControl: async (control) => {
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
              // Capture screenshot after navigation completes
              setTimeout(async () => {
                lastScreenshotRef.current = await captureScreenshot();
                console.log('[Voice-Terminal] Screenshot captured after navigation');
              }, 500);
            }
          } else if (control.action === 'take_screenshot') {
            // Voice agent requested a fresh screenshot
            console.log('[Voice-Terminal] Screenshot requested by agent');
            lastScreenshotRef.current = await captureScreenshot();
            console.log('[Voice-Terminal] Fresh screenshot captured');
          } else if (control.action === 'refresh_files') {
            // Navigate to editor and refresh - files will auto-refresh
            router.push('/(tabs)/editor' as any);
            console.log('[Voice-Terminal] Navigating to editor to show files');
          } else if (control.action === 'show_settings') {
            // Open settings modal
            router.push('/settings' as any);
            console.log('[Voice-Terminal] Opening settings');
          } else if (control.action === 'create_project') {
            // Navigate to projects tab to create new project
            router.push('/(tabs)' as any);
            console.log('[Voice-Terminal] Navigating to projects');
          }
        },
        onEnabled: () => {
          console.log('[Voice-Terminal] Voice mode enabled');
          setVoiceStatus('idle');
          setVoiceTranscript('');
          setVoiceProgress('');
        },
        onDisabled: () => {
          console.log('[Voice-Terminal] Voice mode disabled');
          setVoiceStatus('off');
        },
        onError: (error) => {
          console.error('[Voice-Terminal] Error:', error);
          Alert.alert('Voice Error', error);
          setVoiceStatus('idle');
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
  };

  const startListening = async () => {
    if (!activeTerminal) return;

    // Interrupt if speaking
    if (voiceStatus === 'speaking' && soundRef.current) {
      await soundRef.current.stopAsync();
      await soundRef.current.unloadAsync();
      soundRef.current = null;
    }

    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
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

      recordingRef.current = recording;
      recordingStartRef.current = Date.now();
      silenceStartRef.current = null;
      setVoiceStatus('listening');
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
      setVoiceStatus('idle');
    }
  };

  const stopListening = async () => {
    stopMetering();
    setAudioLevel(0);

    if (!recordingRef.current || !activeTerminal) {
      setVoiceStatus('idle');
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

          // Use the cached screenshot (captured before voice overlay appeared)
          // and capture a fresh one for the next interaction
          const screenCapture = lastScreenshotRef.current;

          // Log screenshot usage
          if (screenCapture) {
            console.log('[Voice-Terminal] Using cached screenshot, size:', Math.round(screenCapture.length / 1024), 'KB');
          } else {
            console.log('[Voice-Terminal] No screenshot available');
          }

          // Get terminal content for context (last 2000 chars, strip ANSI codes)
          const terminalContent = terminalContentRef.current
            ? stripAnsi(terminalContentRef.current).slice(-2000)
            : undefined;

          // Get current app state
          const appState = {
            currentTab: 'terminal',
            projectName: project?.name,
            projectId: currentProjectId || undefined,
            hasPreview: false,  // Could check preview state if needed
            fileCount: undefined  // Could count files if needed
          };

          // Send to terminal with screenshot, terminal content, and app state
          bridgeService.sendVoiceAudioToTerminal(
            activeTerminal.id,
            base64,
            mimeType,
            screenCapture,
            terminalContent,
            appState
          );

          // Capture fresh screenshot for next interaction (after TTS plays, overlay may be hidden)
          setTimeout(async () => {
            lastScreenshotRef.current = await captureScreenshot();
          }, 500);
        };
        reader.readAsDataURL(blob);
      }
    } catch (err) {
      console.error('[Voice-Terminal] Failed to stop listening:', err);
      setVoiceStatus('idle');
    }
  };

  const playAudio = async (base64Audio: string) => {
    try {
      setVoiceStatus('speaking');

      if (soundRef.current) {
        await soundRef.current.unloadAsync();
      }

      const audioUri = `data:audio/mp3;base64,${base64Audio}`;
      const { sound } = await Audio.Sound.createAsync(
        { uri: audioUri },
        { shouldPlay: true }
      );

      soundRef.current = sound;

      sound.setOnPlaybackStatusUpdate((playbackStatus: AVPlaybackStatus) => {
        if (playbackStatus.isLoaded && playbackStatus.didJustFinish) {
          soundRef.current = null;
          // Wait before auto-listening to give user time to think
          setVoiceStatus('idle');
          setTimeout(() => {
            // Only start listening if we're still in idle (not manually triggered)
            if (voiceStatus === 'idle' || voiceStatus === 'off') {
              startListening();
            }
          }, VAD_CONFIG.POST_TTS_DELAY_MS);
        }
      });
    } catch (err) {
      console.error('[Voice] Failed to play audio:', err);
      setVoiceStatus('idle');
    }
  };

  const handleVoiceMicPress = () => {
    // Haptic feedback
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    if (voiceStatus === 'listening') {
      stopListening();
    } else if (voiceStatus === 'idle' || voiceStatus === 'speaking') {
      startListening();
    }
  };

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
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.projectName}>{project.name}</Text>
          <Text style={styles.projectPath}>{project.path}</Text>
        </View>
        <View style={styles.headerRight}>
          {/* Voice Mode Toggle */}
          <TouchableOpacity
            style={[
              styles.voiceToggle,
              voiceStatus !== 'off' && styles.voiceToggleActive
            ]}
            onPress={toggleVoiceMode}
            disabled={!activeTerminal}
          >
            <Mic color={voiceStatus !== 'off' ? '#FFF' : '#888'} size={16} />
            <Text style={[
              styles.voiceToggleText,
              voiceStatus !== 'off' && styles.voiceToggleTextActive
            ]}>
              {voiceStatus !== 'off' ? 'Voice ON' : 'Voice'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.newTerminalButton} onPress={handleNewTerminal}>
            <Plus color="#FFF" size={16} />
            <Text style={styles.newTerminalText}>New</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Voice Mode Overlay - ChatGPT-style with orb animations */}
      {voiceStatus !== 'off' && (
        <View style={styles.voiceOverlay}>
          {/* Show transcription */}
          {voiceTranscript && (
            <View style={styles.transcriptContainer}>
              <Text style={styles.transcriptLabel}>You said:</Text>
              <Text style={styles.transcriptText}>"{voiceTranscript}"</Text>
            </View>
          )}

          {/* Show progress (command being sent) */}
          {voiceProgress && (
            <Text style={styles.progressText}>{voiceProgress}</Text>
          )}

          <View style={styles.voiceControls}>
            {/* Status text */}
            <Text style={styles.voiceStatusText}>
              {voiceStatus === 'idle' ? 'Tap to speak' :
               voiceStatus === 'listening' ? 'Listening...' :
               voiceStatus === 'processing' ? 'Processing...' :
               'Speaking...'}
            </Text>

            {/* Orb container with rings */}
            <View style={styles.orbContainer}>
              {/* Concentric rings - only show when listening */}
              {voiceStatus === 'listening' && (
                <>
                  <Animated.View style={[
                    styles.orbRing,
                    styles.orbRing3,
                    {
                      transform: [{ scale: ring3Anim }],
                      opacity: ring3Opacity,
                    }
                  ]} />
                  <Animated.View style={[
                    styles.orbRing,
                    styles.orbRing2,
                    {
                      transform: [{ scale: ring2Anim }],
                      opacity: ring2Opacity,
                    }
                  ]} />
                  <Animated.View style={[
                    styles.orbRing,
                    styles.orbRing1,
                    {
                      transform: [{ scale: ring1Anim }],
                      opacity: ring1Opacity,
                    }
                  ]} />
                </>
              )}

              {/* Audio level ring - reacts to voice */}
              {voiceStatus === 'listening' && (
                <View style={[
                  styles.audioLevelRing,
                  {
                    transform: [{ scale: 1 + audioLevel * 0.3 }],
                    opacity: 0.4 + audioLevel * 0.4,
                  }
                ]} />
              )}

              {/* Main mic button with animation */}
              <Animated.View style={[
                styles.micButtonWrapper,
                { transform: [{ scale: pulseAnim }] },
                voiceStatus === 'speaking' && {
                  shadowColor: '#22C55E',
                  shadowOpacity: 0.6,
                  shadowRadius: 20,
                }
              ]}>
                <TouchableOpacity
                  style={[
                    styles.micButton,
                    voiceStatus === 'listening' && styles.micButtonListening,
                    voiceStatus === 'speaking' && styles.micButtonSpeaking,
                    voiceStatus === 'processing' && styles.micButtonProcessing,
                  ]}
                  onPress={handleVoiceMicPress}
                  disabled={voiceStatus === 'processing'}
                  activeOpacity={0.8}
                >
                  {voiceStatus === 'listening' ? (
                    <MicOff size={28} color="#FFF" />
                  ) : voiceStatus === 'speaking' ? (
                    <Volume2 size={28} color="#FFF" />
                  ) : (
                    <Mic size={28} color="#FFF" />
                  )}
                </TouchableOpacity>
              </Animated.View>
            </View>

            {/* Control buttons row */}
            <View style={styles.voiceButtonsRow}>
              {/* Stop/Exit button */}
              <TouchableOpacity
                style={styles.stopButton}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  toggleVoiceMode();
                }}
              >
                <Square size={16} color="#FF6B6B" fill="#FF6B6B" />
                <Text style={styles.stopButtonText}>Exit</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* Terminal Tabs */}
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
                  Terminal {index + 1}
                </Text>
                <TouchableOpacity
                  style={styles.tabClose}
                  onPress={() => closeTerminal(index)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <X color={index === activeTerminalIndex ? '#FFF' : '#888'} size={12} />
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
        isConnected={!!activeTerminal}
        sandbox={activeTerminal?.sandbox ?? projectSandbox}
        onResize={handleResize}
      />
    </ViewShot>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1E1E1E',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: '#2D2D2D',
    borderBottomWidth: 1,
    borderBottomColor: '#3D3D3D',
  },
  headerLeft: {
    flex: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  projectName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFF',
  },
  projectPath: {
    fontSize: 11,
    color: '#888',
    marginTop: 2,
  },
  voiceToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#3D3D3D',
    borderRadius: 6,
    gap: 4,
  },
  voiceToggleActive: {
    backgroundColor: '#4CAF50',
  },
  voiceToggleText: {
    color: '#888',
    fontSize: 12,
    fontWeight: '500',
  },
  voiceToggleTextActive: {
    color: '#FFF',
  },
  newTerminalButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.brandTiger,
    borderRadius: 6,
    gap: 4,
  },
  newTerminalText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '600',
  },
  voiceOverlay: {
    backgroundColor: '#1A1A1A',
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A2A',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  voiceControls: {
    alignItems: 'center',
  },
  voiceStatusText: {
    color: '#888',
    fontSize: 13,
    fontWeight: '500',
    marginBottom: spacing.lg,
    letterSpacing: 0.5,
  },
  transcriptContainer: {
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.2)',
  },
  transcriptLabel: {
    color: '#22C55E',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  transcriptText: {
    color: '#FFF',
    fontSize: 15,
    lineHeight: 22,
  },
  progressText: {
    color: colors.brandTiger,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
    fontWeight: '500',
  },
  orbContainer: {
    width: 160,
    height: 160,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  orbRing: {
    position: 'absolute',
    borderRadius: 100,
    borderWidth: 2,
  },
  orbRing1: {
    width: 80,
    height: 80,
    borderColor: colors.brandTiger,
  },
  orbRing2: {
    width: 80,
    height: 80,
    borderColor: colors.brandTiger,
  },
  orbRing3: {
    width: 80,
    height: 80,
    borderColor: colors.brandTiger,
  },
  audioLevelRing: {
    position: 'absolute',
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: 'rgba(255, 107, 107, 0.3)',
  },
  micButtonWrapper: {
    shadowColor: colors.brandTiger,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 15,
    elevation: 8,
  },
  micButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.brandTiger,
    justifyContent: 'center',
    alignItems: 'center',
  },
  micButtonListening: {
    backgroundColor: '#FF6B6B',
  },
  micButtonSpeaking: {
    backgroundColor: '#22C55E',
  },
  micButtonProcessing: {
    backgroundColor: '#555',
  },
  voiceButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  stopButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: 'rgba(255,107,107,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,107,107,0.3)',
    gap: 6,
  },
  stopButtonText: {
    color: '#FF6B6B',
    fontSize: 13,
    fontWeight: '600',
  },
  tabsContainer: {
    backgroundColor: '#252525',
    borderBottomWidth: 1,
    borderBottomColor: '#3D3D3D',
  },
  tabsContent: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 4,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#1E1E1E',
    borderRadius: 6,
    gap: 8,
  },
  tabActive: {
    backgroundColor: colors.brandTiger,
  },
  tabText: {
    color: '#888',
    fontSize: 12,
    fontWeight: '500',
  },
  tabTextActive: {
    color: '#FFF',
  },
  tabClose: {
    padding: 2,
  },
});
