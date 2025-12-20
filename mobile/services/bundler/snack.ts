import { Project, ProjectFile } from '../../types';

const SDK_VERSION = '52.0.0';

interface SnackFile {
  type: 'CODE' | 'ASSET';
  contents: string;
}

/**
 * Create a Snack preview URL by encoding files directly in the URL query parameter.
 * This approach doesn't require an API call - the Snack platform reads the files
 * from the URL parameters directly.
 *
 * Reference: https://github.com/expo/snack/blob/main/docs/url-query-parameters.md
 */
export async function createSnack(project: Project): Promise<string> {
  console.log('[Snack] Creating snack for project:', project.name);
  console.log('[Snack] Project files count:', project.files.length);
  console.log('[Snack] Project files:', project.files.map(f => `${f.path} (${f.content?.length || 0} chars)`));

  const snackFiles: Record<string, SnackFile> = {};
  let hasEntryPoint = false;

  // Convert project files to Snack format
  for (const file of project.files) {
    // Skip binary files and large files
    if (file.path.match(/\.(png|jpg|jpeg|gif|ico|woff|ttf|mp3|mp4)$/i)) {
      console.log('[Snack] Skipping binary file:', file.path);
      continue;
    }

    // Skip files without content
    if (!file.content || file.content.trim() === '') {
      console.log('[Snack] Skipping empty file:', file.path);
      continue;
    }

    // Normalize path - Snack expects paths without leading slashes
    let filePath = file.path.replace(/^\/+/, '');

    // Check for entry point - Snack looks for App.js or App.tsx
    if (filePath === 'App.tsx' || filePath === 'App.js') {
      hasEntryPoint = true;
      console.log('[Snack] Found entry point:', filePath);
    }

    snackFiles[filePath] = {
      type: 'CODE',
      contents: file.content,
    };
  }

  // If no entry point found, create a minimal App.js
  if (!hasEntryPoint) {
    console.log('[Snack] No entry point found, creating default App.js');
    snackFiles['App.js'] = {
      type: 'CODE',
      contents: `import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Hello from Lora!</Text>
      <Text style={styles.subtext}>Add an App.tsx or App.js to your project</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  text: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  subtext: {
    fontSize: 14,
    color: '#666',
    marginTop: 8,
  },
});`,
    };
  }

  // Add package.json if not present with minimal dependencies
  if (!snackFiles['package.json']) {
    console.log('[Snack] Adding default package.json');
    snackFiles['package.json'] = {
      type: 'CODE',
      contents: JSON.stringify(
        {
          dependencies: {
            'react-native': 'expo/react-native',
            expo: `~${SDK_VERSION}`,
            'expo-status-bar': '~2.0.0',
          },
        },
        null,
        2
      ),
    };
  }

  console.log('[Snack] Final files to upload:', Object.keys(snackFiles));

  // Build URL with files parameter
  const filesParam = encodeURIComponent(JSON.stringify(snackFiles));
  const nameParam = encodeURIComponent(project.name || 'Lora Preview');
  const descParam = encodeURIComponent(project.description || 'Built with Lora');

  // Construct the Snack URL with embedded files
  const snackUrl = `https://snack.expo.dev/?name=${nameParam}&description=${descParam}&files=${filesParam}`;

  console.log('[Snack] Created URL, length:', snackUrl.length);

  return snackUrl;
}

export async function createEmbeddedSnackUrl(project: Project): Promise<string> {
  // Get the base snack URL with files embedded
  const snackUrl = await createSnack(project);

  // Add embed parameters (snackUrl already has query params, so use &)
  return `${snackUrl}&embed=1&preview=true&platform=ios&theme=light`;
}

export function generateSnackQRUrl(snackId: string): string {
  // Generate QR code URL for scanning with Expo Go
  return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=exp://exp.host/${snackId}`;
}

// Helper to get Snack ID from URL
export function getSnackIdFromUrl(url: string): string | null {
  const match = url.match(/snack\.expo\.dev\/(@[^/]+\/[^?]+|[^/?]+)/);
  return match ? match[1] : null;
}

// Build preview HTML for WebView (fallback option)
export function buildPreviewHtml(files: ProjectFile[]): string {
  const appFile = files.find((f) => f.path === 'App.tsx' || f.path === 'App.js');
  const code = appFile?.content || '// No App.tsx found';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Lora Preview</title>
  <style>
    body {
      margin: 0;
      padding: 20px;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      background: #f5f5f5;
    }
    .code-container {
      background: #1e1e1e;
      border-radius: 8px;
      padding: 16px;
      overflow-x: auto;
    }
    pre {
      margin: 0;
      color: #d4d4d4;
      font-family: 'SF Mono', Menlo, monospace;
      font-size: 12px;
      line-height: 1.5;
    }
    .info {
      margin-bottom: 12px;
      padding: 12px;
      background: #fff;
      border-radius: 8px;
      border: 1px solid #e0e0e0;
    }
    .info p {
      margin: 0;
      font-size: 14px;
      color: #666;
    }
  </style>
</head>
<body>
  <div class="info">
    <p>For live preview, use Expo Snack or scan the QR code with Expo Go.</p>
  </div>
  <div class="code-container">
    <pre>${escapeHtml(code)}</pre>
  </div>
</body>
</html>
  `;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
