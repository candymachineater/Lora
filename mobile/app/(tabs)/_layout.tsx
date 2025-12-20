import { Tabs } from 'expo-router';
import { FolderOpen, Terminal, Code2, Play } from 'lucide-react-native';
import { colors } from '../../theme';

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
          paddingTop: 8,
          paddingBottom: 8,
          height: 80,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '600' as const,
        },
        headerStyle: {
          backgroundColor: colors.background,
        },
        headerTintColor: colors.foreground,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Projects',
          tabBarIcon: ({ color, size }) => (
            <FolderOpen color={color} size={size} />
          ),
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
