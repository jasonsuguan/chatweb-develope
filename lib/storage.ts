import type { AssetRecord, ChatRoom, ChatSettings } from "@/types/chat";

const STORAGE_KEY = "custom-chat-web-state";

const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  preset: "general",
  model: "gemini-2.5-flash",
  modelRoutingMode: "manual",
  enableTaskPlanner: true,
  plannerModel: "gemini-2.5-flash-lite",
  requireActionConfirmation: false,
  systemPrompt:
    "You are a helpful AI assistant. Give clear, practical, and friendly answers in Traditional Chinese unless the user asks for another language.",
  temperature: 0.7,
  topP: 0.95,
  topK: 40,
  maxOutputTokens: 2048,
  memoryTurns: 6,
};

function normalizeChatSettings(value: unknown): ChatSettings {
  if (typeof value !== "object" || value === null) {
    return DEFAULT_CHAT_SETTINGS;
  }

  return {
    ...DEFAULT_CHAT_SETTINGS,
    ...(value as Partial<ChatSettings>),
    modelRoutingMode:
      (value as Partial<ChatSettings>).modelRoutingMode === "auto"
        ? "auto"
        : "manual",
  };
}

export function loadChatState(): {
  chats: ChatRoom[];
  activeChatId: number | null;
  longTermMemories: string[];
  assetLibrary: AssetRecord[];
} | null {
  if (typeof window === "undefined") return null;

  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    return {
      chats: Array.isArray(parsed.chats)
        ? parsed.chats.map((chat: ChatRoom) => ({
            ...chat,
            settings: normalizeChatSettings(chat.settings),
          }))
        : [],
      activeChatId:
        parsed.activeChatId === -1 || parsed.activeChatId == null
          ? null
          : parsed.activeChatId,
      longTermMemories: Array.isArray(parsed.longTermMemories)
        ? parsed.longTermMemories.filter(
            (item: unknown): item is string => typeof item === "string"
          )
        : [],
      assetLibrary: Array.isArray(parsed.assetLibrary)
        ? parsed.assetLibrary.filter(
            (item: unknown): item is AssetRecord =>
              typeof item === "object" &&
              item !== null &&
              typeof (item as AssetRecord).id === "string" &&
              typeof (item as AssetRecord).kind === "string" &&
              typeof (item as AssetRecord).dataUrl === "string"
          )
        : [],
    };
  } catch {
    return null;
  }
}

export function saveChatState(data: {
  chats: ChatRoom[];
  activeChatId: number | null;
  longTermMemories: string[];
  assetLibrary: AssetRecord[];
}) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}
