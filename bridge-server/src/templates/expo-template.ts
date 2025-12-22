import { BaseTemplate } from './base-template';
import { TemplateFile, ProjectType } from './types';

export class ExpoTemplate extends BaseTemplate {
  type: ProjectType = 'mobile';
  name = 'Expo Mobile App';
  description = 'React Native app with Expo';

  generateFiles(projectId: string, projectName: string): TemplateFile[] {
    const files: TemplateFile[] = [];

    // package.json with Expo dependencies
    files.push({
      path: 'package.json',
      content: JSON.stringify({
        name: projectId,
        version: '1.0.0',
        main: 'index.js',
        scripts: {
          start: 'expo start',
          android: 'expo start --android',
          ios: 'expo start --ios',
          web: 'expo start --web'
        },
        dependencies: {
          'expo': '~54.0.0',
          'expo-status-bar': '~3.0.0',
          'react': '19.1.0',
          'react-dom': '19.1.0',
          'react-native': '0.81.5',
          'react-native-web': '^0.21.0',
          'react-native-safe-area-context': '^5.0.0',
          '@react-navigation/native': '^7.0.0'
        },
        devDependencies: {
          '@types/react': '~19.1.0',
          'babel-preset-expo': '^54.0.0',
          'typescript': '~5.9.0'
        }
      }, null, 2)
    });

    // app.json for Expo
    files.push({
      path: 'app.json',
      content: JSON.stringify({
        expo: {
          name: projectName,
          slug: projectId,
          version: '1.0.0',
          orientation: 'portrait',
          userInterfaceStyle: 'light',
          splash: {
            backgroundColor: '#ffffff'
          },
          ios: {
            supportsTablet: true
          },
          android: {
            adaptiveIcon: {
              backgroundColor: '#ffffff'
            }
          }
        }
      }, null, 2)
    });

    // babel.config.js
    files.push({
      path: 'babel.config.js',
      content: `module.exports = function(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
`
    });

    // tsconfig.json
    files.push({
      path: 'tsconfig.json',
      content: JSON.stringify({
        extends: 'expo/tsconfig.base',
        compilerOptions: {
          strict: true
        }
      }, null, 2)
    });

    // App.tsx with starter template
    files.push({
      path: 'App.tsx',
      content: `import React from 'react';
import { StyleSheet, Text, View, SafeAreaView, StatusBar } from 'react-native';

export default function App() {
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.content}>
        <Text style={styles.title}>Welcome to ${projectName}</Text>
        <Text style={styles.subtitle}>Start building your app!</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
  },
});
`
    });

    // index.js entry point
    files.push({
      path: 'index.js',
      content: `import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
`
    });

    // .gitignore
    files.push({
      path: '.gitignore',
      content: `node_modules/
.expo/
dist/
*.log
`
    });

    return files;
  }

  generateClaudeMd(projectPath: string): string {
    return `# Project Sandbox Rules

This is an isolated Expo/React Native project.

## Restrictions

- You can ONLY access files within: \`${projectPath}\`
- No access to parent directories or other projects
- All file operations must be within this project folder

## Preview System

Lora automatically runs \`npx expo start --web\` when you preview.
- HMR (Hot Module Replacement) is fully supported
- Changes appear instantly in the Preview tab
- No manual server management needed

## Project Structure

This is an Expo/React Native project. Focus on building and modifying files within this directory only.
`;
  }

  getDevCommand(port: number): string[] {
    return ['npx', 'expo', 'start', '--web', '--port', port.toString()];
  }
}
