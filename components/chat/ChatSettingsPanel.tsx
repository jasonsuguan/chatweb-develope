"use client";

import { useMemo, useState } from "react";
import type {
  ChatPreset,
  ChatSettings,
  ModelRoutingMode,
} from "@/types/chat";

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
  longTermMemories: string[];
  onClearMemory: () => void;
  onClearLongTermMemory: () => void;
  onClearMessages: () => void;
  onDeleteChat: () => void;
};

function getCreativityLabel(value: number) {
  if (value <= 0.4) return "精準";
  if (value <= 0.8) return "平衡";
  return "創意";
}

function getResponseVarietyLabel(value: number) {
  if (value <= 0.35) return "保守";
  if (value <= 0.75) return "平衡";
  return "多樣";
}

function getCandidateBreadthLabel(value: number) {
  if (value <= 20) return "集中";
  if (value <= 60) return "平衡";
  return "寬廣";
}

export default function ChatSettingsPanel({
  settings,
  onChangeSetting,
  onChangePreset,
  onChangeSystemPrompt,
  theme,
  memorySummary,
  longTermMemories,
  onClearMemory,
  onClearLongTermMemory,
  onClearMessages,
  onDeleteChat,
}: ChatSettingsPanelProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const creativityLabel = useMemo(
    () => getCreativityLabel(settings.temperature),
    [settings.temperature]
  );
  const responseVarietyLabel = useMemo(
    () => getResponseVarietyLabel(settings.topP),
    [settings.topP]
  );
  const candidateBreadthLabel = useMemo(
    () => getCandidateBreadthLabel(settings.topK),
    [settings.topK]
  );

  const isDark = theme === "dark";
  const panelClass = isDark
    ? "border-white/10 bg-black/25 text-white"
    : "border-slate-200/80 bg-white/60 text-slate-900";
  const inputClass = isDark
    ? "border-white/10 bg-black/30 text-white"
    : "border-slate-200 bg-white text-slate-900";
  const mutedClass = isDark ? "text-white/40" : "text-slate-500";
  const actionButtonClass = isDark
    ? "bg-white/5 hover:bg-white/10"
    : "bg-slate-100 hover:bg-slate-200";
  const sectionTitleClass = isDark ? "text-white" : "text-slate-900";

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
            設定
          </p>
          <h3
            className={`mt-2 text-xl font-semibold ${
              isDark ? "text-white" : "text-slate-900"
            }`}
          >
            對話控制
          </h3>
          <p className={`mt-2 text-sm leading-6 ${mutedClass}`}>
            調整助理行為、短期記憶與跨聊天室的長期記憶。
          </p>
        </div>

        <section className="space-y-3">
          <div>
            <h4 className={`text-sm font-semibold ${sectionTitleClass}`}>
              助理
            </h4>
            <p className={`mt-1 text-xs leading-5 ${mutedClass}`}>
              助理角色與基礎行為設定。
            </p>
          </div>

          <div className={`rounded-3xl border p-4 backdrop-blur-md ${panelClass}`}>
            <label className="mb-2 block text-sm font-medium">預設模式</label>
            <select
              value={settings.preset}
              onChange={(e) => onChangePreset(e.target.value as ChatPreset)}
              className={`w-full rounded-2xl border px-4 py-3 text-sm focus:outline-none ${inputClass}`}
            >
              <option value="general">一般</option>
              <option value="coding">程式</option>
              <option value="custom">自訂</option>
            </select>

            <label className="mb-2 mt-4 block text-sm font-medium">系統提示詞</label>
            <textarea
              value={settings.systemPrompt}
              onChange={(e) => onChangeSystemPrompt(e.target.value)}
              rows={5}
              className={`w-full rounded-2xl border px-4 py-3 text-sm leading-6 focus:outline-none ${inputClass}`}
            />
          </div>
        </section>

        <section className="space-y-3">
          <div>
            <h4 className={`text-sm font-semibold ${sectionTitleClass}`}>
              模型
            </h4>
            <p className={`mt-1 text-xs leading-5 ${mutedClass}`}>
              模型選擇、路由與生成風格。
            </p>
          </div>

          <div className={`rounded-3xl border p-4 backdrop-blur-md ${panelClass}`}>
            <label className="mb-2 block text-sm font-medium">模型路由</label>
            <select
              value={settings.modelRoutingMode}
              onChange={(e) =>
                onChangeSetting("modelRoutingMode", e.target.value as ModelRoutingMode)
              }
              className={`w-full rounded-2xl border px-4 py-3 text-sm focus:outline-none ${inputClass}`}
            >
              <option value="manual">手動選擇模型</option>
              <option value="auto">依任務類型自動路由</option>
            </select>
            <p className={`mt-2 text-xs leading-5 ${mutedClass}`}>
              自動模式會依任務類型挑選模型；手動模式則固定從你下面選的模型開始。
            </p>

            <label className="mb-2 mt-4 block text-sm font-medium">主模型</label>
            <select
              value={settings.model}
              onChange={(e) => onChangeSetting("model", e.target.value)}
              className={`w-full rounded-2xl border px-4 py-3 text-sm focus:outline-none ${inputClass}`}
            >
              <option value="gemini-2.5-flash">gemini-2.5-flash</option>
              <option value="gemini-2.5-flash-lite">gemini-2.5-flash-lite</option>
              <option value="gemini-2.5-pro">gemini-2.5-pro</option>
              <option value="gemini-3-flash-preview">gemini-3-flash-preview</option>
              <option value="gemini-3.1-flash-lite-preview">
                gemini-3.1-flash-lite-preview
              </option>
            </select>
            <p className={`mt-2 text-xs leading-5 ${mutedClass}`}>
              {settings.modelRoutingMode === "auto"
                ? "這會作為你偏好的備援模型。自動路由可能會依任務改用其他起始模型。"
                : "手動模式會先使用這個模型，只有在需要 fallback 時才切換。"}
            </p>

            <div className="mt-4 rounded-2xl border px-4 py-4">
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium">任務規劃器</label>
                <button
                  type="button"
                  onClick={() =>
                    onChangeSetting("enableTaskPlanner", !settings.enableTaskPlanner)
                  }
                  className={`relative inline-flex h-7 w-12 items-center rounded-full transition ${
                    settings.enableTaskPlanner
                      ? "bg-cyan-500"
                      : isDark
                      ? "bg-white/10"
                      : "bg-slate-300"
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
                      settings.enableTaskPlanner ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
              <p className={`text-xs leading-5 ${mutedClass}`}>
                開啟後，系統會先用較輕量的規劃模型拆解任務，再建議需要的工具、MCP 與起始模型。
              </p>

              <label className="mb-2 mt-4 block text-sm font-medium">
                規劃模型
              </label>
              <select
                value={settings.plannerModel}
                onChange={(e) => onChangeSetting("plannerModel", e.target.value)}
                className={`w-full rounded-2xl border px-4 py-3 text-sm focus:outline-none ${inputClass}`}
              >
                <option value="groq-auto">Groq preprocessor</option>
                <option value="gemini-2.5-flash-lite">gemini-2.5-flash-lite</option>
                <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                <option value="gemini-2.5-pro">gemini-2.5-pro</option>
                <option value="gemini-3.1-flash-lite-preview">
                  gemini-3.1-flash-lite-preview
                </option>
              </select>
            </div>

            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium">溫度</label>
                <span className="rounded-full bg-gradient-to-r from-cyan-400/20 via-sky-500/20 to-emerald-400/20 px-3 py-1 text-xs">
                  {creativityLabel}
                </span>
              </div>

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
                <span>精準</span>
                <span>{settings.temperature.toFixed(1)}</span>
                <span>創意</span>
              </div>
            </div>

            <label className="mb-2 mt-4 block text-sm font-medium">
              最大輸出 Token
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
          </div>
        </section>

        <section className="space-y-3">
          <div>
            <h4 className={`text-sm font-semibold ${sectionTitleClass}`}>
              記憶
            </h4>
            <p className={`mt-1 text-xs leading-5 ${mutedClass}`}>
              管理短期與長期記憶的行為。
            </p>
          </div>

          <div className={`rounded-3xl border p-4 backdrop-blur-md ${panelClass}`}>
            <label className="mb-2 block text-sm font-medium">
              短期記憶輪數
            </label>
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
            <p className={`mt-2 text-xs leading-5 ${mutedClass}`}>
              控制最近幾輪對話會直接保留在上下文中，超出後才改由摘要接手。
            </p>
          </div>
        </section>

        <section className="space-y-3">
          <div>
            <h4 className={`text-sm font-semibold ${sectionTitleClass}`}>
              動作
            </h4>
            <p className={`mt-1 text-xs leading-5 ${mutedClass}`}>
              與外部傳送、建立內容相關的安全確認設定。
            </p>
          </div>

          <div className={`rounded-3xl border p-4 backdrop-blur-md ${panelClass}`}>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-medium">傳送前確認</label>
              <button
                type="button"
                onClick={() =>
                  onChangeSetting(
                    "requireActionConfirmation",
                    !settings.requireActionConfirmation
                  )
                }
                className={`relative inline-flex h-7 w-12 items-center rounded-full transition ${
                  settings.requireActionConfirmation
                    ? "bg-emerald-500"
                    : isDark
                    ? "bg-white/10"
                    : "bg-slate-300"
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
                    settings.requireActionConfirmation
                      ? "translate-x-6"
                      : "translate-x-1"
                  }`}
                />
              </button>
            </div>
            <p className={`text-xs leading-5 ${mutedClass}`}>
              開啟後，助理會在傳送 Discord / Telegram 訊息、建立投票或送出圖片前先徵求確認。
            </p>
          </div>
        </section>

        <section className={`rounded-3xl border p-4 backdrop-blur-md ${panelClass}`}>
          <button
            onClick={() => setShowAdvanced((prev) => !prev)}
            className={`flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left text-sm transition ${actionButtonClass}`}
          >
            <span>進階設定</span>
            <span className={mutedClass}>{showAdvanced ? "隱藏" : "顯示"}</span>
          </button>

          {showAdvanced && (
            <div className="mt-4 space-y-4">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-sm font-medium">
                    回覆多樣性
                  </label>
                  <span className="rounded-full bg-gradient-to-r from-amber-400/20 via-orange-400/20 to-rose-400/20 px-3 py-1 text-xs">
                    {responseVarietyLabel}
                  </span>
                </div>
                <input
                  type="range"
                  step="0.05"
                  min="0"
                  max="1"
                  value={settings.topP}
                  onChange={(e) => onChangeSetting("topP", Number(e.target.value))}
                  className="w-full accent-amber-500"
                />
                <div className={`mt-2 flex justify-between text-xs ${mutedClass}`}>
                  <span>較穩定</span>
                  <span>{settings.topP.toFixed(2)}</span>
                  <span>較多變</span>
                </div>
                <p className={`mt-2 text-xs leading-5 ${mutedClass}`}>
                  控制回覆措辭的多變程度。多數情況下維持在 `0.9` 左右即可。
                </p>
                <p className={`mt-1 text-[11px] leading-5 ${mutedClass}`}>
                  進階參數：`topP`
                </p>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-sm font-medium">
                    候選範圍
                  </label>
                  <span className="rounded-full bg-gradient-to-r from-sky-400/20 via-cyan-400/20 to-emerald-400/20 px-3 py-1 text-xs">
                    {candidateBreadthLabel}
                  </span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="100"
                  value={settings.topK}
                  onChange={(e) => onChangeSetting("topK", Number(e.target.value))}
                  className="w-full accent-sky-500"
                />
                <div className={`mt-2 flex justify-between text-xs ${mutedClass}`}>
                  <span>較窄</span>
                  <span>{settings.topK}</span>
                  <span>較寬</span>
                </div>
                <p className={`mt-2 text-xs leading-5 ${mutedClass}`}>
                  控制模型在選下一個 token 前會考慮多少候選字詞。多數情況下維持在 `40` 左右即可。
                </p>
                <p className={`mt-1 text-[11px] leading-5 ${mutedClass}`}>
                  進階參數：`topK`
                </p>
              </div>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <div>
            <h4 className={`text-sm font-semibold ${sectionTitleClass}`}>
              記憶
            </h4>
            <p className={`mt-1 text-xs leading-5 ${mutedClass}`}>
              檢視並清除目前聊天室摘要與跨聊天室記憶。
            </p>
          </div>

          <div className={`rounded-3xl border p-4 backdrop-blur-md ${panelClass}`}>
            <div className="mb-2 text-sm font-medium">短期記憶摘要</div>
            <p className={`mb-3 text-xs leading-5 ${mutedClass}`}>
              這份滾動摘要會保留目前聊天室的重要上下文。
            </p>

            <div className={`mb-4 rounded-2xl border p-3 text-xs leading-6 ${inputClass}`}>
              {memorySummary || "目前尚無短期記憶摘要。"}
            </div>

            <button
              onClick={onClearMemory}
              className={`w-full rounded-2xl px-4 py-3 text-sm transition ${actionButtonClass}`}
            >
              清除短期記憶
            </button>
          </div>

          <div className={`rounded-3xl border p-4 backdrop-blur-md ${panelClass}`}>
            <div className="mb-2 text-sm font-medium">長期記憶</div>
            <p className={`mb-3 text-xs leading-5 ${mutedClass}`}>
              這些記憶會跨聊天室共享，並在每次回覆後自動更新。
            </p>

            <div className={`mb-4 rounded-2xl border p-3 text-xs leading-6 ${inputClass}`}>
              {longTermMemories.length > 0 ? (
                <ul className="list-disc space-y-2 pl-5">
                  {longTermMemories.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <span>目前尚未儲存長期記憶。</span>
              )}
            </div>

            <button
              onClick={onClearLongTermMemory}
              className={`w-full rounded-2xl px-4 py-3 text-sm transition ${actionButtonClass}`}
            >
              清除長期記憶
            </button>
          </div>
        </section>

        <section className="space-y-3">
          <div>
            <h4 className={`text-sm font-semibold ${sectionTitleClass}`}>
              對話管理
            </h4>
            <p className={`mt-1 text-xs leading-5 ${mutedClass}`}>
              清除目前對話或刪除整個聊天室。
            </p>
          </div>

          <div className={`rounded-3xl border p-4 backdrop-blur-md ${panelClass}`}>
            <div className="space-y-2">
              <button
                onClick={onClearMessages}
                className={`w-full rounded-2xl px-4 py-3 text-sm transition ${actionButtonClass}`}
              >
                清除聊天訊息
              </button>

              <button
                onClick={onDeleteChat}
                className="w-full rounded-2xl bg-red-500/90 px-4 py-3 text-sm text-white transition hover:bg-red-500"
              >
                刪除聊天室
              </button>
            </div>
          </div>
        </section>
      </div>
    </aside>
  );
}
