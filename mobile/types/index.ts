// Project types
export interface Project {
  id: string;
  name: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
  files: ProjectFile[];
}

export interface ProjectFile {
  path: string;
  content: string;
  type: 'tsx' | 'ts' | 'json' | 'css' | 'md';
}

// Version control types
export interface Version {
  id: string;
  projectId: string;
  message: string;
  timestamp: Date;
  files: Record<string, string>;
}

// Chat types
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  codeBlocks?: CodeBlock[];
  timestamp: Date;
  isStreaming?: boolean;
}

export interface CodeBlock {
  filename: string;
  language: string;
  content: string;
}

// WebSocket message types
export interface WSMessage {
  type: 'chat' | 'ping' | 'cancel';
  prompt?: string;
  systemPrompt?: string;
}

export interface WSResponse {
  type: 'stream' | 'done' | 'error' | 'pong' | 'connected';
  content?: string;
  error?: string;
}

// Settings types
export interface Settings {
  bridgeServerUrl: string;
  isConnected: boolean;
  autoPreview: boolean;
}
