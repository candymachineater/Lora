import { Tabs } from 'expo-router';
import { Terminal, Code2, Play } from 'lucide-react-native';
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors, shadows } from '../../theme';
import { ProjectSelector } from '../../components/common';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.tabActive,
        tabBarInactiveTintColor: colors.tabInactive,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          paddingTop: 6,
          paddingBottom: 8,
          height: 70,
          // Add subtle shadow for depth
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
        headerStyle: {
          backgroundColor: colors.background,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          // Subtle header shadow
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.03,
          shadowRadius: 4,
          elevation: 2,
        },
        headerTintColor: colors.foreground,
        headerTitle: () => <ProjectSelector />,
        headerTitleAlign: 'center',
      }}
      screenListeners={{
        tabPress: () => {
          // Haptic feedback on tab press (iOS)
          if (Platform.OS === 'ios') {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }
        },
      }}
    >
      {/* Projects tab hidden - now accessible via dropdown in header */}
      <Tabs.Screen
        name="index"
        options={{
          href: null, // Hide from tab bar
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: 'Terminal',
          tabBarIcon: ({ color, size }) => (
            <Terminal color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="editor"
        options={{
          title: 'Editor',
          tabBarIcon: ({ color, size }) => (
            <Code2 color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="preview"
        options={{
          title: 'Preview',
          tabBarIcon: ({ color, size }) => (
            <Play color={color} size={size} />
          ),
        }}
      />
      {/* Voice tab hidden - voice mode is now integrated into Terminal */}
      <Tabs.Screen
        name="voice"
        options={{
          href: null, // Hide from tab bar
        }}
      />
    </Tabs>
  );
}
