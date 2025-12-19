import { WSMessage, WSResponse } from '../../types';
import { REACT_NATIVE_SYSTEM_PROMPT } from './prompts';

type MessageCallback = (chunk: string) => void;
type ConnectionCallback = () => void;
type ErrorCallback = (error: string) => void;

class ClaudeService {
  private ws: WebSocket | null = null;
  private serverUrl: string = '';
  private onMessageCallback: MessageCallback | null = null;
  private onDoneCallback: ConnectionCallback | null = null;
  private onErrorCallback: ErrorCallback | null = null;
  private onConnectCallback: ConnectionCallback | null = null;
  private onDisconnectCallback: ConnectionCallback | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  async connect(serverUrl: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      try {
        this.serverUrl = serverUrl;
        this.cleanup();

        this.ws = new WebSocket(serverUrl);

        this.ws.onopen = () => {
          console.log('[Claude] Connected to bridge server');
          this.reconnectAttempts = 0;
          this.startPingInterval();
          resolve(true);
        };

        this.ws.onmessage = (event) => {
          try {
            const response: WSResponse = JSON.parse(event.data);
            this.handleResponse(response);
          } catch (err) {
            console.error('[Claude] Failed to parse message:', err);
          }
        };

        this.ws.onerror = (error) => {
          console.error('[Claude] WebSocket error:', error);
          this.onErrorCallback?.('Connection error');
          reject(new Error('WebSocket connection failed'));
        };

        this.ws.onclose = () => {
          console.log('[Claude] Disconnected from bridge server');
          this.cleanup();
          this.onDisconnectCallback?.();
          this.attemptReconnect();
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  private handleResponse(response: WSResponse) {
    switch (response.type) {
      case 'connected':
        this.onConnectCallback?.();
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
        this.onErrorCallback?.(response.error || 'Unknown error');
        break;
      case 'pong':
        // Connection is alive
        break;
    }
  }

  private startPingInterval() {
    this.stopPingInterval();
    this.pingInterval = setInterval(() => {
      this.ping();
    }, 30000); // Ping every 30 seconds
  }

  private stopPingInterval() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('[Claude] Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);

    console.log(`[Claude] Attempting reconnect in ${delay}ms...`);

    this.reconnectTimeout = setTimeout(() => {
      if (this.serverUrl) {
        this.connect(this.serverUrl).catch((err) => {
          console.error('[Claude] Reconnect failed:', err);
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
    this.reconnectAttempts = this.maxReconnectAttempts; // Prevent auto-reconnect
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  ping() {
    if (this.isConnected()) {
      const message: WSMessage = { type: 'ping' };
      this.ws?.send(JSON.stringify(message));
    }
  }

  cancel() {
    if (this.isConnected()) {
      const message: WSMessage = { type: 'cancel' };
      this.ws?.send(JSON.stringify(message));
    }
  }

  async sendMessage(
    prompt: string,
    options?: {
      systemPrompt?: string;
      onChunk?: MessageCallback;
      onDone?: ConnectionCallback;
      onError?: ErrorCallback;
    }
  ): Promise<void> {
    if (!this.isConnected()) {
      throw new Error('Not connected to bridge server');
    }

    this.onMessageCallback = options?.onChunk || null;
    this.onDoneCallback = options?.onDone || null;
    this.onErrorCallback = options?.onError || null;

    const message: WSMessage = {
      type: 'chat',
      prompt,
      systemPrompt: options?.systemPrompt || REACT_NATIVE_SYSTEM_PROMPT,
    };

    this.ws?.send(JSON.stringify(message));
  }

  // Event listeners
  onConnect(callback: ConnectionCallback) {
    this.onConnectCallback = callback;
  }

  onDisconnect(callback: ConnectionCallback) {
    this.onDisconnectCallback = callback;
  }
}

export const claudeService = new ClaudeService();
