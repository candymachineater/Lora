import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView, Animated } from 'react-native';
import { useRouter } from 'expo-router';
import { Terminal as TerminalIcon, Plus, X, Mic, MicOff, Volume2, Square } from 'lucide-react-native';
import { Audio, AVPlaybackStatus } from 'expo-av';
import { useProjectStore, useSettingsStore } from '../../stores';
import { bridgeService } from '../../services/claude/api';
import { Terminal } from '../../components/terminal';
import { EmptyState, Button } from '../../components/common';
import { colors, spacing } from '../../theme';

interface TerminalSession {
  id: string;
  output: string;
  sandbox: boolean;
}

type VoiceStatus = 'off' | 'idle' | 'listening' | 'processing' | 'speaking';

// VAD Configuration
const VAD_CONFIG = {
  SILENCE_THRESHOLD: -25, // dB level below which is considered silence (lower = more sensitive)
  SILENCE_DURATION_MS: 2000, // 2 seconds of silence before auto-stop (increased for natural pauses)
  MIN_RECORDING_MS: 800, // Minimum recording duration
  METERING_INTERVAL_MS: 100, // How often to check audio levels
};

// Helper to strip ANSI codes for display
const stripAnsi = (str: string) => str.replace(/\x1b\[[0-9;]*m/g, '');

export default function TerminalScreen() {
  const router = useRouter();

  const { currentProjectId, projects, currentProject } = useProjectStore();
  const { bridgeServerUrl, isConnected, setIsConnected } = useSettingsStore();

  // Multi-terminal state
  const [terminals, setTerminals] = useState<TerminalSession[]>([]);
  const [activeTerminalIndex, setActiveTerminalIndex] = useState(0);
  const lastProjectIdRef = useRef<string | null>(null);
  const terminalCounter = useRef(0);

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
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const project = currentProject();
  const activeTerminal = terminals[activeTerminalIndex];
  const projectSandbox = project?.sandbox ?? true;

  // Pulse animation for listening
  useEffect(() => {
    if (voiceStatus === 'listening') {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.2, duration: 500, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
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

  // Voice Mode Functions - now integrated directly with terminal
  const toggleVoiceMode = async () => {
    if (!activeTerminal) {
      Alert.alert('No Terminal', 'Please wait for terminal to be ready');
      return;
    }

    if (voiceStatus === 'off') {
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
      setVoiceStatus('off');
      setVoiceTranscript('');
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

      // VAD monitoring
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

            if (level < VAD_CONFIG.SILENCE_THRESHOLD) {
              if (!silenceStartRef.current) {
                silenceStartRef.current = now;
              } else if (
                recordingDuration > VAD_CONFIG.MIN_RECORDING_MS &&
                now - silenceStartRef.current > VAD_CONFIG.SILENCE_DURATION_MS
              ) {
                console.log('[Voice-Terminal] VAD: Silence detected');
                stopListening();
              }
            } else {
              silenceStartRef.current = null;
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
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(',')[1];
          const mimeType = blob.type || 'audio/m4a';
          // Send to terminal (will be transcribed and typed into Claude Code)
          bridgeService.sendVoiceAudioToTerminal(activeTerminal.id, base64, mimeType);
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
          // Auto-listen after speaking
          startListening();
        }
      });
    } catch (err) {
      console.error('[Voice] Failed to play audio:', err);
      setVoiceStatus('idle');
    }
  };

  const handleVoiceMicPress = () => {
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
    <View style={styles.container}>
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

      {/* Voice Mode Overlay - Now integrated with terminal */}
      {voiceStatus !== 'off' && (
        <View style={styles.voiceOverlay}>
          {/* Audio Level Bar */}
          {voiceStatus === 'listening' && (
            <View style={styles.levelBar}>
              <View style={[styles.levelFill, { width: `${audioLevel * 100}%` }]} />
            </View>
          )}

          {/* Show transcription */}
          {voiceTranscript && (
            <Text style={styles.transcriptText}>You: "{voiceTranscript}"</Text>
          )}

          {/* Show progress (command being sent) */}
          {voiceProgress && (
            <Text style={styles.progressText}>{voiceProgress}</Text>
          )}

          <View style={styles.voiceControls}>
            <Text style={styles.voiceStatusText}>
              {voiceStatus === 'idle' ? 'Tap mic to speak to Claude Code' :
               voiceStatus === 'listening' ? 'Listening... (auto-stops on silence)' :
               voiceStatus === 'processing' ? 'Sending to Claude Code...' :
               'Claude speaking... (tap to interrupt)'}
            </Text>

            <View style={styles.voiceButtons}>
              {/* Stop All Button */}
              <TouchableOpacity
                style={styles.stopButton}
                onPress={toggleVoiceMode}
              >
                <Square size={18} color="#FF6B6B" fill="#FF6B6B" />
              </TouchableOpacity>

              {/* Mic Button */}
              <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                <TouchableOpacity
                  style={[
                    styles.micButton,
                    voiceStatus === 'listening' && styles.micButtonListening,
                    voiceStatus === 'speaking' && styles.micButtonSpeaking,
                    voiceStatus === 'processing' && styles.micButtonProcessing,
                  ]}
                  onPress={handleVoiceMicPress}
                  disabled={voiceStatus === 'processing'}
                >
                  {voiceStatus === 'listening' ? (
                    <MicOff size={24} color="#FFF" />
                  ) : voiceStatus === 'speaking' ? (
                    <Volume2 size={24} color="#FFF" />
                  ) : (
                    <Mic size={24} color="#FFF" />
                  )}
                </TouchableOpacity>
              </Animated.View>

              {/* Spacer */}
              <View style={styles.stopButton} />
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
    </View>
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
    backgroundColor: '#252525',
    borderBottomWidth: 1,
    borderBottomColor: '#3D3D3D',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  levelBar: {
    height: 4,
    backgroundColor: '#3D3D3D',
    borderRadius: 2,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  levelFill: {
    height: '100%',
    backgroundColor: '#4CAF50',
    borderRadius: 2,
  },
  voiceControls: {
    alignItems: 'center',
  },
  voiceStatusText: {
    color: '#AAA',
    fontSize: 12,
    marginBottom: spacing.sm,
  },
  transcriptText: {
    color: '#4CAF50',
    fontSize: 14,
    fontStyle: 'italic',
    textAlign: 'center',
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  progressText: {
    color: '#FF9800',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  voiceButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  stopButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,107,107,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  micButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.brandTiger,
    justifyContent: 'center',
    alignItems: 'center',
  },
  micButtonListening: {
    backgroundColor: '#FF6B6B',
  },
  micButtonSpeaking: {
    backgroundColor: '#4CAF50',
  },
  micButtonProcessing: {
    backgroundColor: '#666',
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
