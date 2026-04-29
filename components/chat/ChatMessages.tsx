/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AssetRecord, Message, MessageDiagnostics } from "@/types/chat";
import type { RefObject } from "react";

type ThemeMode = "dark" | "light";

type ChatMessagesProps = {
  messages: Message[];
  assetLibrary: AssetRecord[];
  bottomRef: RefObject<HTMLDivElement | null>;
  isStreaming: boolean;
  focusedMessageId?: number | null;
  theme: ThemeMode;
};

export default function ChatMessages({
  messages,
  assetLibrary,
  bottomRef,
  isStreaming,
  focusedMessageId,
  theme,
}: ChatMessagesProps) {
  const isDark = theme === "dark";
  const assetsById = useMemo(
    () => new Map(assetLibrary.map((asset) => [asset.id, asset])),
    [assetLibrary]
  );
  const [previewImage, setPreviewImage] = useState<AssetRecord | null>(null);
  const [selectedDiagnostics, setSelectedDiagnostics] = useState<{
    messageId: number;
    diagnostics: MessageDiagnostics;
  } | null>(null);

  useEffect(() => {
    if (!selectedDiagnostics) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelectedDiagnostics(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedDiagnostics]);

  return (
    <>
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
          {messages.map((msg) => {
            const isUser = msg.role === "user";
            const hasDiagnostics =
              !isUser &&
              Boolean(
                msg.diagnostics?.taskPlan ||
                  (msg.diagnostics?.taskExecution?.length ?? 0) > 0 ||
                  msg.diagnostics?.modelStatus ||
                  msg.diagnostics?.error
              );
            const resolvedAttachments = (msg.attachments ?? [])
              .map((attachment) => assetsById.get(attachment.assetId))
              .filter((asset): asset is AssetRecord => Boolean(asset));

            return (
              <div
                key={msg.id}
                id={`message-${msg.id}`}
                className={`flex w-full ${isUser ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[82%] rounded-[28px] transition ${
                    focusedMessageId === msg.id
                      ? isDark
                        ? "ring-2 ring-cyan-400/70 ring-offset-2 ring-offset-[#08111d]"
                        : "ring-2 ring-cyan-400 ring-offset-2 ring-offset-white"
                      : ""
                  }`}
                >
                  <div
                    className={`mb-2 flex items-center gap-2 text-xs ${
                      isUser
                        ? isDark
                          ? "justify-end text-white/35"
                          : "text-right text-slate-500"
                        : isDark
                        ? "justify-start text-white/35"
                        : "justify-start text-slate-500"
                    }`}
                  >
                    <span>{isUser ? "你" : "助理"}</span>
                    {!isUser && hasDiagnostics && (
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedDiagnostics({
                            messageId: msg.id,
                            diagnostics: msg.diagnostics!,
                          })
                        }
                        className={`rounded-full border px-2 py-0.5 text-[11px] transition ${
                          isDark
                            ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-200 hover:bg-cyan-400/15"
                            : "border-cyan-200 bg-cyan-50 text-cyan-700 hover:bg-cyan-100"
                        }`}
                      >
                        任務
                      </button>
                    )}
                  </div>

                  <div
                    className={`rounded-3xl px-5 py-4 text-[15px] leading-7 shadow-sm ${
                      isUser
                        ? "rounded-br-md bg-gradient-to-r from-cyan-400 via-sky-500 to-emerald-400 text-white shadow-lg shadow-cyan-500/20"
                        : isDark
                        ? "rounded-bl-md border border-white/10 bg-white/[0.05] text-white backdrop-blur-sm"
                        : "rounded-bl-md border border-slate-200 bg-white/85 text-slate-900"
                    }`}
                  >
                    {resolvedAttachments.length > 0 && (
                      <div className="mb-4 flex flex-wrap gap-3">
                        {resolvedAttachments.map((asset) =>
                          asset.kind === "image" ? (
                            <button
                              key={asset.id}
                              onClick={() => setPreviewImage(asset)}
                              className="overflow-hidden rounded-2xl border border-white/15 bg-black/10 text-left"
                            >
                              <img
                                src={asset.dataUrl}
                                alt={asset.name}
                                className="h-36 w-36 object-cover"
                              />
                              <div className="px-3 py-2 text-xs">{asset.name}</div>
                            </button>
                          ) : asset.kind === "audio" ? (
                            <div
                              key={asset.id}
                              className={`w-80 rounded-2xl border px-4 py-3 text-sm ${
                                isUser
                                  ? "border-white/20 bg-white/10"
                                  : isDark
                                  ? "border-white/10 bg-white/5"
                                  : "border-slate-200 bg-slate-50"
                              }`}
                            >
                              <div className="mb-2 font-medium">音訊</div>
                              <div className="truncate">{asset.name}</div>
                              <audio controls className="mt-3 w-full">
                                <source src={asset.dataUrl} type={asset.mimeType} />
                              </audio>
                            </div>
                          ) : (
                            <div
                              key={asset.id}
                              className={`w-64 rounded-2xl border px-4 py-3 text-sm ${
                                isUser
                                  ? "border-white/20 bg-white/10"
                                  : isDark
                                  ? "border-white/10 bg-white/5"
                                  : "border-slate-200 bg-slate-50"
                              }`}
                            >
                              <div className="font-medium">PDF</div>
                              <div className="truncate">{asset.name}</div>
                              <a
                                href={asset.dataUrl}
                                target="_blank"
                                rel="noreferrer"
                                className={`mt-2 inline-block text-xs underline ${
                                  isDark ? "text-cyan-300" : "text-sky-600"
                                }`}
                              >
                                開啟 PDF
                              </a>
                            </div>
                          )
                        )}
                      </div>
                    )}

                    {isUser ? (
                      msg.content ? (
                        <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                      ) : (
                        <div className="text-white/80">已上傳附件</div>
                      )
                    ) : (
                      <MarkdownMessage
                        content={msg.content || (isStreaming ? "思考中..." : "")}
                        theme={theme}
                      />
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          <div ref={bottomRef} />
        </div>
      </div>

      {previewImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-6">
          <div className="relative max-h-full max-w-5xl overflow-hidden rounded-3xl bg-black">
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute right-4 top-4 z-10 rounded-full bg-black/60 px-3 py-2 text-sm text-white"
            >
              關閉
            </button>
            <img
              src={previewImage.dataUrl}
              alt={previewImage.name}
              className="max-h-[85vh] max-w-[85vw] object-contain"
            />
          </div>
        </div>
      )}

      {selectedDiagnostics && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
          onClick={() => setSelectedDiagnostics(null)}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className={`relative max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-3xl border ${
              isDark
                ? "border-white/10 bg-slate-950 text-white"
                : "border-slate-200 bg-white text-slate-900"
            }`}
          >
            <div
              className={`sticky top-0 z-10 flex items-center justify-between rounded-t-3xl border-b px-6 py-4 ${
                isDark
                  ? "border-white/10 bg-slate-950/95"
                  : "border-slate-200 bg-white/95"
              }`}
            >
              <h3 className="text-lg font-semibold">
                訊息 #{selectedDiagnostics.messageId} 的任務詳情
              </h3>
              <button
                type="button"
                onClick={() => setSelectedDiagnostics(null)}
                className={`rounded-full px-3 py-2 text-sm ${
                  isDark ? "bg-white/10" : "bg-slate-100"
                }`}
              >
                關閉
              </button>
            </div>

            <div className="p-6">

            {selectedDiagnostics.diagnostics.taskPlan && (
              <div className="space-y-3">
                <div className="text-sm font-medium">任務分析</div>
                <div className={`rounded-2xl border p-4 text-sm ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"}`}>
                  <div className="font-medium">
                    {selectedDiagnostics.diagnostics.taskPlan.summary}
                  </div>
                  <div className="mt-2 text-xs opacity-70">
                    類型：{selectedDiagnostics.diagnostics.taskPlan.taskType} | 複雜度：{" "}
                    {selectedDiagnostics.diagnostics.taskPlan.complexity}
                  </div>
                  <div className="mt-1 text-xs opacity-70">
                    建議模型：{" "}
                    {selectedDiagnostics.diagnostics.taskPlan.recommendedModel}
                  </div>
                  <div className="mt-1 text-xs opacity-70">
                    Planner:{" "}
                    {selectedDiagnostics.diagnostics.taskPlan.plannerProvider ?? "-"}
                  </div>
                  <div className="mt-1 text-xs opacity-70">
                    Planner model:{" "}
                    {selectedDiagnostics.diagnostics.taskPlan.plannerModelUsed ?? "-"}
                  </div>
                  {selectedDiagnostics.diagnostics.modelStatus && (
                    <div className="mt-1 text-xs opacity-70">
                      最終主模型:{" "}
                      {selectedDiagnostics.diagnostics.modelStatus.activeModel}
                    </div>
                  )}
                  <div className="mt-2 text-xs opacity-80">
                    {selectedDiagnostics.diagnostics.taskPlan.reasoning}
                  </div>
                </div>

                <div className={`rounded-2xl border p-4 text-sm ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"}`}>
                  <div className="font-medium">子任務</div>
                  <ol className="mt-3 space-y-3 text-xs leading-5">
                    {selectedDiagnostics.diagnostics.taskPlan.steps.map((step, index) => (
                      <li key={step.id} className="rounded-xl border px-3 py-2">
                        <div className="font-medium">
                          {index + 1}. {step.title}
                        </div>
                        <div className="mt-1 opacity-75">{step.objective}</div>
                        <div className="mt-1 opacity-75">
                          模型：{step.recommendedModel}
                        </div>
                        <div className="mt-1 opacity-75">
                          能力需求：{" "}
                          {step.requiredCapabilities.length > 0
                            ? step.requiredCapabilities.join(", ")
                            : "無"}
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            )}

            <div className="mt-5 space-y-3">
              <div className="text-sm font-medium">執行狀態</div>
              {selectedDiagnostics.diagnostics.taskExecution &&
              selectedDiagnostics.diagnostics.taskExecution.length > 0 ? (
                <div className="space-y-3">
                  {selectedDiagnostics.diagnostics.taskExecution.map((item) => (
                    <div
                      key={item.stepId}
                      className={`rounded-2xl border p-4 text-sm ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"}`}
                    >
                      <div className="font-medium">
                        {item.title} | {item.status}
                      </div>
                      <div className="mt-1 text-xs opacity-70">
                        模式：{item.mode}
                      </div>
                      {item.modelUsed && (
                        <div className="mt-1 text-xs opacity-70">
                          Model: {item.modelUsed}
                        </div>
                      )}
                      <div className="mt-2 text-xs opacity-80">
                        <MarkdownMessage content={item.summary} theme={theme} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs opacity-70">目前沒有子任務執行細節。</div>
              )}
            </div>

            {selectedDiagnostics.diagnostics.modelStatus && (
              <div className="mt-5">
                <div className="text-sm font-medium">模型路由</div>
                <div className={`mt-3 rounded-2xl border p-4 text-xs leading-6 ${isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"}`}>
                  <div>請求模型：{selectedDiagnostics.diagnostics.modelStatus.requestedModel}</div>
                  <div>路由模型：{selectedDiagnostics.diagnostics.modelStatus.routedModel ?? "-"}</div>
                  <div>實際模型：{selectedDiagnostics.diagnostics.modelStatus.activeModel}</div>
                  <div>是否切換：{selectedDiagnostics.diagnostics.modelStatus.didFallback ? "是" : "否"}</div>
                  {selectedDiagnostics.diagnostics.modelStatus.routeReason && (
                    <div>路由原因：{selectedDiagnostics.diagnostics.modelStatus.routeReason}</div>
                  )}
                  {selectedDiagnostics.diagnostics.modelStatus.fallbackReason && (
                    <div>切換原因：{selectedDiagnostics.diagnostics.modelStatus.fallbackReason}</div>
                  )}
                </div>
              </div>
            )}

            {selectedDiagnostics.diagnostics.error && (
              <div className="mt-5">
                <div className="text-sm font-medium">錯誤</div>
                <div className="mt-3 rounded-2xl border border-red-300/40 bg-red-500/10 p-4 text-xs leading-6 text-red-200">
                  <MarkdownMessage
                    content={selectedDiagnostics.diagnostics.error}
                    theme={theme}
                  />
                </div>
              </div>
            )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function MarkdownMessage({
  content,
  theme,
}: {
  content: string;
  theme: ThemeMode;
}) {
  const isDark = theme === "dark";

  return (
    <div className={`max-w-none break-words ${isDark ? "markdown-dark" : "markdown-light"}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="mb-4 mt-2 text-2xl font-bold leading-tight">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-3 mt-6 text-xl font-bold leading-tight">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-3 mt-5 text-lg font-semibold leading-tight">{children}</h3>,
          h4: ({ children }) => <h4 className="mb-2 mt-4 text-base font-semibold leading-tight">{children}</h4>,
          p: ({ children }) => <p className="my-3 leading-7">{children}</p>,
          ul: ({ children }) => <ul className="my-3 list-disc space-y-2 pl-6">{children}</ul>,
          ol: ({ children }) => <ol className="my-3 list-decimal space-y-2 pl-6">{children}</ol>,
          li: ({ children }) => <li className="leading-7">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote
              className={`my-4 rounded-r-2xl border-l-4 px-4 py-3 italic ${
                isDark
                  ? "border-cyan-400/70 bg-cyan-400/10 text-white/85"
                  : "border-cyan-500 bg-cyan-50 text-slate-700"
              }`}
            >
              {children}
            </blockquote>
          ),
          hr: () => (
            <hr className={`my-6 border-0 border-t ${isDark ? "border-white/10" : "border-slate-200"}`} />
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className={`${isDark ? "text-cyan-300" : "text-sky-600"} underline underline-offset-4`}
            >
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="my-4 overflow-x-auto">
              <table
                className={`min-w-full overflow-hidden rounded-2xl border text-sm ${
                  isDark ? "border-white/10" : "border-slate-200"
                }`}
              >
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className={isDark ? "bg-white/10" : "bg-slate-100"}>{children}</thead>
          ),
          th: ({ children }) => (
            <th
              className={`border-b px-4 py-3 text-left font-semibold ${
                isDark ? "border-white/10" : "border-slate-200"
              }`}
            >
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td
              className={`border-b px-4 py-3 align-top ${
                isDark ? "border-white/10" : "border-slate-200"
              }`}
            >
              {children}
            </td>
          ),
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
