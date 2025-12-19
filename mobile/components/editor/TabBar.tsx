import React from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { X, FileCode } from 'lucide-react-native';
import { colors, spacing, radius, typography } from '../../theme';

interface Tab {
  path: string;
  modified?: boolean;
}

interface TabBarProps {
  tabs: Tab[];
  activeTab: string | null;
  onSelectTab: (path: string) => void;
  onCloseTab?: (path: string) => void;
}

export function TabBar({ tabs, activeTab, onSelectTab, onCloseTab }: TabBarProps) {
  if (tabs.length === 0) return null;

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {tabs.map((tab) => (
          <TouchableOpacity
            key={tab.path}
            style={[styles.tab, activeTab === tab.path && styles.tabActive]}
            onPress={() => onSelectTab(tab.path)}
          >
            <FileCode
              color={activeTab === tab.path ? colors.foreground : colors.mutedForeground}
              size={14}
            />
            <Text
              style={[
                styles.tabText,
                activeTab === tab.path && styles.tabTextActive,
              ]}
              numberOfLines={1}
            >
              {tab.path}
            </Text>
            {tab.modified && <View style={styles.modifiedDot} />}
            {onCloseTab && (
              <TouchableOpacity
                onPress={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.path);
                }}
                style={styles.closeButton}
              >
                <X color={colors.mutedForeground} size={12} />
              </TouchableOpacity>
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.cardBackground,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  scrollContent: {
    flexDirection: 'row',
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  tabActive: {
    backgroundColor: colors.background,
    borderBottomWidth: 2,
    borderBottomColor: colors.brandTiger,
  },
  tabText: {
    ...typography.caption,
    color: colors.mutedForeground,
    maxWidth: 120,
  },
  tabTextActive: {
    color: colors.foreground,
    fontWeight: '500',
  },
  modifiedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.warning,
    marginLeft: spacing.xs,
  },
  closeButton: {
    marginLeft: spacing.xs,
    padding: 2,
  },
});
