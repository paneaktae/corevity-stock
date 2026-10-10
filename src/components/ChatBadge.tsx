import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../lib';
import type { ChatPage } from '../../shared/schemas';
import { t } from '../i18n';

export function ChatBadge() {
  const { pathname } = useLocation();
  const [count, setCount] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    let socket: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout>;
    let cursor = 0;
    let email = '';
    let initialized = false;
    const pending = new Set<number>();
    const key = () => `corevity:chat-read:${email}`;
    const read = () => {
      try { return Number(localStorage.getItem(key())) || 0; }
      catch { return 0; }
    };
    async function sync() {
      if (busy || controller.signal.aborted || document.hidden) return;
      busy = true;
      try {
        if (!initialized) {
          const page = await api<ChatPage>('/chat', { signal: controller.signal });
          email = page.userEmail;
          cursor = read();
          initialized = true;
        }
        let more = true;
        while (more && !controller.signal.aborted) {
          const page = await api<ChatPage>(`/chat?after=${cursor}`, { signal: controller.signal });
          for (const message of page.messages) {
            cursor = Math.max(cursor, message.id);
            if (message.senderEmail !== email) pending.add(message.id);
          }
          more = page.hasMore;
        }
        if (controller.signal.aborted) return;
        if (pathname === '/chat' && !document.hidden && document.hasFocus()) {
          try { localStorage.setItem(key(), String(cursor)); } catch { /* Storage may be disabled. */ }
          pending.clear();
        }
        const seen = read();
        for (const id of pending) if (id <= seen) pending.delete(id);
        setCount(pending.size);
      } catch { /* Retry on the next connection event or poll. */ }
      finally { busy = false; }
    }
    function connect() {
      if (controller.signal.aborted) return;
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/chat/socket`);
      socket.onopen = () => void sync();
      socket.onmessage = () => void sync();
      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        if (!controller.signal.aborted) retry = setTimeout(connect, 5000);
      };
    }
    const refresh = () => void sync();
    void sync();
    connect();
    const timer = setInterval(refresh, 5000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      controller.abort();
      clearInterval(timer);
      clearTimeout(retry);
      socket?.close();
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [pathname]);
  return count ? <span className="chat-unread-badge" role="status" aria-label={`${t('Unread messages')}: ${count}`}>{count > 99 ? '99+' : count}</span> : null;
}
