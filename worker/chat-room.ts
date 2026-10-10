import { DurableObject } from 'cloudflare:workers';
import type { ChatMessage } from '../shared/schemas';
import type { Bindings } from './auth';

type ChatEvent = { type: 'chat.message'; message: ChatMessage };

export class ChatRoom extends DurableObject<Bindings> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket')
      return new Response('Expected WebSocket upgrade', { status: 426 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  broadcast(message: ChatMessage): void {
    const event: ChatEvent = { type: 'chat.message', message };
    const payload = JSON.stringify(event);
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(payload);
      } catch {
        socket.close(1011, 'Delivery failed');
      }
    }
  }

  webSocketMessage(socket: WebSocket): void {
    socket.close(1008, 'This connection receives chat updates only');
  }
}
