const storageKey = 'corevity-customer-chat-read:v1';

export function getCatalogChatReadCursors(): Record<string, number> {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || '{}') as Record<string, unknown>;
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] =>
      typeof entry[0] === 'string' && Number.isSafeInteger(entry[1]) && Number(entry[1]) >= 0,
    ));
  } catch {
    return {};
  }
}

export function markCatalogChatRead(threadId: string, messageId: number) {
  if (!threadId || !Number.isSafeInteger(messageId) || messageId < 0) return;
  try {
    const cursors = getCatalogChatReadCursors();
    if ((cursors[threadId] ?? 0) >= messageId) return;
    cursors[threadId] = messageId;
    localStorage.setItem(storageKey, JSON.stringify(cursors));
    window.dispatchEvent(new Event('corevity:customer-chat-read'));
  } catch {
    // Keep the inbox usable when browser storage is unavailable.
  }
}
