import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Audio, AVPlaybackStatus } from 'expo-av';
import { Mic, MicOff, Volume2, AlertCircle, Square, FolderOpen } from 'lucide-react-native';
import { colors, spacing, typography } from '../../theme';
import { useProjectStore } from '../../stores/projectStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { bridgeService } from '../../services/claude/api';
import { useRouter } from 'expo-router';

interface Message {
  id: string;
  type: 'user' | 'assistant' | 'system' | 'progress';
  content: string;
  timestamp: Date;
}

type VoiceStatus = 'idle' | 'listening' | 'processing' | 'speaking' | 'error';

// VAD Configuration - tuned to reduce background noise sensitivity
const VAD_CONFIG = {
  SILENCE_THRESHOLD: -20, // dB level below which is considered silence (higher = less sensitive)
  SILENCE_DURATION_MS: 1000, // How long silence before auto-stop (1 second)
  MIN_RECORDING_MS: 500, // Minimum recording duration before VAD kicks in
  METERING_INTERVAL_MS: 100, // How often to check audio levels
};

export default function VoiceScreen() {
  const router = useRouter();
  const { currentProjectId, currentProject: getCurrentProject, projects } = useProjectStore();
  const { isConnected, bridgeServerUrl } = useSettingsStore();

  const currentProject = getCurrentProject();

  const [voiceSessionId, setVoiceSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [messages, setMessages] = useState<Message[]>([]);
  const [voiceAvailable, setVoiceAvailable] = useState<{ stt: boolean; tts: boolean; agent: boolean } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [continuousMode, setContinuousMode] = useState<boolean>(true);
  const [isCreatingSession, setIsCreatingSession] = useState<boolean>(false);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const meteringIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const silenceStartRef = useRef<number | null>(null);
  const recordingStartRef = useRef<number | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Pulse animation for recording
  useEffect(() => {
    if (status === 'listening') {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.15, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [status]);

  // Check voice service availability on mount
  useEffect(() => {
    if (isConnected) {
      checkVoiceStatus();
    }
  }, [isConnected]);

  // Create voice session when project is selected
  useEffect(() => {
    if (currentProject && isConnected && !voiceSessionId) {
      createSession();
    }
    return () => {
      if (voiceSessionId) {
        bridgeService.closeVoiceSession(voiceSessionId);
      }
      stopMetering();
    };
  }, [currentProjectId, isConnected]);

  const checkVoiceStatus = async () => {
    try {
      const status = await bridgeService.checkVoiceStatus();
      setVoiceAvailable(status);
      if (!status.stt || !status.tts) {
        setErrorMessage('Voice service requires OPENAI_API_KEY on the bridge server');
      }
      if (!status.agent) {
        setErrorMessage('Voice agent requires ANTHROPIC_API_KEY on the bridge server');
      }
    } catch (err) {
      console.error('Failed to check voice status:', err);
      setVoiceAvailable({ stt: false, tts: false, agent: false });
    }
  };

  const createSession = async () => {
    if (!currentProject || isCreatingSession) return;

    setIsCreatingSession(true);
    try {
      const sessionId = await bridgeService.createVoiceSession(currentProject.id, {
        onTranscription: (text) => {
          addMessage('user', text);
          setStatus('processing');
        },
        onProgress: (text) => {
          addMessage('progress', text);
        },
        onResponse: (text, audioData) => {
          setMessages(prev => prev.filter(m => m.type !== 'progress'));
          addMessage('assistant', text);
          if (!audioData) {
            // No audio coming, go to idle or start listening
            if (continuousMode) {
              startListening();
            } else {
              setStatus('idle');
            }
          }
        },
        onAudio: (audioData, mimeType) => {
          playAudio(audioData);
        },
        onClose: () => {
          setVoiceSessionId(null);
          addMessage('system', 'Voice session ended');
        },
        onError: (error) => {
          setErrorMessage(error);
          setStatus('error');
        }
      });

      setVoiceSessionId(sessionId);
      addMessage('system', 'Ready - tap mic to start talking');
    } catch (err) {
      console.error('Failed to create voice session:', err);
      setErrorMessage('Failed to create voice session');
    } finally {
      setIsCreatingSession(false);
    }
  };

  const addMessage = (type: Message['type'], content: string) => {
    setMessages(prev => [...prev, {
      id: `${Date.now()}-${Math.random()}`,
      type,
      content,
      timestamp: new Date()
    }]);
    setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const stopMetering = () => {
    if (meteringIntervalRef.current) {
      clearInterval(meteringIntervalRef.current);
      meteringIntervalRef.current = null;
    }
  };

  const startListening = async () => {
    if (!voiceSessionId) {
      if (isCreatingSession) {
        // Session is being created, wait for it
        console.log('[Voice] Session still being created, please wait');
        return;
      }
      // Try to create session if we have a project
      if (currentProject) {
        await createSession();
        return;
      }
      Alert.alert('No Project', 'Please select a project from the Projects tab first');
      return;
    }

    // If currently speaking, interrupt
    if (status === 'speaking' && soundRef.current) {
      console.log('[Voice] Interrupting playback to listen');
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

      // Create recording with metering enabled
      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync({
        ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
        isMeteringEnabled: true,
      });
      await recording.startAsync();

      recordingRef.current = recording;
      recordingStartRef.current = Date.now();
      silenceStartRef.current = null;
      setStatus('listening');
      setAudioLevel(0);

      // Start monitoring audio levels for VAD
      meteringIntervalRef.current = setInterval(async () => {
        if (!recordingRef.current) return;

        try {
          const status = await recordingRef.current.getStatusAsync();
          if (status.isRecording && status.metering !== undefined) {
            const level = status.metering; // dB value, typically -160 to 0
            const normalizedLevel = Math.max(0, Math.min(1, (level + 60) / 60)); // Normalize to 0-1
            setAudioLevel(normalizedLevel);

            // Voice Activity Detection
            const now = Date.now();
            const recordingDuration = now - (recordingStartRef.current || now);

            if (level < VAD_CONFIG.SILENCE_THRESHOLD) {
              // Silence detected
              if (!silenceStartRef.current) {
                silenceStartRef.current = now;
              } else if (
                recordingDuration > VAD_CONFIG.MIN_RECORDING_MS &&
                now - silenceStartRef.current > VAD_CONFIG.SILENCE_DURATION_MS
              ) {
                // Silence for long enough, auto-stop
                console.log('[Voice] VAD: Silence detected, stopping recording');
                stopListening();
              }
            } else {
              // Voice detected, reset silence timer
              silenceStartRef.current = null;
            }
          }
        } catch (err) {
          // Recording may have stopped
        }
      }, VAD_CONFIG.METERING_INTERVAL_MS);

    } catch (err) {
      console.error('Failed to start listening:', err);
      setErrorMessage('Failed to start recording');
      setStatus('error');
    }
  };

  const stopListening = async () => {
    stopMetering();
    setAudioLevel(0);

    if (!recordingRef.current || !voiceSessionId) {
      setStatus('idle');
      return;
    }

    try {
      setStatus('processing');

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
          bridgeService.sendVoiceAudio(voiceSessionId, base64, mimeType);
        };
        reader.readAsDataURL(blob);
      }
    } catch (err) {
      console.error('Failed to stop listening:', err);
      setErrorMessage('Failed to process recording');
      setStatus('error');
    }
  };

  const playAudio = async (base64Audio: string) => {
    try {
      setStatus('speaking');

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
          // Auto-listen after response in continuous mode
          if (continuousMode) {
            startListening();
          } else {
            setStatus('idle');
          }
        }
      });
    } catch (err) {
      console.error('Failed to play audio:', err);
      setStatus('idle');
    }
  };

  const handleMicPress = () => {
    if (status === 'listening') {
      stopListening();
    } else if (status === 'idle' || status === 'speaking') {
      // Can interrupt speaking to start listening
      startListening();
    }
  };

  const handleStopPress = () => {
    // Force stop everything
    stopMetering();
    if (recordingRef.current) {
      recordingRef.current.stopAndUnloadAsync();
      recordingRef.current = null;
    }
    if (soundRef.current) {
      soundRef.current.stopAsync();
      soundRef.current.unloadAsync();
      soundRef.current = null;
    }
    setStatus('idle');
  };

  // Render no project selected state
  if (!currentProject) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.noProjectContainer}>
          <FolderOpen size={64} color={colors.textMuted} />
          <Text style={styles.noProjectTitle}>No Project Selected</Text>
          <Text style={styles.noProjectSubtitle}>
            Select a project from the Projects tab to start a voice conversation
          </Text>
          <TouchableOpacity
            style={styles.goToProjectsButton}
            onPress={() => router.push('/(tabs)/')}
          >
            <Text style={styles.goToProjectsText}>Go to Projects</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Render not connected state
  if (!isConnected) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.noProjectContainer}>
          <AlertCircle size={64} color={colors.error} />
          <Text style={styles.noProjectTitle}>Not Connected</Text>
          <Text style={styles.noProjectSubtitle}>
            Connect to the bridge server in Settings to use voice chat
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Voice Chat</Text>
        <Text style={styles.headerSubtitle}>{currentProject.name}</Text>
        {voiceAvailable && (
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, voiceAvailable.stt ? styles.statusGreen : styles.statusRed]} />
            <Text style={styles.statusText}>STT</Text>
            <View style={[styles.statusDot, voiceAvailable.tts ? styles.statusGreen : styles.statusRed]} />
            <Text style={styles.statusText}>TTS</Text>
            <View style={[styles.statusDot, voiceAvailable.agent ? styles.statusGreen : styles.statusRed]} />
            <Text style={styles.statusText}>Agent</Text>
          </View>
        )}
        {/* Continuous mode toggle */}
        <TouchableOpacity
          style={styles.modeToggle}
          onPress={() => setContinuousMode(!continuousMode)}
        >
          <Text style={styles.modeToggleText}>
            {continuousMode ? '🔄 Continuous' : '👆 Manual'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Error Banner */}
      {errorMessage && (
        <View style={styles.errorBanner}>
          <AlertCircle size={16} color={colors.error} />
          <Text style={styles.errorText}>{errorMessage}</Text>
          <TouchableOpacity onPress={() => setErrorMessage(null)}>
            <Text style={styles.errorDismiss}>Dismiss</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Messages */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.messagesContainer}
        contentContainerStyle={styles.messagesContent}
      >
        {messages.length === 0 ? (
          <View style={styles.emptyMessages}>
            <Mic size={48} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>Ready to chat</Text>
            <Text style={styles.emptySubtitle}>
              Tap the mic to start talking.{'\n'}I'll auto-detect when you stop.
            </Text>
          </View>
        ) : (
          messages.map((message) => (
            <View
              key={message.id}
              style={[
                styles.messageBubble,
                message.type === 'user' && styles.userBubble,
                message.type === 'assistant' && styles.assistantBubble,
                message.type === 'system' && styles.systemBubble,
                message.type === 'progress' && styles.progressBubble,
              ]}
            >
              <Text
                style={[
                  styles.messageText,
                  message.type === 'user' && styles.userText,
                  message.type === 'system' && styles.systemText,
                  message.type === 'progress' && styles.progressText,
                ]}
              >
                {message.content}
              </Text>
            </View>
          ))
        )}
      </ScrollView>

      {/* Audio Level Indicator */}
      {status === 'listening' && (
        <View style={styles.levelContainer}>
          <View style={styles.levelBar}>
            <View style={[styles.levelFill, { width: `${audioLevel * 100}%` }]} />
          </View>
          <Text style={styles.levelText}>Listening... (auto-stops on silence)</Text>
        </View>
      )}

      {/* Status Indicator */}
      <View style={styles.statusIndicator}>
        {status === 'processing' && (
          <View style={styles.statusContent}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.statusLabel}>Thinking...</Text>
          </View>
        )}
        {status === 'speaking' && (
          <View style={styles.statusContent}>
            <Volume2 size={20} color={colors.primary} />
            <Text style={styles.statusLabel}>Speaking... (tap to interrupt)</Text>
          </View>
        )}
      </View>

      {/* Control Buttons */}
      <View style={styles.controlsContainer}>
        {/* Stop button (when active) */}
        {(status === 'listening' || status === 'speaking' || status === 'processing') && (
          <TouchableOpacity
            style={styles.stopButton}
            onPress={handleStopPress}
          >
            <Square size={20} color={colors.error} fill={colors.error} />
          </TouchableOpacity>
        )}

        {/* Main mic button */}
        <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
          <TouchableOpacity
            style={[
              styles.micButton,
              status === 'listening' && styles.micButtonListening,
              status === 'speaking' && styles.micButtonSpeaking,
              status === 'processing' && styles.micButtonProcessing,
            ]}
            onPress={handleMicPress}
            disabled={status === 'processing' || isCreatingSession}
            activeOpacity={0.7}
          >
            {status === 'listening' ? (
              <MicOff size={32} color={colors.background} />
            ) : status === 'speaking' ? (
              <Mic size={32} color={colors.background} />
            ) : (
              <Mic size={32} color={status === 'idle' ? colors.background : colors.textMuted} />
            )}
          </TouchableOpacity>
        </Animated.View>

        {/* Spacer for symmetry */}
        <View style={styles.stopButtonPlaceholder} />
      </View>

      <Text style={styles.micHint}>
        {isCreatingSession ? 'Connecting...' :
         status === 'listening' ? 'Tap to send now' :
         status === 'speaking' ? 'Tap to interrupt' :
         status === 'processing' ? 'Processing...' :
         !voiceSessionId ? 'Tap to connect' :
         'Tap to speak'}
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    alignItems: 'center',
  },
  headerTitle: {
    ...typography.h2,
    color: colors.foreground,
  },
  headerSubtitle: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
    gap: spacing.xs,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusGreen: {
    backgroundColor: colors.success,
  },
  statusRed: {
    backgroundColor: colors.error,
  },
  statusText: {
    ...typography.caption,
    color: colors.textMuted,
    marginRight: spacing.sm,
  },
  modeToggle: {
    marginTop: spacing.sm,
    paddingVertical: 4,
    paddingHorizontal: 12,
    backgroundColor: colors.card,
    borderRadius: 12,
  },
  modeToggleText: {
    ...typography.caption,
    color: colors.foreground,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.errorLight,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  errorText: {
    ...typography.caption,
    color: colors.error,
    flex: 1,
  },
  errorDismiss: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '600',
  },
  messagesContainer: {
    flex: 1,
  },
  messagesContent: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  emptyMessages: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 100,
  },
  emptyTitle: {
    ...typography.h3,
    color: colors.textMuted,
    marginTop: spacing.md,
  },
  emptySubtitle: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xs,
    paddingHorizontal: spacing.xl,
  },
  messageBubble: {
    padding: spacing.md,
    borderRadius: 16,
    maxWidth: '85%',
  },
  userBubble: {
    backgroundColor: colors.primary,
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    backgroundColor: colors.card,
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
  },
  systemBubble: {
    backgroundColor: colors.border,
    alignSelf: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  progressBubble: {
    backgroundColor: colors.primaryLight,
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
    opacity: 0.7,
  },
  messageText: {
    ...typography.body,
    color: colors.foreground,
  },
  userText: {
    color: colors.background,
  },
  systemText: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
  },
  progressText: {
    ...typography.caption,
    color: colors.primary,
    fontStyle: 'italic',
  },
  levelContainer: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  levelBar: {
    width: '100%',
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    overflow: 'hidden',
  },
  levelFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
  levelText: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 4,
  },
  statusIndicator: {
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  statusLabel: {
    ...typography.caption,
    color: colors.textMuted,
  },
  controlsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.md,
    gap: spacing.lg,
  },
  stopButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.errorLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stopButtonPlaceholder: {
    width: 44,
    height: 44,
  },
  micButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  micButtonListening: {
    backgroundColor: colors.error,
  },
  micButtonSpeaking: {
    backgroundColor: colors.success,
  },
  micButtonProcessing: {
    backgroundColor: colors.border,
  },
  micHint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    paddingBottom: spacing.lg,
  },
  noProjectContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  noProjectTitle: {
    ...typography.h2,
    color: colors.foreground,
    marginTop: spacing.lg,
  },
  noProjectSubtitle: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  goToProjectsButton: {
    marginTop: spacing.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.primary,
    borderRadius: 8,
  },
  goToProjectsText: {
    ...typography.body,
    color: colors.background,
    fontWeight: '600',
  },
});
