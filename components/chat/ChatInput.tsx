/* eslint-disable @next/next/no-img-element */
"use client";

import { KeyboardEvent, useEffect, useRef, useState } from "react";
import type { PendingUpload } from "@/types/chat";

type ThemeMode = "dark" | "light";

type ChatInputProps = {
  input: string;
  isStreaming: boolean;
  pendingUploads: PendingUpload[];
  onChangeInput: (value: string) => void;
  onSelectFiles: (files: FileList | File[] | null) => void;
  onRemoveUpload: (id: string) => void;
  onSend: () => void;
  theme: ThemeMode;
};

export default function ChatInput({
  input,
  isStreaming,
  pendingUploads,
  onChangeInput,
  onSelectFiles,
  onRemoveUpload,
  onSend,
  theme,
}: ChatInputProps) {
  const isDark = theme === "dark";
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const canSend = input.trim().length > 0 || pendingUploads.length > 0;

  useEffect(() => {
    return () => {
      mediaRecorderRef.current?.stop();
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  }

  async function handleToggleRecording() {
    if (isStreaming) return;

    if (isRecording) {
      mediaRecorderRef.current?.stop();
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      window.alert("此瀏覽器不支援麥克風錄音。");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const preferredMimeTypes = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
      ];
      const selectedMimeType =
        preferredMimeTypes.find(
          (mimeType) =>
            typeof MediaRecorder !== "undefined" &&
            MediaRecorder.isTypeSupported(mimeType)
        ) ?? "";

      const recorder = new MediaRecorder(
        stream,
        selectedMimeType ? { mimeType: selectedMimeType } : undefined
      );
      const chunks: BlobPart[] = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      recorder.onstop = () => {
        const mimeType = recorder.mimeType || "audio/webm";
        const extension = mimeType.includes("mp4") ? "m4a" : "webm";
        const file = new File(
          chunks,
          `voice-message-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`,
          { type: mimeType }
        );

        if (file.size > 0) {
          onSelectFiles([file]);
        }

        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
        setIsRecording(false);
      };

      recorder.onerror = () => {
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
        setIsRecording(false);
        window.alert("錄音失敗，請再試一次。");
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error(error);
      window.alert("無法存取麥克風，請確認瀏覽器權限設定。");
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
          {pendingUploads.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-3 px-2">
              {pendingUploads.map((upload) => {
                const isImage = upload.kind === "image";
                const isAudio = upload.kind === "audio";

                return (
                  <div
                    key={upload.id}
                    className={`relative overflow-hidden rounded-2xl border ${
                      isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"
                    }`}
                  >
                    <button
                      onClick={() => onRemoveUpload(upload.id)}
                      className={`absolute right-2 top-2 z-10 rounded-full px-2 py-1 text-[11px] ${
                        isDark
                          ? "bg-black/60 text-white/80"
                          : "bg-white/90 text-slate-600 shadow"
                      }`}
                    >
                      移除
                    </button>

                    {isImage ? (
                      <div className="w-28">
                        <img
                          src={upload.dataUrl}
                          alt={upload.name}
                          className="h-24 w-full object-cover"
                        />
                        <div className="p-2 text-xs">
                          <div className="truncate">{upload.name}</div>
                          <div className={isDark ? "text-white/45" : "text-slate-500"}>
                            圖片
                          </div>
                        </div>
                      </div>
                    ) : isAudio ? (
                      <div className="w-72 p-3 pr-16 text-xs">
                        <div className="mb-2 font-medium">音訊</div>
                        <div className="truncate">{upload.name}</div>
                        <audio controls className="mt-3 w-full">
                          <source src={upload.dataUrl} type={upload.mimeType} />
                        </audio>
                        <div className={`mt-2 ${isDark ? "text-white/45" : "text-slate-500"}`}>
                          {(upload.size / 1024 / 1024).toFixed(2)} MB
                        </div>
                      </div>
                    ) : (
                      <div className="w-52 p-3 pr-16 text-xs">
                        <div className="mb-2 font-medium">PDF</div>
                        <div className="truncate">{upload.name}</div>
                        <div className={`mt-1 ${isDark ? "text-white/45" : "text-slate-500"}`}>
                          {(upload.size / 1024 / 1024).toFixed(2)} MB
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex items-end gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,audio/*,.pdf,application/pdf"
              multiple
              className="hidden"
              onChange={(e) => {
                onSelectFiles(e.target.files);
                e.currentTarget.value = "";
              }}
            />

            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isStreaming}
              className={`rounded-2xl border px-4 py-3 text-sm transition ${
                isDark
                  ? "border-white/10 bg-white/5 text-white/80 hover:bg-white/10"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              } disabled:cursor-not-allowed disabled:opacity-50`}
              title="加入圖片、音訊或 PDF"
            >
              +
            </button>

            <button
              onClick={handleToggleRecording}
              disabled={isStreaming}
              className={`rounded-2xl border px-4 py-3 text-sm transition ${
                isRecording
                  ? "border-red-400 bg-red-500 text-white"
                  : isDark
                  ? "border-white/10 bg-white/5 text-white/80 hover:bg-white/10"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              } disabled:cursor-not-allowed disabled:opacity-50`}
              title={isRecording ? "停止錄音" : "錄製語音訊息"}
            >
              {isRecording ? "停止" : "麥克風"}
            </button>

            <textarea
              value={input}
              onChange={(e) => onChangeInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={3}
              placeholder="輸入訊息、錄製語音，或上傳圖片 / PDF..."
              className={`max-h-56 min-h-[72px] flex-1 resize-none bg-transparent px-3 py-2 text-[15px] focus:outline-none ${
                isDark
                  ? "text-white placeholder:text-white/30"
                  : "text-slate-900 placeholder:text-slate-400"
              }`}
            />

            <button
              onClick={onSend}
              disabled={isStreaming || !canSend}
              className="rounded-2xl bg-gradient-to-r from-cyan-400 via-sky-500 to-emerald-400 px-5 py-3 text-sm font-medium text-white shadow-lg shadow-cyan-500/20 transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isStreaming ? "傳送中..." : "送出"}
            </button>
          </div>

          <div className={`mt-2 px-3 text-xs ${isDark ? "text-white/30" : "text-slate-400"}`}>
            支援圖片、音訊與 PDF。可用麥克風錄音，Enter 送出，Shift + Enter 換行。
          </div>
        </div>
      </div>
    </div>
  );
}
