// Project types - stored on PC via bridge server
export interface Project {
  id: string;
  name: string;
  description?: string;
  path?: string; // Path on PC (from bridge server)
  files: ProjectFile[];
  sandbox: boolean; // true = sandboxed to project, false = full filesystem access (set at creation)
  createdAt: Date;
  updatedAt: Date;
}

// Server project response (from bridge server)
export interface ServerProject {
  id: string;
  name: string;
  path: string;
  createdAt: string;
}

export interface ProjectFile {
  path: string;
  name: string;
  isDirectory: boolean;
  content?: string;
  type?: 'tsx' | 'ts' | 'json' | 'css' | 'md' | 'js' | 'jsx';
}

// Code block types
export interface CodeBlock {
  path: string;
  filename?: string;
  content: string;
  type: 'tsx' | 'ts' | 'json' | 'css' | 'md' | 'js' | 'jsx';
  language?: string;
}

// Version types (for project versioning)
export interface Version {
  id: string;
  projectId?: string;
  timestamp: Date;
  description: string;
  snapshot: string; // JSON stringified project state
}

// Chat types
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  codeBlocks?: CodeBlock[];
}

// WebSocket message types
export interface WSMessage {
  type: 'ping' | 'cancel' | 'create_project' | 'delete_project' | 'list_projects' | 'get_files' | 'get_file_content' | 'save_file' | 'terminal_create' | 'terminal_input' | 'terminal_resize' | 'terminal_close' | 'voice_create' | 'voice_audio' | 'voice_text' | 'voice_close' | 'voice_status' | 'voice_terminal_enable' | 'voice_terminal_disable' | 'voice_terminal_audio';
  projectName?: string;
  projectId?: string;
  filePath?: string;
  content?: string; // For save_file
  terminalId?: string;
  input?: string;
  cols?: number;
  rows?: number;
  sandbox?: boolean; // true = sandboxed to project, false = full filesystem access
  autoStartClaude?: boolean; // Auto-start claude code on terminal creation
  // Voice-related fields
  voiceSessionId?: string;
  audioData?: string; // Base64 encoded audio
  audioMimeType?: string; // e.g., 'audio/wav', 'audio/m4a'
  text?: string; // For voice_text (text input instead of audio)
}

export interface WSResponse {
  type: 'pong' | 'connected' | 'stream' | 'done' | 'projects' | 'files' | 'file_content' | 'file_saved' | 'project_created' | 'project_deleted' | 'terminal_created' | 'terminal_output' | 'terminal_closed' | 'error' | 'voice_created' | 'voice_transcription' | 'voice_response' | 'voice_audio' | 'voice_progress' | 'voice_closed' | 'voice_status' | 'voice_terminal_enabled' | 'voice_terminal_disabled' | 'voice_terminal_speaking';
  content?: string;
  error?: string;
  projects?: ServerProject[];
  files?: ProjectFile[];
  fileContent?: string;
  filePath?: string; // For save confirmation
  project?: ServerProject;
  terminalId?: string;
  projectId?: string; // For delete confirmation
  // Voice-related fields
  voiceSessionId?: string;
  transcription?: string; // STT result
  responseText?: string; // Claude's text response (summarized for voice)
  audioData?: string; // Base64 encoded TTS audio
  audioMimeType?: string; // e.g., 'audio/mp3'
  voiceAvailable?: { stt: boolean; tts: boolean; agent: boolean }; // Service availability
  voiceEnabled?: boolean; // Voice mode status for terminal
}

// Settings types
export interface Settings {
  bridgeServerUrl: string;
  isConnected: boolean;
}
