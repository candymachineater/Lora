import { Project, ProjectFile } from '../../types';

const SNACK_API = 'https://snack.expo.dev/api/snacks';
const SDK_VERSION = '52.0.0';

interface SnackFile {
  type: 'CODE';
  contents: string;
}

interface SnackResponse {
  id: string;
  url: string;
  fullName: string;
}

interface SnackConfig {
  name: string;
  description?: string;
  files: Record<string, SnackFile>;
  dependencies?: Record<string, string>;
  sdkVersion: string;
}

export async function createSnack(project: Project): Promise<string> {
  const snackFiles: Record<string, SnackFile> = {};

  // Convert project files to Snack format
  for (const file of project.files) {
    snackFiles[file.path] = {
      type: 'CODE',
      contents: file.content || '',
    };
  }

  // Add package.json if not present
  if (!snackFiles['package.json']) {
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

  const config: SnackConfig = {
    name: project.name || 'Lora Preview',
    description: project.description || 'Built with Lora',
    files: snackFiles,
    sdkVersion: SDK_VERSION,
  };

  try {
    const response = await fetch(SNACK_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(config),
    });

    if (!response.ok) {
      throw new Error(`Snack API error: ${response.status}`);
    }

    const data: SnackResponse = await response.json();
    return `https://snack.expo.dev/${data.id}`;
  } catch (err) {
    console.error('[Snack] Failed to create snack:', err);
    throw err;
  }
}

export async function createEmbeddedSnackUrl(project: Project): Promise<string> {
  // Create a local preview URL with embedded code
  // This uses the Snack embed URL format
  const snackUrl = await createSnack(project);

  // Return embedded preview URL
  return `${snackUrl}?embed=1&preview=true&platform=ios&theme=light`;
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
