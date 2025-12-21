import React, { useRef, useEffect } from 'react';
import { Tabs, useRouter } from 'expo-router';
import { Terminal, Code2, Play, Mic, FolderOpen, Settings, Plus } from 'lucide-react-native';
import { Platform, View, TouchableOpacity, StyleSheet, Animated, Easing, Text } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, shadows, spacing } from '../../theme';
import { ProjectSelector } from '../../components/common';
import { useVoiceStore, useProjectStore, useSettingsStore } from '../../stores';
import type { TabName } from '../../stores/voiceStore';

// Simplified voice state colors - easy to understand
const VOICE_COLORS = {
  off: colors.mutedForeground,      // Gray - tap to start
  sleeping: colors.brandTiger,      // Orange - voice mode on, waiting for you
  listening: colors.success,        // Green - listening to you now
  processing: colors.success,       // Green - thinking (same as listening for simplicity)
  speaking: colors.brandSapphire,   // Blue - Lora is talking
  working: colors.brandTiger,       // Orange - agent is gathering info (screenshot, etc)
};

// Voice button component for center tab
function VoiceTabButton() {
  const router = useRouter();
  const { voiceStatus, audioLevel, voiceProgress, toggleVoiceMode, handleVoiceMicPress, setPendingVoiceStart } = useVoiceStore();

  // Animation values
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const ring1Anim = useRef(new Animated.Value(1)).current;
  const ring2Anim = useRef(new Animated.Value(1)).current;
  const ring3Anim = useRef(new Animated.Value(1)).current;
  const ring1Opacity = useRef(new Animated.Value(0.3)).current;
  const ring2Opacity = useRef(new Animated.Value(0.2)).current;
  const ring3Opacity = useRef(new Animated.Value(0.1)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;

  // Get current state color
  const stateColor = VOICE_COLORS[voiceStatus] || VOICE_COLORS.off;

  // Enhanced orb animations for voice mode
  useEffect(() => {
    if (voiceStatus === 'listening') {
      // Main pulse - energetic for listening
      const mainPulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.12, duration: 600, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
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

      // Expanding rings for speaking (similar to listening but slower, green)
      const ring1Pulse = Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(ring1Anim, { toValue: 1.6, duration: 2000, useNativeDriver: true, easing: Easing.out(Easing.ease) }),
            Animated.timing(ring1Opacity, { toValue: 0, duration: 2000, useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.timing(ring1Anim, { toValue: 1, duration: 0, useNativeDriver: true }),
            Animated.timing(ring1Opacity, { toValue: 0.25, duration: 0, useNativeDriver: true }),
          ]),
        ])
      );

      const ring2Pulse = Animated.loop(
        Animated.sequence([
          Animated.delay(700),
          Animated.parallel([
            Animated.timing(ring2Anim, { toValue: 2.0, duration: 2000, useNativeDriver: true, easing: Easing.out(Easing.ease) }),
            Animated.timing(ring2Opacity, { toValue: 0, duration: 2000, useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.timing(ring2Anim, { toValue: 1, duration: 0, useNativeDriver: true }),
            Animated.timing(ring2Opacity, { toValue: 0.15, duration: 0, useNativeDriver: true }),
          ]),
        ])
      );

      breathe.start();
      ring1Pulse.start();
      ring2Pulse.start();

      return () => {
        breathe.stop();
        ring1Pulse.stop();
        ring2Pulse.stop();
      };
    } else if (voiceStatus === 'sleeping') {
      // Very subtle slow pulse for sleeping mode - indicates listening for wake word
      const sleepPulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.03, duration: 2000, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 2000, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        ])
      );
      sleepPulse.start();
      return () => {
        sleepPulse.stop();
      };
    } else if (voiceStatus === 'processing') {
      // Pulsing animation for processing/thinking - purple twilight
      const processPulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.06, duration: 600, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        ])
      );

      // Rotating ring effect for processing
      const ring1Pulse = Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(ring1Anim, { toValue: 1.5, duration: 1000, useNativeDriver: true, easing: Easing.out(Easing.ease) }),
            Animated.timing(ring1Opacity, { toValue: 0, duration: 1000, useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.timing(ring1Anim, { toValue: 1, duration: 0, useNativeDriver: true }),
            Animated.timing(ring1Opacity, { toValue: 0.4, duration: 0, useNativeDriver: true }),
          ]),
        ])
      );

      processPulse.start();
      ring1Pulse.start();

      return () => {
        processPulse.stop();
        ring1Pulse.stop();
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

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Read current status directly from store to avoid stale closure
    const currentStatus = useVoiceStore.getState().voiceStatus;
    const micPressHandler = useVoiceStore.getState().handleVoiceMicPress;

    console.log('[VoiceButton] Pressed, status:', currentStatus, 'handler:', !!micPressHandler);

    if (currentStatus === 'off') {
      // TAP when OFF → Start voice mode
      console.log('[VoiceButton] Starting voice mode...');
      setPendingVoiceStart(true);
      router.push('/(tabs)/chat');
    } else {
      // TAP when any active state → Interrupt and turn off voice mode
      console.log('[VoiceButton] Interrupting voice mode');

      if (micPressHandler) {
        // Use the registered handler for proper cleanup
        micPressHandler();
      } else {
        // Fallback: at least set status to off if handler not available
        console.log('[VoiceButton] No handler available, forcing status to off');
        useVoiceStore.getState().setVoiceStatus('off');
        useVoiceStore.getState().setVoiceTranscript('');
        useVoiceStore.getState().setVoiceProgress('');
      }
    }
  };

  const handleLongPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    // Read current status directly from store to avoid stale closure
    const currentStatus = useVoiceStore.getState().voiceStatus;
    const micPressHandler = useVoiceStore.getState().handleVoiceMicPress;

    console.log('[VoiceButton] Long press, status:', currentStatus);

    if (currentStatus !== 'off') {
      console.log('[VoiceButton] Long press - turning off voice mode');
      if (micPressHandler) {
        micPressHandler();
      } else {
        // Fallback
        useVoiceStore.getState().setVoiceStatus('off');
        useVoiceStore.getState().setVoiceTranscript('');
        useVoiceStore.getState().setVoiceProgress('');
      }
    }
  };

  const isActive = voiceStatus !== 'off';
  const buttonSize = 90;
  const protrudeAmount = 28;

  // Always show Mic icon - color indicates state
  const getIcon = () => {
    return <Mic size={38} color="#FFF" />;
  };

  // Status text below button
  const getStatusText = () => {
    // If there's a custom progress message (like "Analyzing screen..."), use it
    if (voiceProgress) {
      return voiceProgress;
    }
    switch (voiceStatus) {
      case 'off': return 'Tap to start';
      case 'sleeping': return 'Ready';
      case 'listening': return 'Listening...';
      case 'processing': return 'Thinking...';
      case 'speaking': return 'Speaking...';
      case 'working': return 'Working...';
      default: return '';
    }
  };

  // Should show rings for these states
  const showRings = voiceStatus === 'listening' || voiceStatus === 'speaking' || voiceStatus === 'processing' || voiceStatus === 'working';

  return (
    <View style={voiceButtonStyles.outerContainer}>
      <View style={[voiceButtonStyles.container, { marginTop: -protrudeAmount }]}>
      {/* Concentric rings - show for listening, speaking, processing */}
      {showRings && (
        <>
          <Animated.View pointerEvents="none" style={[
            voiceButtonStyles.ring,
            {
              width: buttonSize,
              height: buttonSize,
              borderRadius: buttonSize / 2,
              borderColor: stateColor,
              transform: [{ scale: ring3Anim }],
              opacity: ring3Opacity,
            }
          ]} />
          <Animated.View pointerEvents="none" style={[
            voiceButtonStyles.ring,
            {
              width: buttonSize,
              height: buttonSize,
              borderRadius: buttonSize / 2,
              borderColor: stateColor,
              transform: [{ scale: ring2Anim }],
              opacity: ring2Opacity,
            }
          ]} />
          <Animated.View pointerEvents="none" style={[
            voiceButtonStyles.ring,
            {
              width: buttonSize,
              height: buttonSize,
              borderRadius: buttonSize / 2,
              borderColor: stateColor,
              transform: [{ scale: ring1Anim }],
              opacity: ring1Opacity,
            }
          ]} />
        </>
      )}

      {/* Audio level ring - reacts to voice (only when listening) */}
      {voiceStatus === 'listening' && (
        <View pointerEvents="none" style={[
          voiceButtonStyles.audioLevelRing,
          {
            width: buttonSize + 10,
            height: buttonSize + 10,
            borderRadius: (buttonSize + 10) / 2,
            backgroundColor: `${stateColor}4D`, // 30% opacity
            transform: [{ scale: 1 + audioLevel * 0.3 }],
            opacity: 0.4 + audioLevel * 0.4,
          }
        ]} />
      )}

      {/* Main button */}
      <Animated.View style={[
        voiceButtonStyles.buttonWrapper,
        {
          transform: [{ scale: pulseAnim }],
          shadowColor: stateColor,
        },
        isActive && voiceButtonStyles.buttonWrapperActive,
      ]}>
        <TouchableOpacity
          style={[
            voiceButtonStyles.button,
            {
              width: buttonSize,
              height: buttonSize,
              borderRadius: buttonSize / 2,
              backgroundColor: stateColor,
            }
          ]}
          onPress={handlePress}
          onLongPress={handleLongPress}
          activeOpacity={0.8}
        >
          {getIcon()}
        </TouchableOpacity>
      </Animated.View>
      </View>
      {/* Status text below button */}
      <Text style={[voiceButtonStyles.statusText, { color: stateColor }]}>
        {getStatusText()}
      </Text>
    </View>
  );
}

