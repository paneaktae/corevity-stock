import { DurableObject } from 'cloudflare:workers';
import type { ChatMessage } from '../shared/schemas';
import type { Bindings } from './auth';

type ChatPresenceUser = { email: string; name: string };
type ChatEvent =
  | { type: 'chat.message'; message: ChatMessage }
  | { type: 'chat.presence'; users: ChatPresenceUser[] };

export class ChatRoom extends DurableObject<Bindings> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket')
      return new Response('Expected WebSocket upgrade', { status: 426 });

    const email = request.headers.get('X-Chat-User-Email')?.trim().toLowerCase();
    const name = request.headers.get('X-Chat-User-Name')?.trim();
    if (!email || !name)
      return new Response('Missing authenticated chat identity', {
        status: 401,
      });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ email, name } satisfies ChatPresenceUser);
    this.broadcastPresence();
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

  webSocketClose(): void {
    this.broadcastPresence();
  }

  webSocketError(): void {
    this.broadcastPresence();
  }

  private broadcastPresence(): void {
    const users = new Map<string, ChatPresenceUser>();
    for (const socket of this.ctx.getWebSockets()) {
      const user = socket.deserializeAttachment() as ChatPresenceUser | null;
      if (user?.email && user.name) users.set(user.email, user);
    }
    const payload = JSON.stringify({
      type: 'chat.presence',
      users: [...users.values()].sort((a, b) => a.name.localeCompare(b.name)),
    } satisfies ChatEvent);
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(payload);
      } catch {
        socket.close(1011, 'Presence update failed');
      }
    }
  }
}
