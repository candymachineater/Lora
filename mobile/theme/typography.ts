import { TextStyle } from 'react-native';

export const typography: Record<string, TextStyle> = {
  h1: {
    fontSize: 48,
    fontWeight: '500',
    lineHeight: 48,
  },
  h2: {
    fontSize: 24,
    fontWeight: '500',
    lineHeight: 32,
  },
  h3: {
    fontSize: 18,
    fontWeight: '500',
    lineHeight: 27,
  },
  h4: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 24,
  },
  body: {
    fontSize: 16,
    fontWeight: '400',
    lineHeight: 24,
  },
  bodyLarge: {
    fontSize: 20,
    fontWeight: '400',
    lineHeight: 25,
  },
  button: {
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 18,
  },
  caption: {
    fontSize: 12,
    fontWeight: '400',
    lineHeight: 18,
  },
  code: {
    fontSize: 14,
    fontWeight: '400',
    fontFamily: 'monospace',
    lineHeight: 20,
  },
};
