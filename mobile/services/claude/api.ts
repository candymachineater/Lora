import { WSMessage, WSResponse, ServerProject, ProjectFile } from '../../types';

type MessageCallback = (chunk: string) => void;
type ConnectionCallback = () => void;
type ErrorCallback = (error: string) => void;
type ProjectsCallback = (projects: ServerProject[]) => void;
type FilesCallback = (files: ProjectFile[]) => void;
type FileContentCallback = (content: string) => void;
type ProjectCreatedCallback = (project: ServerProject) => void;

class BridgeService {
  private ws: WebSocket | null = null;
  private serverUrl: string = '';
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  // Callbacks
  private onMessageCallback: MessageCallback | null = null;
  private onDoneCallback: ConnectionCallback | null = null;
  private onErrorCallback: ErrorCallback | null = null;
  private onConnectCallback: ConnectionCallback | null = null;
  private onDisconnectCallback: ConnectionCallback | null = null;
  private onProjectsCallback: ProjectsCallback | null = null;
  private onFilesCallback: FilesCallback | null = null;
  private onFileContentCallback: FileContentCallback | null = null;
  private onProjectCreatedCallback: ProjectCreatedCallback | null = null;

  // Pending promise resolvers for request/response pattern
  private pendingResolvers: Map<string, (value: any) => void> = new Map();

  // Request counter for unique IDs
  private requestCounter = 0;

  // Track if a connection is in progress
  private connectingPromise: Promise<ServerProject[]> | null = null;

  async connect(serverUrl: string): Promise<ServerProject[]> {
    // If already connected to the same server, return empty (caller should use listProjects)
    if (this.isConnected() && this.serverUrl === serverUrl) {
      console.log('[Bridge] Already connected, reusing connection');
      return [];
    }

    // If connection is in progress to the same server, wait for it
    if (this.connectingPromise && this.serverUrl === serverUrl) {
      console.log('[Bridge] Connection in progress, waiting...');
      return this.connectingPromise;
    }

    // If connecting to a different server or not connected, start fresh
    this.connectingPromise = this._doConnect(serverUrl);
    try {
      const result = await this.connectingPromise;
      return result;
    } finally {
      this.connectingPromise = null;
    }
  }

