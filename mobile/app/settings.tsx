import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  Switch,
  TouchableOpacity,
  Alert,
  Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  Wifi,
  WifiOff,
  Server,
  RefreshCw,
  ExternalLink,
  Trash2,
  Info,
  Mic,
} from 'lucide-react-native';
import { useSettingsStore, useChatStore, useProjectStore, useVoiceStore } from '../stores';
import { claudeService } from '../services/claude';
import { Button } from '../components/common';
import { colors, spacing, radius, typography } from '../theme';
import { VOICE_AGENT_MODELS, VoiceAgentModelId } from '../constants';

export default function SettingsScreen() {
  const router = useRouter();
  const {
    bridgeServerUrl,
    isConnected,
    autoPreview,
    voiceAgentModel,
    setBridgeServerUrl,
    setIsConnected,
    setAutoPreview,
    setVoiceAgentModel,
  } = useSettingsStore();
  const { clearChat } = useChatStore();
  const { projects } = useProjectStore();
  const { voiceStatus } = useVoiceStore();

  const isVoiceActive = voiceStatus !== 'off';

  const [serverUrl, setServerUrl] = useState(bridgeServerUrl);
  const [connecting, setConnecting] = useState(false);

  const handleConnect = async () => {
    if (!serverUrl.trim()) {
      Alert.alert('Error', 'Please enter a bridge server URL');
      return;
    }

    setConnecting(true);
    try {
      await claudeService.connect(serverUrl.trim());
      setBridgeServerUrl(serverUrl.trim());
      setIsConnected(true);
      Alert.alert('Success', 'Connected to bridge server');
    } catch (error) {
      setIsConnected(false);
      Alert.alert(
        'Connection Failed',
        'Could not connect to the bridge server. Make sure it\'s running and the URL is correct.'
      );
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = () => {
    claudeService.disconnect();
    setIsConnected(false);
  };

  const handleClearChat = () => {
    Alert.alert(
      'Clear Chat History',
      'Are you sure you want to clear all chat messages?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => clearChat(),
        },
      ]
    );
  };

  const handleOpenDocs = () => {
    Linking.openURL('https://github.com/iahme/Lora');
  };

  return (
    <ScrollView style={styles.container}>
      {/* Connection Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Bridge Server</Text>
        <Text style={styles.sectionDescription}>
          Connect to your Windows PC running the Lora bridge server
        </Text>

        <View style={styles.connectionStatus}>
          {isConnected ? (
            <>
              <Wifi color={colors.success} size={20} />
              <Text style={[styles.statusText, { color: colors.success }]}>
                Connected
              </Text>
            </>
          ) : (
            <>
              <WifiOff color={colors.destructive} size={20} />
              <Text style={[styles.statusText, { color: colors.destructive }]}>
                Not Connected
              </Text>
            </>
          )}
        </View>

        <View style={styles.inputContainer}>
          <Server color={colors.mutedForeground} size={20} />
          <TextInput
            style={styles.input}
            value={serverUrl}
            onChangeText={setServerUrl}
            placeholder="ws://192.168.1.100:8765"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
        </View>

        <View style={styles.buttonRow}>
          {isConnected ? (
            <Button
              title="Disconnect"
              variant="secondary"
              onPress={handleDisconnect}
            />
          ) : (
            <Button
              title={connecting ? 'Connecting...' : 'Connect'}
              onPress={handleConnect}
              loading={connecting}
              icon={<RefreshCw color={colors.background} size={16} />}
            />
          )}
        </View>

        <Text style={styles.helpText}>
          Run the bridge server on your Windows PC:{'\n'}
          <Text style={styles.code}>cd bridge-server && npm start</Text>
        </Text>
      </View>

      {/* Preferences Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Preferences</Text>

        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Auto Preview</Text>
            <Text style={styles.settingDescription}>
              Automatically generate preview when code changes
            </Text>
          </View>
          <Switch
            value={autoPreview}
            onValueChange={setAutoPreview}
            trackColor={{ false: colors.border, true: colors.brandTiger }}
            thumbColor={colors.background}
          />
        </View>

        {/* Voice Agent Model Picker */}
        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <View style={styles.settingLabelRow}>
              <Mic color={colors.mutedForeground} size={16} />
              <Text style={styles.settingLabel}>Voice Agent Model</Text>
            </View>
            <Text style={styles.settingDescription}>
              {isVoiceActive
                ? 'Disable voice mode to change model'
                : 'Choose the AI model for voice commands'}
            </Text>
          </View>
        </View>
        <View style={[styles.modelPicker, isVoiceActive && styles.modelPickerDisabled]}>
          {VOICE_AGENT_MODELS.map((model) => (
            <TouchableOpacity
              key={model.id}
              style={[
                styles.modelOption,
                voiceAgentModel === model.id && styles.modelOptionSelected,
                isVoiceActive && styles.modelOptionDisabled,
              ]}
              onPress={() => !isVoiceActive && setVoiceAgentModel(model.id as VoiceAgentModelId)}
              disabled={isVoiceActive}
            >
              <Text style={[
                styles.modelOptionLabel,
                voiceAgentModel === model.id && styles.modelOptionLabelSelected,
                isVoiceActive && styles.modelOptionLabelDisabled,
              ]}>
                {model.label}
              </Text>
              <Text style={[
                styles.modelOptionDescription,
                voiceAgentModel === model.id && styles.modelOptionDescriptionSelected,
                isVoiceActive && styles.modelOptionDescriptionDisabled,
              ]}>
                {model.description}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Data Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Data</Text>

        <View style={styles.statRow}>
          <Text style={styles.statLabel}>Projects</Text>
          <Text style={styles.statValue}>{projects.length}</Text>
        </View>

        <TouchableOpacity style={styles.dangerButton} onPress={handleClearChat}>
          <Trash2 color={colors.destructive} size={18} />
          <Text style={styles.dangerButtonText}>Clear Chat History</Text>
        </TouchableOpacity>
      </View>

      {/* About Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About</Text>

        <View style={styles.aboutRow}>
          <Text style={styles.aboutLabel}>Version</Text>
          <Text style={styles.aboutValue}>1.0.0</Text>
        </View>

        <TouchableOpacity style={styles.linkRow} onPress={handleOpenDocs}>
          <Info color={colors.brandSapphire} size={18} />
          <Text style={styles.linkText}>Documentation & Help</Text>
          <ExternalLink color={colors.mutedForeground} size={14} />
        </TouchableOpacity>
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Lora - Personal AI Mobile App Builder
        </Text>
        <Text style={styles.footerSubtext}>
          Powered by Claude AI
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  section: {
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.foreground,
    marginBottom: spacing.xs,
  },
  sectionDescription: {
    ...typography.caption,
    color: colors.mutedForeground,
    marginBottom: spacing.md,
  },
  connectionStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  statusText: {
    ...typography.button,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardBackground,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  input: {
    flex: 1,
    ...typography.body,
    color: colors.foreground,
    paddingVertical: spacing.md,
    marginLeft: spacing.sm,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  helpText: {
    ...typography.caption,
    color: colors.mutedForeground,
    lineHeight: 20,
  },
  code: {
    fontFamily: 'monospace',
    color: colors.foreground,
    backgroundColor: colors.cardBackground,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  settingInfo: {
    flex: 1,
    marginRight: spacing.md,
  },
  settingLabel: {
    ...typography.body,
    color: colors.foreground,
  },
  settingLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  settingDescription: {
    ...typography.caption,
    color: colors.mutedForeground,
  },
  modelPicker: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  modelPickerDisabled: {
    opacity: 0.5,
  },
  modelOption: {
    flex: 1,
    padding: spacing.md,
    backgroundColor: colors.cardBackground,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
  },
  modelOptionSelected: {
    borderColor: colors.brandTiger,
    backgroundColor: colors.brandTiger + '10',
  },
  modelOptionDisabled: {
    borderColor: colors.border,
  },
  modelOptionLabel: {
    ...typography.button,
    color: colors.foreground,
    marginBottom: spacing.xs,
  },
  modelOptionLabelSelected: {
    color: colors.brandTiger,
  },
  modelOptionLabelDisabled: {
    color: colors.mutedForeground,
  },
  modelOptionDescription: {
    ...typography.caption,
    color: colors.mutedForeground,
    textAlign: 'center',
  },
  modelOptionDescriptionSelected: {
    color: colors.brandTiger,
  },
  modelOptionDescriptionDisabled: {
    color: colors.mutedForeground,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  statLabel: {
    ...typography.body,
    color: colors.foreground,
  },
  statValue: {
    ...typography.body,
    color: colors.mutedForeground,
  },
  dangerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  dangerButtonText: {
    ...typography.body,
    color: colors.destructive,
  },
  aboutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  aboutLabel: {
    ...typography.body,
    color: colors.foreground,
  },
  aboutValue: {
    ...typography.body,
    color: colors.mutedForeground,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  linkText: {
    ...typography.body,
    color: colors.brandSapphire,
    flex: 1,
  },
  footer: {
    alignItems: 'center',
    paddingVertical: spacing['2xl'],
  },
  footerText: {
    ...typography.caption,
    color: colors.mutedForeground,
  },
  footerSubtext: {
    ...typography.caption,
    color: colors.mutedForeground,
    fontSize: 11,
    marginTop: spacing.xs,
  },
});
