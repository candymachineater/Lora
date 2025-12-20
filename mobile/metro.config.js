const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Fix for web: use default transform profile instead of hermes
config.transformer = {
  ...config.transformer,
  unstable_allowRequireContext: true,
  getTransformOptions: async (entryPoints, options) => {
    // Use default profile for web, hermes for native
    const isWeb = options.platform === 'web';
    return {
      transform: {
        experimentalImportSupport: false,
        inlineRequires: true,
      },
      // Force default profile for web to avoid import.meta issues
      unstable_transformProfile: isWeb ? 'default' : 'hermes-stable',
    };
  },
};

// Add mjs support
config.resolver = {
  ...config.resolver,
  sourceExts: [...(config.resolver?.sourceExts || []), 'mjs'],
};

module.exports = config;