  private _doConnect(serverUrl: string): Promise<ServerProject[]> {
    return new Promise((resolve, reject) => {
      try {
        this.serverUrl = serverUrl;
        // Clear any pending resolvers from old connection
        this.pendingResolvers.clear();
        this.cleanup();

        this.ws = new WebSocket(serverUrl);

        this.ws.onopen = () => {
          console.log('[Bridge] Connected to bridge server');
          this.reconnectAttempts = 0;
          this.startPingInterval();
        };

        this.ws.onmessage = (event) => {
          try {
            const response: WSResponse = JSON.parse(event.data);
            // Only log important messages to reduce noise (skip high-frequency polling responses)
            if (response.type !== 'terminal_output' && response.type !== 'pong' && response.type !== 'files') {
              if (response.type === 'error') {
                console.error(`[Bridge] error: ${response.error || 'Unknown error'}`);
              } else {
                console.log(`[Bridge] ${response.type}`);
              }
            }
            this.handleResponse(response, resolve);
          } catch (err) {
            console.error('[Bridge] Failed to parse message:', err);
          }
        };

        this.ws.onerror = (error) => {
          console.error('[Bridge] WebSocket error:', error);
          this.onErrorCallback?.('Connection error');
          reject(new Error('WebSocket connection failed'));
        };

        this.ws.onclose = () => {
          console.log('[Bridge] Disconnected from bridge server');
          this.cleanup();
          this.onDisconnectCallback?.();
          this.attemptReconnect();
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  private handleResponse(response: WSResponse, initialResolve?: (projects: ServerProject[]) => void) {
    switch (response.type) {
      case 'connected':
        this.onConnectCallback?.();
        // Resolve initial connection with projects list
        if (initialResolve && response.projects) {
          initialResolve(response.projects);
        }
        break;

      case 'stream':
        if (response.content) {
          this.onMessageCallback?.(response.content);
        }
        break;

      case 'done':
        this.onDoneCallback?.();
        break;

      case 'error':
        // Route terminal-specific errors to voice terminal callbacks
        if (response.terminalId) {
          const vtCallbacks = this.voiceTerminalCallbacks.get(response.terminalId);
          if (vtCallbacks?.onError) {
            vtCallbacks.onError(response.error || 'Unknown error');
          }
        }
        this.onErrorCallback?.(response.error || 'Unknown error');
        break;

      case 'pong':
        break;

      case 'projects':
        if (response.projects) {
          this.onProjectsCallback?.(response.projects);
          this.pendingResolvers.get('projects')?.(response.projects);
          this.pendingResolvers.delete('projects');
        }
        break;

      case 'files':
        if (response.files) {
          this.onFilesCallback?.(response.files);
          const resolver = this.pendingResolvers.get('files');
          if (resolver) {
            resolver(response.files);
            this.pendingResolvers.delete('files');
          }
        }
        break;

      case 'file_content':
        this.onFileContentCallback?.(response.fileContent || '');
        this.pendingResolvers.get('file_content')?.(response.fileContent || '');
        this.pendingResolvers.delete('file_content');
        break;

      case 'file_saved':
        this.pendingResolvers.get('file_saved')?.(response.filePath);
        this.pendingResolvers.delete('file_saved');
        break;

      case 'project_created':
        if (response.project) {
          this.onProjectCreatedCallback?.(response.project);
          this.pendingResolvers.get('project_created')?.(response.project);
          this.pendingResolvers.delete('project_created');
        }
        break;

      case 'project_deleted':
        if (response.projectId) {
          this.pendingResolvers.get('project_deleted')?.(response.projectId);
          this.pendingResolvers.delete('project_deleted');
        }
        break;

      case 'terminal_created':
        if (response.terminalId) {
          this.pendingResolvers.get('terminal_created')?.(response.terminalId);
          this.pendingResolvers.delete('terminal_created');
        }
        break;

      case 'terminal_output':
        if (response.terminalId && response.content) {
          this.handleTerminalOutput(response.terminalId, response.content);
        }
        break;

      case 'terminal_closed':
        if (response.terminalId) {
          this.handleTerminalClosed(response.terminalId);
        }
        break;

      // Voice responses
      case 'voice_status':
        if (response.voiceAvailable) {
          this.pendingResolvers.get('voice_status')?.(response.voiceAvailable);
          this.pendingResolvers.delete('voice_status');
        }
        break;

      case 'voice_created':
        if (response.voiceSessionId) {
          this.pendingResolvers.get('voice_created')?.(response.voiceSessionId);
          this.pendingResolvers.delete('voice_created');
        }
        break;

      case 'voice_transcription':
        if (response.voiceSessionId && response.transcription) {
          this.handleVoiceTranscription(response.voiceSessionId, response.transcription);
        }
        break;

      case 'voice_progress':
        if (response.voiceSessionId && response.responseText) {
          this.handleVoiceProgress(response.voiceSessionId, response.responseText);
        }
        break;

      case 'voice_response':
        if (response.voiceSessionId && response.responseText) {
          this.handleVoiceResponse(response.voiceSessionId, response.responseText, response.audioData);
        }
        break;

      case 'voice_audio':
        if (response.voiceSessionId && response.audioData && response.audioMimeType) {
          this.handleVoiceAudio(response.voiceSessionId, response.audioData, response.audioMimeType);
        }
        break;

      case 'voice_closed':
        if (response.voiceSessionId) {
          this.handleVoiceClosed(response.voiceSessionId);
        }
        break;

      // Voice-Terminal integration responses
      case 'voice_terminal_enabled':
        if (response.terminalId) {
          const vtCallbacks = this.voiceTerminalCallbacks.get(response.terminalId);
          console.log('[BridgeService] voice_terminal_enabled received for:', response.terminalId, 'hasCallbacks:', !!vtCallbacks, 'hasOnEnabled:', !!vtCallbacks?.onEnabled);
          vtCallbacks?.onEnabled?.();
        }
        break;

      case 'voice_terminal_disabled':
        if (response.terminalId) {
          const vtCallbacks = this.voiceTerminalCallbacks.get(response.terminalId);
          vtCallbacks?.onDisabled?.();
          this.voiceTerminalCallbacks.delete(response.terminalId);
        }
        break;

      case 'voice_terminal_speaking':
        if (response.terminalId && response.responseText && response.audioData) {
          const vtCallbacks = this.voiceTerminalCallbacks.get(response.terminalId);
          vtCallbacks?.onSpeaking?.(response.responseText, response.audioData, response.isComplete);
        }
        break;

      case 'voice_app_control':
        if (response.terminalId && response.appControl) {
          const vtCallbacks = this.voiceTerminalCallbacks.get(response.terminalId);
          vtCallbacks?.onAppControl?.(response.appControl);
        }
        break;

      case 'voice_working':
        if (response.terminalId && response.workingState) {
          const vtCallbacks = this.voiceTerminalCallbacks.get(response.terminalId);
          vtCallbacks?.onWorking?.(response.workingState);
        }
        break;

      case 'voice_background_task_started':
        if (response.terminalId && response.backgroundTaskId && response.backgroundTaskDescription) {
          const vtCallbacks = this.voiceTerminalCallbacks.get(response.terminalId);
          vtCallbacks?.onBackgroundTaskStarted?.(response.backgroundTaskId, response.backgroundTaskDescription);
        }
        break;

      case 'voice_background_task_complete':
        if (response.terminalId && response.backgroundTaskId) {
          const vtCallbacks = this.voiceTerminalCallbacks.get(response.terminalId);
          vtCallbacks?.onBackgroundTaskComplete?.(
            response.backgroundTaskId,
            response.backgroundTaskDescription || 'Background task',
            response.backgroundTaskResult || 'Completed'
          );
        }
        break;

      case 'voice_progress':
        // Handle progress for both voice sessions and voice-terminal
        if (response.voiceSessionId && response.responseText) {
          this.handleVoiceProgress(response.voiceSessionId, response.responseText);
        }
        if (response.terminalId && response.responseText) {
          const vtCallbacks = this.voiceTerminalCallbacks.get(response.terminalId);
          vtCallbacks?.onProgress?.(response.responseText);
        }
        break;

      case 'voice_transcription':
        // Handle transcription for both voice sessions and voice-terminal
        if (response.voiceSessionId && response.transcription) {
          this.handleVoiceTranscription(response.voiceSessionId, response.transcription);
        }
        if (response.terminalId && response.transcription) {
          const vtCallbacks = this.voiceTerminalCallbacks.get(response.terminalId);
          vtCallbacks?.onTranscription?.(response.transcription);
        }
        break;

      // Preview responses
      case 'preview_started':
        const previewStartedResolver = this.pendingResolvers.get('preview_started');
        if (previewStartedResolver) {
          previewStartedResolver({ previewUrl: response.previewUrl, previewPort: response.previewPort });
          this.pendingResolvers.delete('preview_started');
        }
        break;

      case 'preview_stopped':
        const previewStoppedResolver = this.pendingResolvers.get('preview_stopped');
        if (previewStoppedResolver) {
          previewStoppedResolver({ stopped: response.stopped });
          this.pendingResolvers.delete('preview_stopped');
        }
        break;

      case 'preview_status':
        const previewStatusResolver = this.pendingResolvers.get('preview_status');
        if (previewStatusResolver) {
          previewStatusResolver({
            previewRunning: response.previewRunning,
            previewUrl: response.previewUrl,
            previewPort: response.previewPort
          });
          this.pendingResolvers.delete('preview_status');
        }
        break;

      case 'preview_error':
        if (response.projectId && response.previewError) {
          const errorCallback = this.previewErrorCallbacks.get(response.projectId);
          if (errorCallback) {
            errorCallback(response.previewError, response.previewErrorType || 'error');
          }
        }
        break;
    }
  }

  private startPingInterval() {
    this.stopPingInterval();
    this.pingInterval = setInterval(() => {
      this.ping();
    }, 30000);
  }

  private stopPingInterval() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('[Bridge] Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);

    console.log(`[Bridge] Attempting reconnect in ${delay}ms...`);

    this.reconnectTimeout = setTimeout(() => {
      if (this.serverUrl) {
        this.connect(this.serverUrl).catch((err) => {
          console.error('[Bridge] Reconnect failed:', err);
        });
      }
    }, delay);
  }

  private cleanup() {
    this.stopPingInterval();
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
    }
  }

  disconnect() {
    this.cleanup();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.serverUrl = '';
    this.reconnectAttempts = this.maxReconnectAttempts;
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private send(message: WSMessage) {
    if (this.isConnected()) {
      this.ws?.send(JSON.stringify(message));
    }
  }

  ping() {
    this.send({ type: 'ping' });
  }

  cancel() {
    this.send({ type: 'cancel' });
  }

  // Project management
  async createProject(name: string): Promise<ServerProject> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected()) {
        reject(new Error('Not connected'));
        return;
      }
      this.pendingResolvers.set('project_created', resolve);
      this.send({ type: 'create_project', projectName: name });
      setTimeout(() => {
        if (this.pendingResolvers.has('project_created')) {
          this.pendingResolvers.delete('project_created');
          reject(new Error('Timeout creating project'));
        }
      }, 10000);
    });
  }

  async deleteProject(projectId: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected()) {
        reject(new Error('Not connected'));
        return;
      }
      this.pendingResolvers.set('project_deleted', resolve);
      this.send({ type: 'delete_project', projectId });
      setTimeout(() => {
        if (this.pendingResolvers.has('project_deleted')) {
          this.pendingResolvers.delete('project_deleted');
          reject(new Error('Timeout deleting project'));
        }
      }, 10000);
    });
  }

  async listProjects(): Promise<ServerProject[]> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected()) {
        reject(new Error('Not connected'));
        return;
      }
      this.pendingResolvers.set('projects', resolve);
      this.send({ type: 'list_projects' });
      setTimeout(() => {
        if (this.pendingResolvers.has('projects')) {
          this.pendingResolvers.delete('projects');
          reject(new Error('Timeout listing projects'));
        }
      }, 10000);
    });
  }

  private filesRequestId = 0;
  private filesTimeoutId: ReturnType<typeof setTimeout> | null = null;

  async getFiles(projectId: string, subPath?: string): Promise<ProjectFile[]> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected()) {
        reject(new Error('Not connected'));
        return;
      }

      // Cancel any existing pending files request AND its timeout
      if (this.pendingResolvers.has('files')) {
        this.pendingResolvers.delete('files');
      }
      if (this.filesTimeoutId) {
        clearTimeout(this.filesTimeoutId);
        this.filesTimeoutId = null;
      }

      // Generate unique request ID to prevent stale timeout issues
      const requestId = ++this.filesRequestId;

      this.pendingResolvers.set('files', (files) => {
        if (this.filesTimeoutId) {
          clearTimeout(this.filesTimeoutId);
          this.filesTimeoutId = null;
        }
        resolve(files);
      });
      this.send({ type: 'get_files', projectId, filePath: subPath });

      this.filesTimeoutId = setTimeout(() => {
        // Only timeout if this is still the current request
        if (requestId === this.filesRequestId && this.pendingResolvers.has('files')) {
          this.pendingResolvers.delete('files');
          reject(new Error('Timeout getting files'));
        }
        this.filesTimeoutId = null;
      }, 30000);
    });
  }

  async getFileContent(projectId: string, filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected()) {
        reject(new Error('Not connected'));
        return;
      }
      this.pendingResolvers.set('file_content', resolve);
      this.send({ type: 'get_file_content', projectId, filePath });
      setTimeout(() => {
        if (this.pendingResolvers.has('file_content')) {
          this.pendingResolvers.delete('file_content');
          reject(new Error('Timeout getting file content'));
        }
      }, 10000);
    });
  }

  async saveFile(projectId: string, filePath: string, content: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected()) {
        reject(new Error('Not connected'));
        return;
      }
      this.pendingResolvers.set('file_saved', resolve);
      this.send({ type: 'save_file', projectId, filePath, content });
      setTimeout(() => {
        if (this.pendingResolvers.has('file_saved')) {
          this.pendingResolvers.delete('file_saved');
          reject(new Error('Timeout saving file'));
        }
      }, 10000);
    });
  }

  // Terminal management
  private terminalCallbacks: Map<string, {
    onOutput?: (data: string) => void;
    onClose?: () => void;
  }> = new Map();

  async createTerminal(
    projectId: string,
    callbacks: {
      onOutput?: (data: string) => void;
      onClose?: () => void;
    },
    cols: number = 80,
    rows: number = 24,
    sandbox: boolean = true,
    initialPrompt?: string  // Optional initial prompt to send to Claude on startup
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected()) {
        reject(new Error('Not connected'));
        return;
      }

      // Temporarily store callbacks to associate with terminal ID when created
      const tempId = `pending-${Date.now()}`;
      this.terminalCallbacks.set(tempId, callbacks);

      this.pendingResolvers.set('terminal_created', (terminalId: string) => {
        // Move callbacks to actual terminal ID
        this.terminalCallbacks.delete(tempId);
        this.terminalCallbacks.set(terminalId, callbacks);
        resolve(terminalId);
      });

      this.send({ type: 'terminal_create', projectId, cols, rows, sandbox, initialPrompt });

      setTimeout(() => {
        if (this.pendingResolvers.has('terminal_created')) {
          this.pendingResolvers.delete('terminal_created');
          this.terminalCallbacks.delete(tempId);
          reject(new Error('Timeout creating terminal'));
        }
      }, 10000);
    });
  }

  sendTerminalInput(terminalId: string, input: string) {
    this.send({ type: 'terminal_input', terminalId, input });
  }

  resizeTerminal(terminalId: string, cols: number, rows: number) {
    this.send({ type: 'terminal_resize', terminalId, cols, rows });
  }

  closeTerminal(terminalId: string) {
    this.send({ type: 'terminal_close', terminalId });
    this.terminalCallbacks.delete(terminalId);
  }

  private handleTerminalOutput(terminalId: string, data: string) {
    const callbacks = this.terminalCallbacks.get(terminalId);
    callbacks?.onOutput?.(data);
  }

  private handleTerminalClosed(terminalId: string) {
    const callbacks = this.terminalCallbacks.get(terminalId);
    callbacks?.onClose?.();
    this.terminalCallbacks.delete(terminalId);
  }

  // Voice session management
  private voiceCallbacks: Map<string, {
    onTranscription?: (text: string) => void;
    onProgress?: (text: string) => void;
    onResponse?: (text: string, audioData?: string) => void;
    onAudio?: (audioData: string, mimeType: string) => void;
    onClose?: () => void;
    onError?: (error: string) => void;
  }> = new Map();

  async checkVoiceStatus(): Promise<{ stt: boolean; tts: boolean; agent: boolean }> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected()) {
        reject(new Error('Not connected'));
        return;
      }
      this.pendingResolvers.set('voice_status', resolve);
      this.send({ type: 'voice_status' });
      setTimeout(() => {
        if (this.pendingResolvers.has('voice_status')) {
          this.pendingResolvers.delete('voice_status');
          reject(new Error('Timeout checking voice status'));
        }
      }, 5000);
    });
  }

  async createVoiceSession(
    projectId: string,
    callbacks: {
      onTranscription?: (text: string) => void;
      onProgress?: (text: string) => void;
      onResponse?: (text: string, audioData?: string) => void;
      onAudio?: (audioData: string, mimeType: string) => void;
      onClose?: () => void;
      onError?: (error: string) => void;
    }
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected()) {
        reject(new Error('Not connected'));
        return;
      }

      const tempId = `pending-voice-${Date.now()}`;
      this.voiceCallbacks.set(tempId, callbacks);

      this.pendingResolvers.set('voice_created', (voiceSessionId: string) => {
        this.voiceCallbacks.delete(tempId);
        this.voiceCallbacks.set(voiceSessionId, callbacks);
        resolve(voiceSessionId);
      });

      this.send({ type: 'voice_create', projectId });

      setTimeout(() => {
        if (this.pendingResolvers.has('voice_created')) {
          this.pendingResolvers.delete('voice_created');
          this.voiceCallbacks.delete(tempId);
          reject(new Error('Timeout creating voice session'));
        }
      }, 10000);
    });
  }

  sendVoiceAudio(voiceSessionId: string, audioData: string, mimeType: string = 'audio/wav') {
    this.send({
      type: 'voice_audio',
      voiceSessionId,
      audioData,
      audioMimeType: mimeType
    });
  }

  sendVoiceText(voiceSessionId: string, text: string) {
    this.send({
      type: 'voice_text',
      voiceSessionId,
      text
    });
  }

  closeVoiceSession(voiceSessionId: string) {
    this.send({ type: 'voice_close', voiceSessionId });
    this.voiceCallbacks.delete(voiceSessionId);
  }

  private handleVoiceTranscription(voiceSessionId: string, transcription: string) {
    const callbacks = this.voiceCallbacks.get(voiceSessionId);
    callbacks?.onTranscription?.(transcription);
  }

  private handleVoiceProgress(voiceSessionId: string, text: string) {
    const callbacks = this.voiceCallbacks.get(voiceSessionId);
    callbacks?.onProgress?.(text);
  }

  private handleVoiceResponse(voiceSessionId: string, text: string, audioData?: string) {
    const callbacks = this.voiceCallbacks.get(voiceSessionId);
    callbacks?.onResponse?.(text, audioData);
  }

  private handleVoiceAudio(voiceSessionId: string, audioData: string, mimeType: string) {
    const callbacks = this.voiceCallbacks.get(voiceSessionId);
    callbacks?.onAudio?.(audioData, mimeType);
  }

  private handleVoiceClosed(voiceSessionId: string) {
    const callbacks = this.voiceCallbacks.get(voiceSessionId);
    callbacks?.onClose?.();
    this.voiceCallbacks.delete(voiceSessionId);
  }

  // Voice-Terminal integration
  // This links voice input/output directly to a terminal running Claude Code
  private voiceTerminalCallbacks: Map<string, {
    onTranscription?: (text: string) => void;
    onProgress?: (text: string) => void;
    onSpeaking?: (text: string, audioData: string, isComplete?: boolean) => void;
    onAppControl?: (control: { action: string; target?: string; params?: Record<string, unknown> }) => void;
    onWorking?: (workingState: { reason: string; followUpAction?: string }) => void;
    onBackgroundTaskStarted?: (taskId: string, description: string) => void;
    onBackgroundTaskComplete?: (taskId: string, description: string, result: string) => void;
    onEnabled?: () => void;
    onDisabled?: () => void;
    onError?: (error: string) => void;
  }> = new Map();

  enableVoiceOnTerminal(
    terminalId: string,
    model: string | undefined,
    callbacks: {
      onTranscription?: (text: string) => void;
      onProgress?: (text: string) => void;
      onSpeaking?: (text: string, audioData: string, isComplete?: boolean) => void;
      onAppControl?: (control: { action: string; target?: string; params?: Record<string, unknown> }) => void;
      onWorking?: (workingState: { reason: string; followUpAction?: string }) => void;
      onBackgroundTaskStarted?: (taskId: string, description: string) => void;
      onBackgroundTaskComplete?: (taskId: string, description: string, result: string) => void;
      onEnabled?: () => void;
      onDisabled?: () => void;
      onError?: (error: string) => void;
    }
  ) {
    console.log('[BridgeService] enableVoiceOnTerminal called for:', terminalId, 'with model:', model);
    this.voiceTerminalCallbacks.set(terminalId, callbacks);
    this.send({ type: 'voice_terminal_enable', terminalId, model });
    console.log('[BridgeService] Sent voice_terminal_enable message');
  }

  disableVoiceOnTerminal(terminalId: string) {
    this.send({ type: 'voice_terminal_disable', terminalId });
    this.voiceTerminalCallbacks.delete(terminalId);
  }

  sendVoiceAudioToTerminal(
    terminalId: string,
    audioData: string,
    mimeType: string = 'audio/wav',
    screenCapture?: string,
    terminalContent?: string,
    appState?: {
      currentTab: string;
      projectName?: string;
      projectId?: string;
      hasPreview?: boolean;
      fileCount?: number;
    }
  ) {
    this.send({
      type: 'voice_terminal_audio',
      terminalId,
      audioData,
      audioMimeType: mimeType,
      screenCapture,  // Base64 PNG of phone screen for vision
      terminalContent, // Recent terminal output for context
      appState  // Current app state
    } as any);  // Cast to any since WSMessage type doesn't include all fields
  }

  // Notify server that user interrupted voice session
  sendVoiceInterrupt(terminalId: string) {
    this.send({
      type: 'voice_interrupt',
      terminalId
    });
  }

  // Preview server management
  private previewCallbacks: Map<string, (response: { url?: string; port?: number; running?: boolean }) => void> = new Map();
  private previewErrorCallbacks: Map<string, (error: string, errorType: 'error' | 'warn' | 'info') => void> = new Map();

  async startPreview(
    projectId: string,
    onError?: (error: string, errorType: 'error' | 'warn' | 'info') => void
  ): Promise<{ url: string; port: number }> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected()) {
        reject(new Error('Not connected'));
        return;
      }


      // Register error callback if provided
      if (onError) {
        this.previewErrorCallbacks.set(projectId, onError);
      }

      this.pendingResolvers.set('preview_started', (response: { previewUrl: string; previewPort: number }) => {
        resolve({ url: response.previewUrl, port: response.previewPort });
      });

      this.send({ type: 'preview_start', projectId });

      setTimeout(() => {
        if (this.pendingResolvers.has('preview_started')) {
          this.pendingResolvers.delete('preview_started');
          this.previewErrorCallbacks.delete(projectId);
          reject(new Error('Timeout starting preview'));
        }
      }, 60000); // 60 second timeout for npm install + expo start
    });
  }

  // Unregister preview error callback (call when leaving preview or project changes)
  clearPreviewErrorCallback(projectId: string): void {
    this.previewErrorCallbacks.delete(projectId);
  }

  async stopPreview(projectId: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected()) {
        reject(new Error('Not connected'));
        return;
      }


      this.pendingResolvers.set('preview_stopped', (response: { stopped: boolean }) => {
        resolve(response.stopped);
      });

      this.send({ type: 'preview_stop', projectId });

      setTimeout(() => {
        if (this.pendingResolvers.has('preview_stopped')) {
          this.pendingResolvers.delete('preview_stopped');
          reject(new Error('Timeout stopping preview'));
        }
      }, 10000);
    });
  }

  async getPreviewStatus(projectId: string): Promise<{ running: boolean; url?: string; port?: number }> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected()) {
        reject(new Error('Not connected'));
        return;
      }

      this.pendingResolvers.set('preview_status', (response: { previewRunning: boolean; previewUrl?: string; previewPort?: number }) => {
        resolve({
          running: response.previewRunning,
          url: response.previewUrl,
          port: response.previewPort
        });
      });

      this.send({ type: 'preview_status', projectId });

      setTimeout(() => {
        if (this.pendingResolvers.has('preview_status')) {
          this.pendingResolvers.delete('preview_status');
          reject(new Error('Timeout getting preview status'));
        }
      }, 5000);
    });
  }

  // Event listeners
  onConnect(callback: ConnectionCallback) {
    this.onConnectCallback = callback;
  }

  onDisconnect(callback: ConnectionCallback) {
    this.onDisconnectCallback = callback;
  }

  onProjects(callback: ProjectsCallback) {
    this.onProjectsCallback = callback;
  }

  onProjectCreated(callback: ProjectCreatedCallback) {
    this.onProjectCreatedCallback = callback;
  }
}

export const bridgeService = new BridgeService();
