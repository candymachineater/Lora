// Lovable-inspired light theme color system
export const colors = {
  // Primary Colors
  background: '#FFFFFF',
  foreground: '#1C1C1C',
  cardBackground: '#F5F5F5',
  cardForeground: '#1C1C1C',
  card: '#F5F5F5',
  primary: '#C53307',
  primaryLight: 'rgba(197, 51, 7, 0.1)',

  // Secondary Colors
  secondary: '#F0F0F0',
  secondaryForeground: '#1C1C1C',
  muted: '#F5F5F5',
  mutedForeground: '#666666',
  textMuted: '#888888',

  // Borders & Inputs
  border: '#E0E0E0',
  inputBorder: '#D0D0D0',
  ring: 'rgba(28, 28, 28, 0.1)',

  // Brand Accents (Lovable coral/orange)
  brandTiger: '#C53307',
  brandSaffron: '#B74106',
  brandSapphire: '#1F6AD9',
  brandTwilight: '#5337CD',
  brandBubblegum: '#B517A0',

  // Semantic
  destructive: '#D10808',
  success: '#22C55E',
  warning: '#F59E0B',
  error: '#D10808',
  errorLight: 'rgba(209, 8, 8, 0.1)',

  // Chat specific
  userBubble: '#1C1C1C',
  userBubbleText: '#FFFFFF',
  assistantBubble: '#F0F0F0',
  assistantBubbleText: '#1C1C1C',

  // Code editor specific
  codeBackground: '#1E1E1E',
  codeForeground: '#D4D4D4',
  lineNumbers: '#858585',

  // Tab bar
  tabInactive: '#888888',
  tabActive: '#C53307',
};

// Spacing scale
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 20,
  xl: 24,
  '2xl': 32,
  '3xl': 48,
};

// Border radius
export const radius = {
  sm: 4,
  md: 6,
  lg: 12,
  xl: 16,
  full: 9999,
};

// Shadow presets for iOS
export const shadows = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 5,
  },
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  glow: (color: string, opacity = 0.4) => ({
    shadowColor: color,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: opacity,
    shadowRadius: 12,
    elevation: 0,
  }),
};
