import { WebSocketServer, WebSocket } from 'ws';
import { spawn, ChildProcess } from 'child_process';
import { networkInterfaces } from 'os';

const PORT = parseInt(process.env.PORT || '8765');

interface Message {
  type: 'chat' | 'ping' | 'cancel';
  prompt?: string;
  systemPrompt?: string;
}

interface StreamResponse {
  type: 'stream' | 'done' | 'error' | 'pong' | 'connected';
  content?: string;
  error?: string;
}

function getLocalIP(): string {
  const interfaces = networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const wss = new WebSocketServer({ port: PORT });

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║           LORA BRIDGE SERVER                               ║');
console.log('╠════════════════════════════════════════════════════════════╣');
console.log(`║  Local:   ws://localhost:${PORT}`);
console.log(`║  Network: ws://${getLocalIP()}:${PORT}`);
console.log('╠════════════════════════════════════════════════════════════╣');
console.log('║  Waiting for Lora iOS app connection...                    ║');
console.log('╚════════════════════════════════════════════════════════════╝');

wss.on('connection', (ws: WebSocket) => {
  console.log('\n✅ Lora iOS app connected');

  let claudeProcess: ChildProcess | null = null;

  // Send connection confirmation
  const connectedMsg: StreamResponse = { type: 'connected' };
  ws.send(JSON.stringify(connectedMsg));

  ws.on('message', async (data: Buffer) => {
    try {
      const message: Message = JSON.parse(data.toString());

      if (message.type === 'ping') {
        const pongMsg: StreamResponse = { type: 'pong' };
        ws.send(JSON.stringify(pongMsg));
        return;
      }

      if (message.type === 'cancel') {
        if (claudeProcess) {
          claudeProcess.kill();
          claudeProcess = null;
          console.log('🛑 Request cancelled');
        }
        return;
      }

      if (message.type === 'chat' && message.prompt) {
        console.log('\n📨 Received prompt:', message.prompt.substring(0, 100) + '...');

        // Kill any existing process
        if (claudeProcess) {
          claudeProcess.kill();
        }

        // Build Claude Code arguments
        const args = [
          '--print',
          '--output-format', 'stream-json'
        ];

        // Add system prompt if provided
        if (message.systemPrompt) {
          args.push('--system-prompt', message.systemPrompt);
        }

        // Add the actual prompt
        args.push(message.prompt);

        console.log('🤖 Starting Claude Code...');

        // Spawn Claude Code process
        claudeProcess = spawn('claude', args, {
          shell: true,
          env: { ...process.env }
        });

        let responseBuffer = '';

        claudeProcess.stdout?.on('data', (chunk: Buffer) => {
          const content = chunk.toString();
          responseBuffer += content;

          // Send each chunk to the iOS app
          const streamMsg: StreamResponse = {
            type: 'stream',
            content: content
          };
          ws.send(JSON.stringify(streamMsg));
        });

        claudeProcess.stderr?.on('data', (chunk: Buffer) => {
          console.error('⚠️ Claude stderr:', chunk.toString());
        });

        claudeProcess.on('close', (code: number | null) => {
          console.log(`✅ Claude Code finished with code ${code}`);

          const doneMsg: StreamResponse = { type: 'done' };
          ws.send(JSON.stringify(doneMsg));

          claudeProcess = null;
        });

        claudeProcess.on('error', (err: Error) => {
          console.error('❌ Claude Code error:', err.message);

          const errorMsg: StreamResponse = {
            type: 'error',
            error: err.message
          };
          ws.send(JSON.stringify(errorMsg));

          claudeProcess = null;
        });
      }
    } catch (err) {
      console.error('❌ Message parsing error:', err);
      const errorMsg: StreamResponse = {
        type: 'error',
        error: 'Invalid message format'
      };
      ws.send(JSON.stringify(errorMsg));
    }
  });

  ws.on('close', () => {
    console.log('\n❌ Lora iOS app disconnected');
    if (claudeProcess) {
      claudeProcess.kill();
      claudeProcess = null;
    }
  });

  ws.on('error', (err: Error) => {
    console.error('WebSocket error:', err.message);
  });
});

wss.on('error', (err: Error) => {
  console.error('Server error:', err.message);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\nShutting down Lora Bridge Server...');
  wss.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
