"use client";

import type { ChatRoom } from "@/types/chat";

type ThemeMode = "dark" | "light";

type ChatSidebarProps = {
  chats: ChatRoom[];
  activeChatId: number | null;
  onSelectChat: (id: number | null) => void;
  onCreateChat: () => void;
  onDeleteChat: (id: number) => void;
  theme: ThemeMode;
};

export default function ChatSidebar({
  chats,
  activeChatId,
  onSelectChat,
  onCreateChat,
  onDeleteChat,
  theme,
}: ChatSidebarProps) {
  const isDark = theme === "dark";

  return (
    <aside
      className={`flex w-72 shrink-0 flex-col border-r ${
        isDark
          ? "border-white/10 bg-black/40"
          : "border-slate-200/80 bg-white/60 backdrop-blur-md"
      }`}
    >
      <div className={`border-b px-5 py-5 ${isDark ? "border-white/10" : "border-slate-200/80"}`}>
        <div className="mb-4">
          <p className={`text-xs uppercase tracking-[0.2em] ${isDark ? "text-white/35" : "text-slate-400"}`}>
            Chat Web
          </p>
          <h2 className={`mt-2 text-2xl font-bold ${isDark ? "text-white" : "text-slate-900"}`}>
            聊天室
          </h2>
        </div>

        <button
          onClick={onCreateChat}
          className="w-full rounded-2xl bg-gradient-to-r from-cyan-400 via-sky-500 to-emerald-400 px-4 py-3 text-sm font-medium text-white shadow-lg shadow-cyan-500/20 transition hover:scale-[1.01]"
        >
          + 新增聊天室
        </button>

        <button
          onClick={() => onSelectChat(null)}
          className={`mt-3 w-full rounded-2xl border px-4 py-3 text-sm transition ${
            isDark
              ? "border-white/10 bg-white/5 text-white/80 hover:bg-white/10"
              : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          }`}
        >
          回到空白首頁
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        <div className={`mb-3 px-2 text-xs ${isDark ? "text-white/35" : "text-slate-400"}`}>
          最近對話
        </div>

        <div className="space-y-2">
          {chats.map((chat) => {
            const active = chat.id === activeChatId;

            return (
              <div
                key={chat.id}
                className={`group relative rounded-2xl border transition ${
                  active
                    ? isDark
                      ? "border-cyan-400/30 bg-gradient-to-r from-cyan-400/10 to-emerald-400/10"
                      : "border-cyan-200 bg-gradient-to-r from-cyan-50 to-emerald-50"
                    : isDark
                    ? "border-transparent bg-white/[0.03] hover:bg-white/[0.06]"
                    : "border-transparent bg-slate-50 hover:bg-slate-100"
                }`}
              >
                <button
                  onClick={() => onSelectChat(chat.id)}
                  className="w-full rounded-2xl px-4 py-3 pr-12 text-left"
                >
                  <div className={`truncate text-sm font-medium ${isDark ? "text-white" : "text-slate-900"}`}>
                    {chat.name}
                  </div>
                  <div
                    className={`mt-1 line-clamp-2 text-xs leading-5 ${
                      isDark ? "text-white/45" : "text-slate-500"
                    }`}
                  >
                    {chat.summary || "尚未開始對話"}
                  </div>
                </button>

                <button
                  onClick={() => onDeleteChat(chat.id)}
                  className={`absolute right-2 top-2 rounded-lg px-2 py-1 text-xs opacity-0 transition group-hover:opacity-100 ${
                    isDark
                      ? "bg-white/10 text-white/70 hover:bg-white/15"
                      : "bg-white text-slate-500 shadow hover:bg-slate-100"
                  }`}
                  title="刪除此聊天室"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}