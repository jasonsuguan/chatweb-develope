"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message } from "@/types/chat";
import type { RefObject } from "react";

type ThemeMode = "dark" | "light";

type ChatMessagesProps = {
  messages: Message[];
  bottomRef: RefObject<HTMLDivElement | null>;
  isStreaming: boolean;
  theme: ThemeMode;
};

export default function ChatMessages({
  messages,
  bottomRef,
  isStreaming,
  theme,
}: ChatMessagesProps) {
  const isDark = theme === "dark";

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
        {messages.map((msg) => {
          const isUser = msg.role === "user";

          return (
            <div
              key={msg.id}
              className={`flex w-full ${isUser ? "justify-end" : "justify-start"}`}
            >
              <div className="max-w-[82%]">
                <div
                  className={`mb-2 text-xs ${
                    isUser
                      ? isDark
                        ? "text-right text-white/35"
                        : "text-right text-slate-500"
                      : isDark
                      ? "text-left text-white/35"
                      : "text-left text-slate-500"
                  }`}
                >
                  {isUser ? "你" : "助手"}
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
                  {isUser ? (
                    <div className="whitespace-pre-wrap break-words">
                      {msg.content}
                    </div>
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
          code(props) {
            const { inline, className, children, ...rest } = props as {
              inline?: boolean;
              className?: string;
              children?: React.ReactNode;
            };

            const codeText = String(children ?? "").replace(/\n$/, "");

            if (inline) {
              return (
                <code
                  className={`rounded-md px-1.5 py-0.5 text-[0.92em] ${
                    isDark ? "bg-white/10 text-cyan-200" : "bg-slate-100 text-sky-700"
                  }`}
                  {...rest}
                >
                  {children}
                </code>
              );
            }

            return (
              <CodeBlock codeText={codeText} className={className} theme={theme} />
            );
          },
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function CodeBlock({
  codeText,
  className,
  theme,
}: {
  codeText: string;
  className?: string;
  theme: ThemeMode;
}) {
  const [copied, setCopied] = useState(false);
  const isDark = theme === "dark";

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(codeText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      console.error("copy failed", error);
    }
  }

  return (
    <div className="my-4 overflow-hidden rounded-2xl border">
      <div
        className={`flex items-center justify-between px-4 py-2 text-xs ${
          isDark
            ? "border-b border-white/10 bg-white/5 text-white/55"
            : "border-b border-slate-200 bg-slate-50 text-slate-500"
        }`}
      >
        <span>{className || "code"}</span>
        <button
          onClick={handleCopy}
          className={`rounded-lg px-3 py-1 transition ${
            isDark ? "bg-white/10 text-white/80 hover:bg-white/15" : "bg-white text-slate-600 hover:bg-slate-100"
          }`}
        >
          {copied ? "已複製" : "複製"}
        </button>
      </div>

      <pre
        className={`overflow-x-auto p-4 text-sm leading-6 ${
          isDark ? "bg-[#0a1220] text-slate-100" : "bg-slate-50 text-slate-800"
        }`}
      >
        <code className={className}>{codeText}</code>
      </pre>
    </div>
  );
}