"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ChatInput from "@/components/chat/ChatInput";
import ChatMessages from "@/components/chat/ChatMessages";
import ChatSettingsPanel from "@/components/chat/ChatSettingsPanel";
import ChatSidebar from "@/components/chat/ChatSidebar";
import { loadChatState, saveChatState } from "@/lib/storage";
import type {
  ChatPreset,
  ChatRoom,
  ChatSettings,
  Message,
  StreamChunk,
} from "@/types/chat";

type ThemeMode = "dark" | "light";

const GENERAL_SYSTEM_PROMPT =
  "你是一般助理，可以自然、有彈性地回答。除非使用者明確要求，否則不必過度保守或僵硬。";

const CODING_SYSTEM_PROMPT =
  "你是一位擅長教學的程式助教，請用繁體中文回答，說明要清楚、結構化、適合大學生理解，必要時提供範例。";

const defaultChatSettings: ChatSettings = {
  preset: "general",
  model: "gemini-2.5-flash",
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
    name: "新對話",
    summary: "一般助理模式",
    memorySummary: "",
    settings: defaultChatSettings,
    messages: [
      {
        id: 1,
        role: "assistant",
        content:
          "嗨，我是你的 AI 助手。\n\n你可以直接開始聊天，也可以在右側切換回答模式、模型與其他設定。",
      },
    ],
  },
];

const THEME_KEY = "chatweb-theme";

function getPresetLabel(preset: ChatPreset) {
  if (preset === "general") return "一般助理";
  if (preset === "coding") return "程式助教";
  return "自訂模式";
}

export default function Page() {
  const [chats, setChats] = useState<ChatRoom[]>(defaultChats);
  const [activeChatId, setActiveChatId] = useState<number | null>(1);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [showSettings, setShowSettings] = useState(true);
  const [theme, setTheme] = useState<ThemeMode>("dark");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const saved = loadChatState();
    if (saved) {
      setChats(saved.chats);
      setActiveChatId(saved.activeChatId ?? null);
    }

    const savedTheme = localStorage.getItem(THEME_KEY) as ThemeMode | null;
    if (savedTheme === "dark" || savedTheme === "light") {
      setTheme(savedTheme);
    }
  }, []);

  useEffect(() => {
    saveChatState({ chats, activeChatId });
  }, [chats, activeChatId]);

  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chats, activeChatId, isStreaming]);

  const activeChat = useMemo(
    () => chats.find((chat) => chat.id === activeChatId) ?? null,
    [chats, activeChatId]
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

  function createNewChat(initialMessage?: string) {
    const baseSettings = activeChat?.settings ?? defaultChatSettings;

    const newChat: ChatRoom = {
      id: Date.now(),
      name: initialMessage?.slice(0, 12) || `新聊天室 ${chats.length + 1}`,
      summary: initialMessage?.slice(0, 28) || "新的對話",
      memorySummary: "",
      settings: { ...baseSettings },
      messages: initialMessage
        ? []
        : [
            {
              id: Date.now() + 1,
              role: "assistant",
              content: "新的聊天室已建立。你想聊什麼？",
            },
          ],
    };

    setChats((prev) => [newChat, ...prev]);
    setActiveChatId(newChat.id);
    return newChat;
  }

  function deleteChat(chatId: number) {
    const nextChats = chats.filter((chat) => chat.id !== chatId);
    setChats(nextChats);

    if (activeChatId !== chatId) return;

    if (nextChats.length > 0) {
      setActiveChatId(nextChats[0].id);
    } else {
      setActiveChatId(null);
    }
  }

  function clearActiveChatMessages() {
    if (!activeChat) return;
    updateActiveChat((chat) => ({
      ...chat,
      summary: "新的對話",
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

  async function streamAssistantReply(
    targetChatId: number,
    currentMessages: Message[]
  ) {
    const targetChat =
      chats.find((chat) => chat.id === targetChatId) ??
      (activeChat?.id === targetChatId ? activeChat : null);

    const settings = targetChat?.settings ?? defaultChatSettings;
    const memorySummary = targetChat?.memorySummary ?? "";

    const assistantPlaceholderId = Date.now() + 1000;

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
          model: settings.model,
          systemPrompt: settings.systemPrompt,
          messages: currentMessages,
          memorySummary,
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
                          ? { ...msg, content: finalText }
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
                      memorySummary: data.text,
                    }
                  : chat
              )
            );
          }

          if (data.type === "error") {
            throw new Error(data.message);
          }
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
                        content: "抱歉，剛剛產生回覆時發生錯誤，請再試一次。",
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
    if (!input.trim() || isStreaming) return;

    const trimmed = input.trim();
    setInput("");
    setIsStreaming(true);

    try {
      if (activeChat) {
        const userMessage: Message = {
          id: Date.now(),
          role: "user",
          content: trimmed,
        };

        const currentMessages = [...activeChat.messages, userMessage];

        updateActiveChat((chat) => ({
          ...chat,
          summary: trimmed.slice(0, 28),
          messages: [...chat.messages, userMessage],
        }));

        await streamAssistantReply(activeChat.id, currentMessages);
      } else {
        const newChat = createNewChat(trimmed);

        const userMessage: Message = {
          id: Date.now(),
          role: "user",
          content: trimmed,
        };

        const currentMessages = [userMessage];

        setChats((prev) =>
          prev.map((chat) =>
            chat.id === newChat.id
              ? {
                  ...chat,
                  name: trimmed.slice(0, 12) || chat.name,
                  summary: trimmed.slice(0, 28),
                  messages: [userMessage],
                }
              : chat
          )
        );

        await streamAssistantReply(newChat.id, currentMessages);
      }
    } finally {
      setIsStreaming(false);
    }
  }

  return (
    <main className={`flex h-screen ${themeClasses.page}`}>
      <ChatSidebar
        chats={chats}
        activeChatId={activeChatId}
        onSelectChat={setActiveChatId}
        onCreateChat={() => {
          const newChat = createNewChat();
          setActiveChatId(newChat.id);
        }}
        onDeleteChat={deleteChat}
        theme={theme}
      />

      <section className={`flex min-w-0 flex-1 flex-col ${themeClasses.main}`}>
        <header
          className={`flex items-center justify-between border-b px-6 py-4 ${themeClasses.headerBorder}`}
        >
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">
              {activeChat ? activeChat.name : "開始新對話"}
            </h1>
            <p className={`mt-1 text-sm ${themeClasses.muted}`}>
              {activeChat
                ? `模型：${activeChat.settings.model}・模式：${getPresetLabel(
                    activeChat.settings.preset
                  )}`
                : "尚未選擇聊天室，直接輸入訊息就會自動建立新主題"}
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
                bottomRef={bottomRef}
                isStreaming={isStreaming}
                theme={theme}
              />
            ) : (
              <div className="flex flex-1 items-center justify-center px-6 py-10">
                <div className="max-w-2xl text-center">
                  <div className="mb-4 text-4xl">💬</div>
                  <h2 className="text-3xl font-bold">想聊什麼就直接開始</h2>
                  <p className={`mt-4 text-base leading-7 ${themeClasses.muted}`}>
                    你現在不需要先建立主題。直接在下方輸入訊息，
                    系統會自動幫你建立新的聊天室並開始對話。
                  </p>
                </div>
              </div>
            )}

            <ChatInput
              input={input}
              isStreaming={isStreaming}
              onChangeInput={setInput}
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
              onClearMemory={clearActiveChatMemory}
              onClearMessages={clearActiveChatMessages}
              onDeleteChat={() => deleteChat(activeChat.id)}
            />
          )}
        </div>
      </section>
    </main>
  );
}