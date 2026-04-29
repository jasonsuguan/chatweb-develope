"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ChatInput from "@/components/chat/ChatInput";
import ImageLibraryModal from "@/components/chat/ImageLibraryModal";
import ChatMessages from "@/components/chat/ChatMessages";
import ChatSettingsPanel from "@/components/chat/ChatSettingsPanel";
import ChatSidebar from "@/components/chat/ChatSidebar";
import { loadChatState, saveChatState } from "@/lib/storage";
import type {
  AssetKind,
  AssetRecord,
  ChatPreset,
  ChatRequestMessage,
  ChatRoom,
  ChatSettings,
  Message,
  MessageDiagnostics,
  MessageAttachment,
  PendingUpload,
  StreamChunk,
} from "@/types/chat";

type ThemeMode = "dark" | "light";
type WeatherScene = "sunny" | "cloudy" | "rainy";

const GENERAL_SYSTEM_PROMPT =
  "You are a helpful AI assistant. Give clear, practical, and friendly answers in Traditional Chinese unless the user asks for another language.";

const CODING_SYSTEM_PROMPT =
  "You are a coding assistant. Explain clearly, write reliable code, and highlight tradeoffs or edge cases when they matter. Prefer Traditional Chinese unless the user asks for another language.";

const MAX_UPLOAD_SIZE_BYTES = 4 * 1024 * 1024;

const defaultChatSettings: ChatSettings = {
  preset: "general",
  model: "gemini-2.5-flash",
  modelRoutingMode: "manual",
  enableTaskPlanner: true,
  plannerModel: "gemini-2.5-flash-lite",
  requireActionConfirmation: false,
  systemPrompt: GENERAL_SYSTEM_PROMPT,
  temperature: 0.7,
  topP: 0.95,
  topK: 40,
  maxOutputTokens: 2048,
  memoryTurns: 6,
};

const defaultChats: ChatRoom[] = [
  {
    id: 1,
    name: "歡迎",
    summary: "開始新的對話",
    memorySummary: "",
    lastTaskPlan: null,
    lastTaskExecution: [],
    settings: defaultChatSettings,
    messages: [
      {
        id: 1,
        role: "assistant",
        content:
          "這裡是你的 AI chat web。現在支援文字、圖片與 PDF 上傳。你也可以在左側開啟圖片圖庫，查看之前傳過的圖片並跳回原本聊天室。",
      },
    ],
  },
];

const THEME_KEY = "chatweb-theme";

function sanitizeWelcomeMessage(content: string) {
  if (!content.trim() || /[?銝]/.test(content)) {
    return "歡迎來到你的 AI Chat Web。你可以直接聊天，也可以上傳圖片、PDF 與音訊，並搭配工具、記憶與多模型功能完成任務。";
  }

  return content;
}

function sanitizeChatsForDisplay(chatRooms: ChatRoom[]) {
  return chatRooms.map((chat) => ({
    ...chat,
    messages: chat.messages.map((message, index) =>
      message.role === "assistant" && index === 0
        ? {
            ...message,
            content: sanitizeWelcomeMessage(message.content),
          }
        : message
    ),
  }));
}

function localizeMessageLabel(text: string, attachments: MessageAttachment[] = []) {
  if (text.trim()) return text.trim();
  if (attachments.length > 0) return attachments[0].name;
  return "新訊息";
}

function stripLocalizedLeadingFiller(text: string) {
  return text
    .replace(/^(請問|請幫我|幫我|可以幫我|麻煩你)\s*/u, "")
    .replace(/^(please|can you|could you|help me)\s*/iu, "")
    .trim();
}

