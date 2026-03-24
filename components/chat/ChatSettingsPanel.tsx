"use client";

import { useMemo, useState } from "react";
import type { ChatPreset, ChatSettings } from "@/types/chat";

type ThemeMode = "dark" | "light";

type ChatSettingsPanelProps = {
  settings: ChatSettings;
  onChangeSetting: <K extends keyof ChatSettings>(
    key: K,
    value: ChatSettings[K]
  ) => void;
  onChangePreset: (preset: ChatPreset) => void;
  onChangeSystemPrompt: (value: string) => void;
  theme: ThemeMode;
  memorySummary: string;
  onClearMemory: () => void;
  onClearMessages: () => void;
  onDeleteChat: () => void;
};

function getCreativityLabel(value: number) {
  if (value <= 0.4) return "精準穩定";
  if (value <= 0.8) return "平衡自然";
  return "創意發散";
}

export default function ChatSettingsPanel({
  settings,
  onChangeSetting,
  onChangePreset,
  onChangeSystemPrompt,
  theme,
  memorySummary,
  onClearMemory,
  onClearMessages,
  onDeleteChat,
}: ChatSettingsPanelProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const creativityLabel = useMemo(
    () => getCreativityLabel(settings.temperature),
    [settings.temperature]
  );

  const isDark = theme === "dark";
  const panelClass = isDark
    ? "border-white/10 bg-black/25 text-white"
    : "border-slate-200/80 bg-white/60 text-slate-900";
  const inputClass = isDark
    ? "border-white/10 bg-black/30 text-white"
    : "border-slate-200 bg-white text-slate-900";
  const mutedClass = isDark ? "text-white/40" : "text-slate-500";

  return (
    <aside
      className={`w-[360px] shrink-0 overflow-y-auto border-l ${
        isDark
          ? "border-white/10 bg-black/20"
          : "border-slate-200/80 bg-white/40"
      }`}
    >
      <div className="space-y-6 p-5">
        <div>
          <p className={`text-xs uppercase tracking-[0.2em] ${mutedClass}`}>
            Settings
          </p>
          <h3
            className={`mt-2 text-xl font-semibold ${
              isDark ? "text-white" : "text-slate-900"
            }`}
          >
            對話設定
          </h3>
          <p className={`mt-2 text-sm leading-6 ${mutedClass}`}>
            這裡可以調整助手風格、模型與回答行為。
          </p>
        </div>

        <section
          className={`rounded-3xl border p-4 backdrop-blur-md ${panelClass}`}
        >
          <label className="mb-2 block text-sm font-medium">回答模式</label>
          <p className={`mb-3 text-xs leading-5 ${mutedClass}`}>
            選擇助手目前的回答風格。手動修改助手設定後，會自動切換成自訂模式。
          </p>

          <select
            value={settings.preset}
            onChange={(e) => onChangePreset(e.target.value as ChatPreset)}
            className={`w-full rounded-2xl border px-4 py-3 text-sm focus:outline-none ${inputClass}`}
          >
            <option value="general">一般助理</option>
            <option value="coding">程式助教</option>
            <option value="custom">自訂模式</option>
          </select>
        </section>

        <section
          className={`rounded-3xl border p-4 backdrop-blur-md ${panelClass}`}
        >
          <label className="mb-2 block text-sm font-medium">助手設定</label>
          <p className={`mb-3 text-xs leading-5 ${mutedClass}`}>
            告訴助手你希望它用什麼角色、口吻或規則來回答。
          </p>
          <textarea
            value={settings.systemPrompt}
            onChange={(e) => onChangeSystemPrompt(e.target.value)}
            rows={5}
            className={`w-full rounded-2xl border px-4 py-3 text-sm leading-6 focus:outline-none ${inputClass}`}
          />
        </section>

        <section
          className={`rounded-3xl border p-4 backdrop-blur-md ${panelClass}`}
        >
          <label className="mb-2 block text-sm font-medium">模型</label>
          <select
            value={settings.model}
            onChange={(e) => onChangeSetting("model", e.target.value)}
            className={`w-full rounded-2xl border px-4 py-3 text-sm focus:outline-none ${inputClass}`}
          >
            <option value="gemini-2.5-flash">gemini-2.5-flash</option>
            <option value="gemini-3-flash-preview">gemini-3-flash-preview</option>
            <option value="gemini-3.1-flash-lite-preview">
              gemini-3.1-flash-lite-preview
            </option>
          </select>
        </section>

        <section
          className={`rounded-3xl border p-4 backdrop-blur-md ${panelClass}`}
        >
          <div className="mb-2 flex items-center justify-between">
            <label className="text-sm font-medium">創意程度</label>
            <span className="rounded-full bg-gradient-to-r from-cyan-400/20 via-sky-500/20 to-emerald-400/20 px-3 py-1 text-xs">
              {creativityLabel}
            </span>
          </div>

          <p className={`mb-4 text-xs leading-5 ${mutedClass}`}>
            越低越穩定保守，越高越有變化、越敢延伸。
          </p>

          <input
            type="range"
            min="0"
            max="1.5"
            step="0.1"
            value={settings.temperature}
            onChange={(e) =>
              onChangeSetting("temperature", Number(e.target.value))
            }
            className="w-full accent-cyan-500"
          />

          <div className={`mt-2 flex justify-between text-xs ${mutedClass}`}>
            <span>穩定</span>
            <span>{settings.temperature.toFixed(1)}</span>
            <span>活潑</span>
          </div>
        </section>

        <section
          className={`rounded-3xl border p-4 backdrop-blur-md ${panelClass}`}
        >
          <label className="mb-2 block text-sm font-medium">
            回答長度上限
          </label>
          <input
            type="number"
            min="128"
            max="8192"
            step="128"
            value={settings.maxOutputTokens}
            onChange={(e) =>
              onChangeSetting("maxOutputTokens", Number(e.target.value))
            }
            className={`w-full rounded-2xl border px-4 py-3 text-sm focus:outline-none ${inputClass}`}
          />
        </section>

        <section
          className={`rounded-3xl border p-4 backdrop-blur-md ${panelClass}`}
        >
          <label className="mb-2 block text-sm font-medium">短期記憶輪數</label>
          <input
            type="number"
            min="2"
            max="20"
            value={settings.memoryTurns}
            onChange={(e) =>
              onChangeSetting("memoryTurns", Number(e.target.value))
            }
            className={`w-full rounded-2xl border px-4 py-3 text-sm focus:outline-none ${inputClass}`}
          />
        </section>

        <section
          className={`rounded-3xl border p-4 backdrop-blur-md ${panelClass}`}
        >
          <button
            onClick={() => setShowAdvanced((prev) => !prev)}
            className={`flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left text-sm transition ${
              isDark
                ? "bg-white/5 hover:bg-white/10"
                : "bg-slate-100 hover:bg-slate-200"
            }`}
          >
            <span>進階設定</span>
            <span className={mutedClass}>{showAdvanced ? "收起" : "展開"}</span>
          </button>

          {showAdvanced && (
            <div className="mt-4 space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium">topP</label>
                <input
                  type="number"
                  step="0.05"
                  min="0"
                  max="1"
                  value={settings.topP}
                  onChange={(e) => onChangeSetting("topP", Number(e.target.value))}
                  className={`w-full rounded-2xl border px-4 py-3 text-sm focus:outline-none ${inputClass}`}
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">topK</label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={settings.topK}
                  onChange={(e) => onChangeSetting("topK", Number(e.target.value))}
                  className={`w-full rounded-2xl border px-4 py-3 text-sm focus:outline-none ${inputClass}`}
                />
              </div>
            </div>
          )}
        </section>

        <section
          className={`rounded-3xl border p-4 backdrop-blur-md ${panelClass}`}
        >
          <div className="mb-2 text-sm font-medium">記憶管理</div>
          <p className={`mb-3 text-xs leading-5 ${mutedClass}`}>
            這裡可以管理此聊天室的短期記憶與訊息內容。
          </p>

          <div
            className={`mb-4 rounded-2xl border p-3 text-xs leading-6 ${inputClass}`}
          >
            {memorySummary ? memorySummary : "目前沒有短期記憶摘要。"}
          </div>

          <div className="space-y-2">
            <button
              onClick={onClearMemory}
              className={`w-full rounded-2xl px-4 py-3 text-sm transition ${
                isDark
                  ? "bg-white/5 hover:bg-white/10"
                  : "bg-slate-100 hover:bg-slate-200"
              }`}
            >
              清除短期記憶
            </button>

            <button
              onClick={onClearMessages}
              className={`w-full rounded-2xl px-4 py-3 text-sm transition ${
                isDark
                  ? "bg-white/5 hover:bg-white/10"
                  : "bg-slate-100 hover:bg-slate-200"
              }`}
            >
              清空目前對話
            </button>

            <button
              onClick={onDeleteChat}
              className="w-full rounded-2xl bg-red-500/90 px-4 py-3 text-sm text-white transition hover:bg-red-500"
            >
              刪除此聊天室
            </button>
          </div>
        </section>
      </div>
    </aside>
  );
}