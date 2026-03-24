import type { ChatRoom } from "@/types/chat";

const STORAGE_KEY = "custom-chat-web-state";

export function loadChatState(): {
  chats: ChatRoom[];
  activeChatId: number | null;
} | null {
  if (typeof window === "undefined") return null;

  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    return {
      chats: parsed.chats ?? [],
      activeChatId:
        parsed.activeChatId === -1 || parsed.activeChatId == null
          ? null
          : parsed.activeChatId,
    };
  } catch {
    return null;
  }
}

export function saveChatState(data: {
  chats: ChatRoom[];
  activeChatId: number | null;
}) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}