function normalizeLocalizedSnippet(text: string) {
  return text.replace(/\s+/g, " ").replace(/[“”"'`]/g, "").trim();
}

function compactLocalizedTitle(text: string, maxLength = 24) {
  const normalized = normalizeLocalizedSnippet(stripLocalizedLeadingFiller(text));
  const firstSegment = normalized.split(/[，。！？\n:]/u).find(Boolean)?.trim() ?? normalized;

  if (!firstSegment) return "新對話";
  if (firstSegment.length <= maxLength) return firstSegment;
  return `${firstSegment.slice(0, maxLength - 1).trim()}…`;
}

function compactLocalizedSummary(text: string, maxLength = 52) {
  const normalized = normalizeLocalizedSnippet(text);
  if (!normalized) return "目前尚無摘要";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trim()}…`;
}

function buildLocalizedAttachmentSummary(attachments: MessageAttachment[]) {
  if (attachments.length === 0) return "";

  const labels = attachments.map((attachment) => {
    if (attachment.kind === "image") return `圖片：${attachment.name}`;
    if (attachment.kind === "audio") return `音訊：${attachment.name}`;
    return `PDF：${attachment.name}`;
  });

  return labels.join("、");
}

function buildLocalizedChatMetadata(messages: Message[], memorySummary = "") {
  const userMessages = messages.filter((message) => message.role === "user");
  const firstUserMessage = userMessages.find(
    (message) => message.content.trim() || (message.attachments?.length ?? 0) > 0
  );
  const latestUserMessage = [...userMessages].reverse().find(
    (message) => message.content.trim() || (message.attachments?.length ?? 0) > 0
  );

  const titleSource =
    firstUserMessage?.content.trim() ||
    buildLocalizedAttachmentSummary(firstUserMessage?.attachments ?? []) ||
    latestUserMessage?.content.trim() ||
    buildLocalizedAttachmentSummary(latestUserMessage?.attachments ?? []) ||
    "新對話";

  const summarySource =
    latestUserMessage?.content.trim() ||
    memorySummary.trim() ||
    buildLocalizedAttachmentSummary(latestUserMessage?.attachments ?? []) ||
    "目前尚無摘要";

  return {
    name: compactLocalizedTitle(titleSource),
    summary: compactLocalizedSummary(summarySource),
  };
}

function buildLocalizedModelSwitchNotice(
  data: Extract<StreamChunk, { type: "modelStatus" }>
) {
  const fromModel = data.routedModel ?? data.requestedModel;
  const reason = data.fallbackReason ?? "原本的模型暫時無法處理這次請求。";

  return {
    id: `${Date.now()}-${data.activeModel}`,
    title: "已自動切換模型",
    description: `${reason} 已從 ${fromModel} 切換為 ${data.activeModel}。`,
  };
}

function getPresetLabel(preset: ChatPreset) {
  if (preset === "general") return "一般";
  if (preset === "coding") return "程式";
  return "自訂";
}

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function inferAssetKind(file: File): AssetKind | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    return "pdf";
  }
  if (file.type.startsWith("audio/")) return "audio";

  return null;
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function buildHydratedMessages(
  messages: Message[],
  assetLibrary: AssetRecord[]
): ChatRequestMessage[] {
  const assetsById = new Map(assetLibrary.map((asset) => [asset.id, asset]));

  return messages.map((message) => ({
    ...message,
    attachments: (message.attachments ?? [])
      .map((attachment) => {
        const asset = assetsById.get(attachment.assetId);
        if (!asset) return null;

        return {
          ...attachment,
          dataUrl: asset.dataUrl,
        };
      })
      .filter((attachment): attachment is NonNullable<typeof attachment> => Boolean(attachment)),
  }));
}

function buildMessageLabel(text: string, attachments: MessageAttachment[] = []) {
  if (text.trim()) return text.trim();
  if (attachments.length > 0) return attachments[0].name;
  return "新訊息";
}

function stripLeadingFiller(text: string) {
  return text
    .replace(/^(請問|請|幫我|我想|我希望|可以|可否|想請問|想問一下)\s*/u, "")
    .replace(/^(please|can you|could you|help me)\s*/iu, "")
    .trim();
}

function normalizeSnippet(text: string) {
  return text.replace(/\s+/g, " ").replace(/[「」"'`]/g, "").trim();
}

function toCompactTitle(text: string, maxLength = 24) {
  const normalized = normalizeSnippet(stripLeadingFiller(text));
  const firstSegment =
    normalized.split(/[，。！？!?\n:：]/u).find(Boolean)?.trim() ?? normalized;

  if (!firstSegment) return "New chat";
  if (firstSegment.length <= maxLength) return firstSegment;
  return `${firstSegment.slice(0, maxLength - 1).trim()}…`;
}

