import React, { ReactNode } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import { colors, radius } from '../../theme';

interface DeviceFrameProps {
  children: ReactNode;
  scale?: number;
}

const { width: screenWidth } = Dimensions.get('window');

export function DeviceFrame({ children, scale = 1 }: DeviceFrameProps) {
  const frameWidth = Math.min(screenWidth - 48, 320) * scale;
  const frameHeight = frameWidth * 2.16; // iPhone aspect ratio

  return (
    <View style={[styles.frame, { width: frameWidth, height: frameHeight }]}>
      {/* Notch */}
      <View style={styles.notch}>
        <View style={styles.speaker} />
      </View>

      {/* Screen content */}
      <View style={styles.screen}>{children}</View>

      {/* Home indicator */}
      <View style={styles.homeIndicatorContainer}>
        <View style={styles.homeIndicator} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    backgroundColor: '#1C1C1C',
    borderRadius: radius.xl * 2,
    padding: 8,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  notch: {
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speaker: {
    width: 60,
    height: 6,
    backgroundColor: '#333',
    borderRadius: 3,
  },
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: radius.xl,
    overflow: 'hidden',
  },
  homeIndicatorContainer: {
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeIndicator: {
    width: 100,
    height: 4,
    backgroundColor: '#444',
    borderRadius: 2,
  },
});
