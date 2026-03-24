"use client";

import { KeyboardEvent } from "react";

type ThemeMode = "dark" | "light";

type ChatInputProps = {
  input: string;
  isStreaming: boolean;
  onChangeInput: (value: string) => void;
  onSend: () => void;
  theme: ThemeMode;
};

export default function ChatInput({
  input,
  isStreaming,
  onChangeInput,
  onSend,
  theme,
}: ChatInputProps) {
  const isDark = theme === "dark";

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  }

  return (
    <div
      className={`border-t px-6 py-5 ${
        isDark ? "border-white/10 bg-black/10" : "border-slate-200/80 bg-white/40"
      }`}
    >
      <div className="mx-auto w-full max-w-4xl">
        <div
          className={`rounded-[28px] border p-3 shadow-[0_10px_30px_rgba(0,0,0,0.10)] ${
            isDark
              ? "border-white/10 bg-white/[0.04] backdrop-blur-md"
              : "border-slate-200 bg-white/80 backdrop-blur-md"
          }`}
        >
          <div className="flex items-end gap-3">
            <textarea
              value={input}
              onChange={(e) => onChangeInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={3}
              placeholder="輸入訊息…"
              className={`max-h-56 min-h-[72px] flex-1 resize-none bg-transparent px-3 py-2 text-[15px] focus:outline-none ${
                isDark
                  ? "text-white placeholder:text-white/30"
                  : "text-slate-900 placeholder:text-slate-400"
              }`}
            />

            <button
              onClick={onSend}
              disabled={isStreaming || !input.trim()}
              className="rounded-2xl bg-gradient-to-r from-cyan-400 via-sky-500 to-emerald-400 px-5 py-3 text-sm font-medium text-white shadow-lg shadow-cyan-500/20 transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isStreaming ? "生成中..." : "送出"}
            </button>
          </div>

          <div className={`mt-2 px-3 text-xs ${isDark ? "text-white/30" : "text-slate-400"}`}>
            Enter 送出，Shift + Enter 換行
          </div>
        </div>
      </div>
    </div>
  );
}