function toCompactSummary(text: string, maxLength = 52) {
  const normalized = normalizeSnippet(text);
  if (!normalized) return "No summary yet";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trim()}…`;
}

function buildAttachmentSummary(attachments: MessageAttachment[]) {
  if (attachments.length === 0) return "";

  const labels = attachments.map((attachment) => {
    if (attachment.kind === "image") return `image: ${attachment.name}`;
    if (attachment.kind === "audio") return `audio: ${attachment.name}`;
    return `pdf: ${attachment.name}`;
  });

  return labels.join(", ");
}

function buildChatMetadata(messages: Message[], memorySummary = "") {
  const userMessages = messages.filter((message) => message.role === "user");
  const firstUserMessage = userMessages.find(
    (message) => message.content.trim() || (message.attachments?.length ?? 0) > 0
  );
  const latestUserMessage = [...userMessages].reverse().find(
    (message) => message.content.trim() || (message.attachments?.length ?? 0) > 0
  );

  const titleSource =
    firstUserMessage?.content.trim() ||
    buildAttachmentSummary(firstUserMessage?.attachments ?? []) ||
    latestUserMessage?.content.trim() ||
    buildAttachmentSummary(latestUserMessage?.attachments ?? []) ||
    "New chat";

  const summarySource =
    latestUserMessage?.content.trim() ||
    memorySummary.trim() ||
    buildAttachmentSummary(latestUserMessage?.attachments ?? []) ||
    "No summary yet";

  return {
    name: toCompactTitle(titleSource),
    summary: toCompactSummary(summarySource),
  };
}

function buildModelSwitchNotice(data: Extract<StreamChunk, { type: "modelStatus" }>) {
  const fromModel = data.routedModel ?? data.requestedModel;
  const reason =
    data.fallbackReason ?? "The previous model could not handle this request.";

  return {
    id: `${Date.now()}-${data.activeModel}`,
    title: "Model switched automatically",
    description: `${reason} Switched from ${fromModel} to ${data.activeModel}.`,
  };
}

void buildMessageLabel;
void buildChatMetadata;
void buildModelSwitchNotice;

function isWeatherRequest(message: Message | undefined) {
  const text = message?.content.toLowerCase() ?? "";
  return /天氣|氣溫|下雨|weather|forecast|rain|sunny|cloud/i.test(text);
}

function inferWeatherScene(reply: string): WeatherScene | null {
  const text = reply.toLowerCase();

  if (
    /雷雨|暴雨|陣雨|雨天|下雨|thunderstorm|rain|showers|drizzle|storm/.test(
      text
    )
  ) {
    return "rainy";
  }

  if (/多雲|陰天|陰時多雲|cloud|overcast|fog|mist/.test(text)) {
    return "cloudy";
  }

  if (/晴天|晴朗|陽光|clear sky|mainly clear|sunny/.test(text)) {
    return "sunny";
  }

  return null;
}

function PixelCloud({
  className,
  tone = "light",
}: {
  className: string;
  tone?: "light" | "dark";
}) {
  const block = tone === "dark" ? "bg-slate-400/70" : "bg-white/80";
  const soft = tone === "dark" ? "bg-slate-300/55" : "bg-slate-100/85";

  return (
    <div className={`absolute ${className}`}>
      <div className="relative h-24 w-40">
        <span className={`absolute left-4 top-10 h-5 w-8 rounded-sm ${soft}`} />
        <span className={`absolute left-10 top-5 h-6 w-8 rounded-sm ${block}`} />
        <span className={`absolute left-[4.5rem] top-1 h-7 w-9 rounded-sm ${block}`} />
        <span className={`absolute left-28 top-8 h-6 w-8 rounded-sm ${soft}`} />
        <span className={`absolute left-2 top-16 h-5 w-10 rounded-sm ${soft}`} />
        <span className={`absolute left-12 top-[3.25rem] h-7 w-12 rounded-sm ${block}`} />
        <span className={`absolute left-[6.5rem] top-12 h-7 w-10 rounded-sm ${block}`} />
        <span className={`absolute left-34 top-[4.25rem] h-5 w-9 rounded-sm ${soft}`} />
      </div>
    </div>
  );
}

export default function Page() {
  const [chats, setChats] = useState<ChatRoom[]>(() => sanitizeChatsForDisplay(defaultChats));
  const [activeChatId, setActiveChatId] = useState<number | null>(1);
  const [focusedMessageId, setFocusedMessageId] = useState<number | null>(null);
  const [longTermMemories, setLongTermMemories] = useState<string[]>([]);
  const [assetLibrary, setAssetLibrary] = useState<AssetRecord[]>([]);
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [showSettings, setShowSettings] = useState(true);
  const [showLibrary, setShowLibrary] = useState(false);
  const [modelSwitchNotice, setModelSwitchNotice] = useState<{
    id: string;
    title: string;
    description: string;
  } | null>(null);
  const [weatherScene, setWeatherScene] = useState<{
    id: string;
    type: WeatherScene;
  } | null>(null);
  const [theme, setTheme] = useState<ThemeMode>("dark");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const saved = loadChatState();
    if (saved) {
      setChats(
        sanitizeChatsForDisplay(saved.chats.length > 0 ? saved.chats : defaultChats)
      );
      setActiveChatId(saved.activeChatId ?? saved.chats[0]?.id ?? 1);
      setLongTermMemories(saved.longTermMemories ?? []);
      setAssetLibrary(saved.assetLibrary ?? []);
    }

    const savedTheme = localStorage.getItem(THEME_KEY) as ThemeMode | null;
    if (savedTheme === "dark" || savedTheme === "light") {
      setTheme(savedTheme);
    }
  }, []);

  useEffect(() => {
    saveChatState({ chats, activeChatId, longTermMemories, assetLibrary });
  }, [chats, activeChatId, longTermMemories, assetLibrary]);

  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (!modelSwitchNotice) return;

    const timer = window.setTimeout(() => {
      setModelSwitchNotice((current) =>
        current?.id === modelSwitchNotice.id ? null : current
      );
    }, 4200);

    return () => window.clearTimeout(timer);
  }, [modelSwitchNotice]);

  useEffect(() => {
    if (!weatherScene) return;

    const timer = window.setTimeout(() => {
      setWeatherScene((current) =>
        current?.id === weatherScene.id ? null : current
      );
    }, 5200);

    return () => window.clearTimeout(timer);
  }, [weatherScene]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chats, activeChatId, isStreaming]);

  useEffect(() => {
    if (focusedMessageId == null) return;

    const target = document.getElementById(`message-${focusedMessageId}`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    const timer = window.setTimeout(() => {
      setFocusedMessageId((current) =>
        current === focusedMessageId ? null : current
      );
    }, 2400);

    return () => window.clearTimeout(timer);
  }, [focusedMessageId, activeChatId]);

  const activeChat = useMemo(
    () => chats.find((chat) => chat.id === activeChatId) ?? null,
    [chats, activeChatId]
  );

  const assetCount = useMemo(
    () => assetLibrary.length,
    [assetLibrary]
  );

  const themeClasses =
    theme === "dark"
      ? {
          page:
            "bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.10),transparent_28%),radial-gradient(circle_at_top_right,rgba(59,130,246,0.16),transparent_30%),linear-gradient(180deg,#05070b_0%,#0a0d14_100%)] text-white",
          main: "bg-white/[0.03]",
          headerBorder: "border-white/10",
          muted: "text-white/55",
          button:
            "border-white/10 bg-white/5 text-white/85 hover:bg-white/10",
        }
      : {
          page:
            "bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.12),transparent_28%),radial-gradient(circle_at_top_right,rgba(59,130,246,0.16),transparent_30%),linear-gradient(180deg,#eef6ff_0%,#f7fbff_100%)] text-slate-900",
          main: "bg-white/70 backdrop-blur-md",
          headerBorder: "border-slate-200/80",
          muted: "text-slate-500",
          button:
            "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
        };

  function updateActiveChat(updater: (chat: ChatRoom) => ChatRoom) {
    if (activeChatId === null) return;

    setChats((prev) =>
      prev.map((chat) => (chat.id === activeChatId ? updater(chat) : chat))
    );
  }

  function updateSettings<K extends keyof ChatSettings>(
    key: K,
    value: ChatSettings[K]
  ) {
    updateActiveChat((chat) => ({
      ...chat,
      settings: {
        ...chat.settings,
        [key]: value,
      },
    }));
  }

  function updatePreset(preset: ChatPreset) {
    updateActiveChat((chat) => {
      let nextPrompt = chat.settings.systemPrompt;

      if (preset === "general") {
        nextPrompt = GENERAL_SYSTEM_PROMPT;
      } else if (preset === "coding") {
        nextPrompt = CODING_SYSTEM_PROMPT;
      }

      return {
        ...chat,
        settings: {
          ...chat.settings,
          preset,
          systemPrompt: nextPrompt,
        },
      };
    });
  }

  function updateSystemPrompt(value: string) {
    updateActiveChat((chat) => {
      const trimmed = value.trim();

      let nextPreset: ChatPreset = "custom";

      if (trimmed === GENERAL_SYSTEM_PROMPT.trim()) {
        nextPreset = "general";
      } else if (trimmed === CODING_SYSTEM_PROMPT.trim()) {
        nextPreset = "coding";
      }

      return {
        ...chat,
        settings: {
          ...chat.settings,
          preset: nextPreset,
          systemPrompt: value,
        },
      };
    });
  }

  function createNewChat(initialLabel?: string) {
    const baseSettings = activeChat?.settings ?? defaultChatSettings;
    const timestamp = Date.now();

    const newChat: ChatRoom = {
      id: timestamp,
      name: initialLabel?.slice(0, 24) || `新對話 ${chats.length + 1}`,
      summary: initialLabel?.slice(0, 48) || "目前尚無內容",
      memorySummary: "",
      lastTaskPlan: null,
      lastTaskExecution: [],
      settings: { ...baseSettings },
      messages: initialLabel
        ? []
        : [
            {
              id: timestamp + 1,
              role: "assistant",
              content: "新的聊天室已建立。你可以輸入文字，或上傳圖片 / PDF 後直接提問。",
            },
          ],
    };

    setChats((prev) => sanitizeChatsForDisplay([newChat, ...prev]));
    setActiveChatId(newChat.id);
    return newChat;
  }

  function deleteChat(chatId: number) {
    const nextChats = chats.filter((chat) => chat.id !== chatId);
    setChats(nextChats);

    if (activeChatId !== chatId) return;
    setActiveChatId(nextChats[0]?.id ?? null);
  }

  function clearActiveChatMessages() {
    if (!activeChat) return;

    updateActiveChat((chat) => ({
      ...chat,
      summary: "已清除對話內容",
      lastTaskPlan: null,
      lastTaskExecution: [],
      messages: [],
    }));
  }

  function clearActiveChatMemory() {
    if (!activeChat) return;

    updateActiveChat((chat) => ({
      ...chat,
      memorySummary: "",
    }));
  }

  function clearLongTermMemory() {
    setLongTermMemories([]);
  }

  function deleteAsset(assetId: string) {
    setAssetLibrary((prev) => prev.filter((asset) => asset.id !== assetId));
    setPendingUploads((prev) => prev.filter((upload) => upload.id !== assetId));
    setChats((prev) =>
      prev.map((chat) => ({
        ...chat,
        messages: chat.messages.map((message) => ({
          ...message,
          attachments: (message.attachments ?? []).filter(
            (attachment) => attachment.assetId !== assetId
          ),
        })),
      }))
    );
  }

  function goToMessage(chatId: number, messageId: number) {
    setActiveChatId(chatId);
    setFocusedMessageId(messageId);
  }

  async function handleSelectFiles(files: FileList | File[] | null) {
    const normalizedFiles = files ? Array.from(files) : [];
    if (normalizedFiles.length === 0) return;

    const validFiles: File[] = [];
    const invalidFiles: string[] = [];
    const tooLargeFiles: string[] = [];

    for (const file of normalizedFiles) {
      const kind = inferAssetKind(file);

      if (!kind) {
        invalidFiles.push(file.name);
        continue;
      }

      if (file.size > MAX_UPLOAD_SIZE_BYTES) {
        tooLargeFiles.push(file.name);
        continue;
      }

      validFiles.push(file);
    }

    if (invalidFiles.length > 0) {
      window.alert(
        `不支援的檔案類型：\n${invalidFiles.join("\n")}\n\n目前只支援圖片、音訊與 PDF。`
      );
    }

    if (tooLargeFiles.length > 0) {
      window.alert(
        `以下檔案過大：\n${tooLargeFiles.join("\n")}\n\n請將每個檔案控制在 4 MB 以下。`
      );
    }

    if (validFiles.length === 0) return;

    const uploads = await Promise.all(
      validFiles.map(async (file) => {
        const kind = inferAssetKind(file);
        const dataUrl = await readFileAsDataUrl(file);

        return {
          id: createId(),
          kind: kind!,
          name: file.name,
          mimeType:
            file.type ||
            (kind === "pdf"
              ? "application/pdf"
              : kind === "audio"
              ? "audio/webm"
              : "image/png"),
          dataUrl,
          size: file.size,
        } satisfies PendingUpload;
      })
    );

    setPendingUploads((prev) => [...prev, ...uploads]);
  }

  function removePendingUpload(id: string) {
    setPendingUploads((prev) => prev.filter((upload) => upload.id !== id));
  }

  async function streamAssistantReply(
    targetChatId: number,
    currentMessages: Message[],
    currentAssetLibrary: AssetRecord[]
  ) {
    const targetChat =
      chats.find((chat) => chat.id === targetChatId) ??
      (activeChat?.id === targetChatId ? activeChat : null);

    const settings = targetChat?.settings ?? defaultChatSettings;
    const memorySummary = targetChat?.memorySummary ?? "";
    const assistantPlaceholderId = Date.now() + 1000;
    const latestUserMessage = [...currentMessages]
      .reverse()
      .find((message) => message.role === "user");

    setChats((prev) =>
      prev.map((chat) =>
        chat.id === targetChatId
          ? {
              ...chat,
              messages: [
                ...chat.messages,
                {
                  id: assistantPlaceholderId,
                  role: "assistant",
                  content: "",
                  diagnostics: {},
                },
              ],
            }
          : chat
      )
    );

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chatId: targetChatId,
          model: settings.model,
          modelRoutingMode: settings.modelRoutingMode,
          enableTaskPlanner: settings.enableTaskPlanner,
          plannerModel: settings.plannerModel,
          requireActionConfirmation: settings.requireActionConfirmation,
          systemPrompt: settings.systemPrompt,
          messages: buildHydratedMessages(currentMessages, currentAssetLibrary),
          memorySummary,
          longTermMemories,
          generationConfig: {
            temperature: settings.temperature,
            topP: settings.topP,
            topK: settings.topK,
            maxOutputTokens: settings.maxOutputTokens,
          },
          memoryTurns: settings.memoryTurns,
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalText = "";
      let currentDiagnostics: MessageDiagnostics = {};

      function updateAssistantDiagnostics(nextDiagnostics: MessageDiagnostics) {
        currentDiagnostics = nextDiagnostics;
        setChats((prev) =>
          prev.map((chat) =>
            chat.id === targetChatId
              ? {
                  ...chat,
                  messages: chat.messages.map((msg) =>
                    msg.id === assistantPlaceholderId
                      ? {
                          ...msg,
                          diagnostics: nextDiagnostics,
                        }
                      : msg
                  ),
                }
              : chat
          )
        );
      }

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;

          const data = JSON.parse(line) as StreamChunk;

          if (data.type === "delta") {
            finalText += data.text;

            setChats((prev) =>
              prev.map((chat) =>
                chat.id === targetChatId
                  ? {
                      ...chat,
                      messages: chat.messages.map((msg) =>
                        msg.id === assistantPlaceholderId
                          ? {
                              ...msg,
                              content: finalText,
                              diagnostics: currentDiagnostics,
                            }
                          : msg
                      ),
                    }
                  : chat
              )
            );
          }

          if (data.type === "memorySummary") {
            setChats((prev) =>
              prev.map((chat) =>
                chat.id === targetChatId
                  ? {
                      ...chat,
                      ...buildLocalizedChatMetadata(chat.messages, data.text),
                      memorySummary: data.text,
                    }
                  : chat
              )
            );
          }

          if (data.type === "taskPlan") {
            updateAssistantDiagnostics({
              ...currentDiagnostics,
              taskPlan: data.plan,
            });
          }

          if (data.type === "taskExecution") {
            updateAssistantDiagnostics({
              ...currentDiagnostics,
              taskExecution: data.results,
            });
          }

          if (data.type === "longTermMemory") {
            setLongTermMemories(data.items);
          }

          if (data.type === "modelStatus" && data.didFallback) {
            updateAssistantDiagnostics({
              ...currentDiagnostics,
              modelStatus: data,
            });
            setModelSwitchNotice(buildLocalizedModelSwitchNotice(data));
            setChats((prev) =>
              prev.map((chat) =>
                chat.id === targetChatId && chat.settings.modelRoutingMode === "manual"
                  ? {
                      ...chat,
                      settings: {
                        ...chat.settings,
                        model: data.activeModel,
                      },
                    }
                  : chat
              )
            );
          }

          if (data.type === "modelStatus" && !data.didFallback) {
            updateAssistantDiagnostics({
              ...currentDiagnostics,
              modelStatus: data,
            });
          }

          if (data.type === "error") {
            updateAssistantDiagnostics({
              ...currentDiagnostics,
              error: data.message,
            });
            throw new Error(data.message);
          }
        }
      }

      if (theme === "light" && isWeatherRequest(latestUserMessage)) {
        const scene = inferWeatherScene(finalText);
        if (scene) {
          setWeatherScene({
            id: `${Date.now()}-${scene}`,
            type: scene,
          });
        }
      }
    } catch (error) {
      console.error(error);

      setChats((prev) =>
        prev.map((chat) =>
          chat.id === targetChatId
            ? {
                ...chat,
                messages: chat.messages.map((msg) =>
                  msg.id === assistantPlaceholderId
                    ? {
                        ...msg,
                        content: "抱歉，這次回覆失敗了，請再試一次。",
                      }
                    : msg
                ),
              }
            : chat
        )
      );
    }
  }

  async function handleSendMessage() {
    if (isStreaming) return;
    if (!input.trim() && pendingUploads.length === 0) return;

    const text = input.trim();
    const uploadsToSend = pendingUploads;
    setInput("");
    setPendingUploads([]);
    setIsStreaming(true);

    try {
      const targetChat = activeChat ?? createNewChat(localizeMessageLabel(text));
      const userMessageId = Date.now();

      const newAssets: AssetRecord[] = uploadsToSend.map((upload) => ({
        id: upload.id,
        kind: upload.kind,
        name: upload.name,
        mimeType: upload.mimeType,
        dataUrl: upload.dataUrl,
        size: upload.size,
        uploadedAt: new Date().toISOString(),
        sourceChatId: targetChat.id,
        sourceMessageId: userMessageId,
      }));

      const attachments: MessageAttachment[] = newAssets.map((asset) => ({
        assetId: asset.id,
        kind: asset.kind,
        name: asset.name,
        mimeType: asset.mimeType,
      }));

      const userMessage: Message = {
        id: userMessageId,
        role: "user",
        content: text,
        attachments,
      };

      const updatedAssetLibrary = [...newAssets, ...assetLibrary];
      setAssetLibrary(updatedAssetLibrary);

      const currentMessages =
        activeChat?.id === targetChat.id
          ? [...activeChat.messages, userMessage]
          : [userMessage];

      setChats((prev) =>
        prev.map((chat) =>
          chat.id === targetChat.id
            ? {
                ...chat,
                ...buildLocalizedChatMetadata(currentMessages),
                messages: currentMessages,
              }
            : chat
        )
      );

      await streamAssistantReply(targetChat.id, currentMessages, updatedAssetLibrary);
    } finally {
      setIsStreaming(false);
    }
  }

  return (
    <main className={`flex h-screen ${themeClasses.page}`}>
      {theme === "light" && weatherScene && (
        <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
          {weatherScene.type === "sunny" && (
            <>
              <div className="absolute left-[8%] top-[-8%] h-56 w-72 rounded-full bg-yellow-200/55 blur-3xl" />
              <div className="absolute left-[18%] top-[-4%] h-40 w-64 rounded-full bg-amber-100/45 blur-3xl" />
              <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-yellow-100/30 to-transparent" />
            </>
          )}

          {weatherScene.type === "cloudy" && (
            <>
              <PixelCloud
                className="left-[4%] top-[9%] animate-[cloudDrift_8s_ease-in-out_infinite]"
              />
              <PixelCloud
                className="right-[8%] top-[15%] scale-110 animate-[cloudDriftSlow_10s_ease-in-out_infinite]"
              />
            </>
          )}

          {weatherScene.type === "rainy" && (
            <>
              <PixelCloud
                className="left-[1%] top-[3%] scale-125 animate-[cloudPulse_4.2s_ease-in-out_infinite]"
                tone="dark"
              />
              <PixelCloud
                className="left-[28%] top-[1%] scale-[1.35] animate-[cloudPulse_5s_ease-in-out_infinite]"
                tone="dark"
              />
              <PixelCloud
                className="right-[6%] top-[4%] scale-[1.25] animate-[cloudPulse_4.8s_ease-in-out_infinite]"
                tone="dark"
              />
              <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-slate-500/18 to-transparent" />
            </>
          )}
        </div>
      )}

      {modelSwitchNotice && (
        <div className="pointer-events-none fixed right-5 top-5 z-50 max-w-sm">
          <div
            className={`rounded-2xl border px-4 py-3 shadow-lg backdrop-blur-md ${
              theme === "dark"
                ? "border-emerald-400/20 bg-slate-950/85 text-white"
                : "border-emerald-200 bg-white/95 text-slate-900"
            }`}
          >
            <div className="text-sm font-semibold">{modelSwitchNotice.title}</div>
            <div className={`mt-1 text-xs leading-5 ${themeClasses.muted}`}>
              {modelSwitchNotice.description}
            </div>
          </div>
        </div>
      )}

      <div className="relative z-10 flex w-full">
      <ChatSidebar
        chats={chats}
        activeChatId={activeChatId}
        assetCount={assetCount}
        onSelectChat={setActiveChatId}
        onCreateChat={() => {
          const newChat = createNewChat();
          setActiveChatId(newChat.id);
        }}
        onDeleteChat={deleteChat}
        onOpenLibrary={() => setShowLibrary(true)}
        theme={theme}
      />

      <section className={`flex min-w-0 flex-1 flex-col ${themeClasses.main}`}>
        <header
          className={`flex items-center justify-between border-b px-6 py-4 ${themeClasses.headerBorder}`}
        >
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">
              {activeChat ? activeChat.name : "目前沒有選取對話"}
            </h1>
            <p className={`mt-1 text-sm ${themeClasses.muted}`}>
              {activeChat
                ? `${activeChat.settings.model} · ${getPresetLabel(
                    activeChat.settings.preset
                  )} preset`
                : "建立一個對話後，就可以開始和助理互動。"}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() =>
                setTheme((prev) => (prev === "dark" ? "light" : "dark"))
              }
              className={`rounded-full border px-4 py-2 text-sm transition ${themeClasses.button}`}
            >
              {theme === "dark" ? "淺色模式" : "深色模式"}
            </button>

            <button
              onClick={() => setShowSettings((prev) => !prev)}
              className={`rounded-full border px-4 py-2 text-sm transition ${themeClasses.button}`}
            >
              {showSettings ? "隱藏設定" : "顯示設定"}
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            {activeChat ? (
              <ChatMessages
                messages={activeChat.messages}
                assetLibrary={assetLibrary}
                bottomRef={bottomRef}
                isStreaming={isStreaming}
                focusedMessageId={focusedMessageId}
                theme={theme}
              />
            ) : (
              <div className="flex flex-1 items-center justify-center px-6 py-10">
                <div className="max-w-2xl text-center">
                  <div className="mb-4 text-4xl">AI</div>
                  <h2 className="text-3xl font-bold">開始新的多模態對話</h2>
                  <p className={`mt-4 text-base leading-7 ${themeClasses.muted}`}>
                    這個版本支援圖片與 PDF 上傳。你可以直接附檔提問，
                    也可以從左側圖庫查看之前上傳過的圖片，並跳回原本聊天室。
                  </p>
                </div>
              </div>
            )}

            <ChatInput
              input={input}
              isStreaming={isStreaming}
              pendingUploads={pendingUploads}
              onChangeInput={setInput}
              onSelectFiles={handleSelectFiles}
              onRemoveUpload={removePendingUpload}
              onSend={handleSendMessage}
              theme={theme}
            />
          </div>

          {showSettings && activeChat && (
            <ChatSettingsPanel
              settings={activeChat.settings}
              onChangeSetting={updateSettings}
              onChangePreset={updatePreset}
              onChangeSystemPrompt={updateSystemPrompt}
              theme={theme}
              memorySummary={activeChat.memorySummary}
              longTermMemories={longTermMemories}
              onClearMemory={clearActiveChatMemory}
              onClearLongTermMemory={clearLongTermMemory}
              onClearMessages={clearActiveChatMessages}
              onDeleteChat={() => deleteChat(activeChat.id)}
            />
          )}
        </div>
      </section>
      </div>

      <ImageLibraryModal
        assets={assetLibrary}
        chats={chats}
        open={showLibrary}
        theme={theme}
        onClose={() => setShowLibrary(false)}
        onDeleteAsset={deleteAsset}
        onGoToMessage={goToMessage}
      />

      <style jsx global>{`
        @keyframes cloudDrift {
          0% {
            transform: translateX(0);
          }
          50% {
            transform: translateX(18px);
          }
          100% {
            transform: translateX(0);
          }
        }

        @keyframes cloudDriftSlow {
          0% {
            transform: translateX(0);
          }
          50% {
            transform: translateX(-22px);
          }
          100% {
            transform: translateX(0);
          }
        }

        @keyframes cloudPulse {
          0% {
            opacity: 0.5;
            transform: scale(1);
          }
          50% {
            opacity: 0.75;
            transform: scale(1.04);
          }
          100% {
            opacity: 0.5;
            transform: scale(1);
          }
        }
      `}</style>
    </main>
  );
}
