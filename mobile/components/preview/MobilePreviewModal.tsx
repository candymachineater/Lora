import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  Pressable,
  Alert,
  StyleSheet,
} from 'react-native';
import * as Linking from 'expo-linking';
import { X, AlertTriangle, ExternalLink } from 'lucide-react-native';
import { Button } from '../common';
import { colors, spacing, radius, typography, shadows } from '../../theme';

interface MobilePreviewModalProps {
  visible: boolean;
  onClose: () => void;
  previewUrl: string; // Local dev server URL from bridge
  projectName: string;
}

export function MobilePreviewModal({
  visible,
  onClose,
  previewUrl,
  projectName,
}: MobilePreviewModalProps) {
  const [opening, setOpening] = useState(false);

  const handleOpenInExpoGo = async () => {
    setOpening(true);

    try {
      // Convert HTTP URL to Expo deep link
      // http://192.168.1.100:19006 → exp://192.168.1.100:19006
      const expUrl = previewUrl.replace(/^https?:/, 'exp:');

      const canOpen = await Linking.canOpenURL(expUrl);
      if (!canOpen) {
        Alert.alert(
          'Expo Go Not Installed',
          'Install Expo Go from the App Store to test mobile projects.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Install',
              onPress: () =>
                Linking.openURL(
                  'https://apps.apple.com/app/expo-go/id982107779'
                ),
            },
          ]
        );
        setOpening(false);
        return;
      }

      // Open in Expo Go (this will close Lora)
      await Linking.openURL(expUrl);
      onClose();
    } catch (err) {
      Alert.alert('Error', 'Failed to open Expo Go');
      setOpening(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <Pressable
        style={styles.overlay}
        onPress={onClose}
      >
        <Pressable
          onPress={(e) => {
            // Prevent closing modal when clicking inside the card
            e.stopPropagation();
          }}
        >
          <View style={styles.card}>
            <View style={styles.header}>
              <Text style={styles.title}>Test in Expo Go</Text>
              <TouchableOpacity onPress={onClose}>
                <X color={colors.mutedForeground} size={24} />
              </TouchableOpacity>
            </View>

            <View style={styles.warningBox}>
              <AlertTriangle color={colors.warning} size={24} />
              <Text style={styles.warningText}>
                This will temporarily close Lora to open {projectName} in Expo
                Go
              </Text>
            </View>

            <Text style={styles.instructionText}>
              Your project will open in Expo Go for native mobile testing. When
              you're done, return to Lora to see captured console logs.
            </Text>

            <Button
              title="Open in Expo Go"
              onPress={handleOpenInExpoGo}
              loading={opening}
              icon={<ExternalLink color={colors.background} size={16} />}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    backgroundColor: colors.cardBackground,
    borderRadius: radius.xl,
    padding: spacing.lg,
    width: '90%',
    maxWidth: 400,
    ...shadows.lg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  title: {
    ...typography.h3,
    color: colors.foreground,
  },
  warningBox: {
    flexDirection: 'row',
    backgroundColor: `${colors.warning}20`,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  warningText: {
    ...typography.body,
    color: colors.foreground,
    flex: 1,
  },
  instructionText: {
    ...typography.body,
    color: colors.mutedForeground,
    marginBottom: spacing.lg,
    lineHeight: 22,
  },
});