const voiceButtonStyles = StyleSheet.create({
  outerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 110,
    height: 110,
    overflow: 'visible', // Allow rings to show outside container
  },
  ring: {
    position: 'absolute',
    borderWidth: 2,
  },
  audioLevelRing: {
    position: 'absolute',
    // backgroundColor set dynamically based on stateColor
  },
  buttonWrapper: {
    // shadowColor set dynamically based on stateColor
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  buttonWrapperActive: {
    shadowOpacity: 0.5,
    shadowRadius: 14,
  },
  button: {
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: colors.background,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
    textAlign: 'center',
    marginBottom: 4, // Align with Terminal/Preview labels
  },
});

// Header title with connection indicator
function HeaderTitle() {
  const { isConnected } = useSettingsStore();

  return (
    <View style={headerStyles.headerTitleContainer}>
      <View
        style={[
          headerStyles.connectionDot,
          { backgroundColor: isConnected ? '#22C55E' : '#D10808' }
        ]}
      />
      <ProjectSelector />
    </View>
  );
}

const headerStyles = StyleSheet.create({
  headerTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  connectionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  headerButton: {
    padding: spacing.xs,
    borderRadius: 8,
  },
});

// Map route names to TabName
const routeToTab: Record<string, TabName> = {
  'chat': 'terminal',
  'preview': 'preview',
  'editor': 'editor',
  'index': 'projects',
  'voice': 'voice',
};

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { currentProjectId } = useProjectStore();
  const { setCurrentTab } = useVoiceStore();

  // Common header style
  const commonHeaderStyle = {
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 2,
    height: 56 + insets.top,
  };

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.mutedForeground,
        tabBarInactiveTintColor: colors.tabInactive,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          paddingTop: 8,
          paddingBottom: Math.max(insets.bottom, 8) + 4,
          height: 60 + Math.max(insets.bottom, 8),
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.05,
          shadowRadius: 8,
          elevation: 4,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '500' as const,
          marginTop: 2,
        },
        tabBarIconStyle: {
          marginTop: 2,
        },
        tabBarItemStyle: {
          paddingVertical: 4,
        },
        headerStyle: commonHeaderStyle,
        headerStatusBarHeight: insets.top,
        headerTintColor: colors.foreground,
        headerTitle: () => <HeaderTitle />,
        headerTitleAlign: 'center',
        headerTitleContainerStyle: {
          justifyContent: 'center',
          alignItems: 'center',
          paddingBottom: spacing.sm,
        },
        headerLeftContainerStyle: {
          paddingLeft: spacing.md,
          paddingBottom: spacing.sm,
        },
        headerRightContainerStyle: {
          paddingRight: spacing.md,
          paddingBottom: spacing.sm,
        },
      }}
      screenListeners={{
        tabPress: () => {
          if (Platform.OS === 'ios') {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }
        },
        state: (e) => {
          // Track current tab when navigation state changes
          const state = e.data.state;
          if (state?.routes && state.index !== undefined) {
            const currentRoute = state.routes[state.index];
            const tabName = routeToTab[currentRoute.name];
            if (tabName) {
              setCurrentTab(tabName);
              console.log('[TabLayout] Current tab:', tabName);
            }
          }
        },
      }}
    >
      {/* Terminal - Left tab */}
      <Tabs.Screen
        name="chat"
        options={{
          title: 'Terminal',
          tabBarIcon: ({ color, size }) => (
            <Terminal color={color} size={size} />
          ),
          headerLeft: () => (
            <TouchableOpacity
              style={headerStyles.headerButton}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push('/');
              }}
            >
              <FolderOpen color={colors.foreground} size={22} />
            </TouchableOpacity>
          ),
          headerRight: () => (
            <TouchableOpacity
              style={headerStyles.headerButton}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                if (currentProjectId) {
                  router.push('/(tabs)/editor');
                }
              }}
            >
              <Code2 color={currentProjectId ? colors.foreground : colors.mutedForeground} size={22} />
            </TouchableOpacity>
          ),
        }}
      />
      {/* Voice button - CENTER - the main interaction point */}
      <Tabs.Screen
        name="voice"
        options={{
          title: '',
          tabBarButton: () => <VoiceTabButton />,
        }}
      />
      {/* Preview - Right tab */}
      <Tabs.Screen
        name="preview"
        options={{
          title: 'Preview',
          tabBarIcon: ({ color, size }) => (
            <Play color={color} size={size} />
          ),
          headerLeft: () => (
            <TouchableOpacity
              style={headerStyles.headerButton}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push('/');
              }}
            >
              <FolderOpen color={colors.foreground} size={22} />
            </TouchableOpacity>
          ),
          headerRight: () => (
            <TouchableOpacity
              style={headerStyles.headerButton}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push('/settings');
              }}
            >
              <Settings color={colors.foreground} size={22} />
            </TouchableOpacity>
          ),
        }}
      />
      {/* Hidden screens - Projects and Editor (accessible via header icons) */}
      <Tabs.Screen
        name="index"
        options={{
          href: null,
          headerLeft: () => {
            const { setShowNewProjectModal } = useProjectStore();
            return (
              <TouchableOpacity
                style={headerStyles.headerButton}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setShowNewProjectModal(true);
                }}
              >
                <Plus color={colors.foreground} size={22} />
              </TouchableOpacity>
            );
          },
          headerRight: () => (
            <TouchableOpacity
              style={headerStyles.headerButton}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push('/settings');
              }}
            >
              <Settings color={colors.foreground} size={22} />
            </TouchableOpacity>
          ),
        }}
      />
      <Tabs.Screen
        name="editor"
        options={{
          href: null,
          headerShown: false,
        }}
      />
    </Tabs>
  );
}
