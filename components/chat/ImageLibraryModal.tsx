/* eslint-disable @next/next/no-img-element */
"use client";

import { useMemo, useState } from "react";
import type { AssetKind, AssetRecord, ChatRoom } from "@/types/chat";

type ThemeMode = "dark" | "light";
type FilterValue = "all" | AssetKind;

type ImageLibraryModalProps = {
  assets: AssetRecord[];
  chats: ChatRoom[];
  open: boolean;
  theme: ThemeMode;
  onClose: () => void;
  onDeleteAsset: (assetId: string) => void;
  onGoToMessage: (chatId: number, messageId: number) => void;
};

function getAssetLabel(kind: AssetKind) {
  if (kind === "image") return "圖片";
  if (kind === "audio") return "音訊";
  return "PDF";
}

export default function ImageLibraryModal({
  assets,
  chats,
  open,
  theme,
  onClose,
  onDeleteAsset,
  onGoToMessage,
}: ImageLibraryModalProps) {
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [showOptions, setShowOptions] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterValue>("all");
  const isDark = theme === "dark";

  const filteredAssets = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return [...assets]
      .filter((asset) => (filter === "all" ? true : asset.kind === filter))
      .filter((asset) =>
        normalizedSearch ? asset.name.toLowerCase().includes(normalizedSearch) : true
      )
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  }, [assets, filter, search]);

  const selectedAsset =
    filteredAssets.find((asset) => asset.id === selectedAssetId) ??
    assets.find((asset) => asset.id === selectedAssetId) ??
    filteredAssets[0] ??
    null;

  const sourceChat = selectedAsset
    ? chats.find((chat) => chat.id === selectedAsset.sourceChatId) ?? null
    : null;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex bg-black/70">
      <div
        className={`m-auto flex h-[88vh] w-[min(1200px,94vw)] overflow-hidden rounded-[32px] border ${
          isDark
            ? "border-white/10 bg-[#08111d] text-white"
            : "border-slate-200 bg-white text-slate-900"
        }`}
      >
        <div
          className={`flex w-[360px] shrink-0 flex-col border-r p-5 ${
            isDark ? "border-white/10" : "border-slate-200"
          }`}
        >
          <div className="flex items-center justify-between">
            <div>
              <p
                className={`text-xs uppercase tracking-[0.2em] ${
                  isDark ? "text-white/40" : "text-slate-400"
                }`}
              >
                資料庫
              </p>
              <h3 className="mt-2 text-xl font-semibold">所有資料</h3>
            </div>
            <button
              onClick={onClose}
              className={`rounded-full px-3 py-2 text-sm ${
                isDark ? "bg-white/10 text-white" : "bg-slate-100 text-slate-700"
              }`}
            >
              關閉
            </button>
          </div>

          <div className="mt-5 space-y-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="依檔名搜尋..."
              className={`w-full rounded-2xl border px-4 py-3 text-sm outline-none ${
                isDark
                  ? "border-white/10 bg-white/5 text-white placeholder:text-white/35"
                  : "border-slate-200 bg-slate-50 text-slate-900 placeholder:text-slate-400"
              }`}
            />

            <div className="flex gap-2">
              {(["all", "image", "audio", "pdf"] as const).map((value) => (
                <button
                  key={value}
                  onClick={() => setFilter(value)}
                  className={`rounded-full px-3 py-2 text-xs font-medium transition ${
                    filter === value
                      ? "bg-gradient-to-r from-cyan-400 via-sky-500 to-emerald-400 text-white"
                      : isDark
                      ? "bg-white/5 text-white/75 hover:bg-white/10"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  {value === "all"
                    ? "全部"
                    : value === "image"
                    ? "圖片"
                    : value === "audio"
                    ? "音訊"
                    : "PDF"}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5 flex-1 space-y-3 overflow-y-auto pr-1">
            {filteredAssets.length > 0 ? (
              filteredAssets.map((asset) => (
                <button
                  key={asset.id}
                  onClick={() => {
                    setSelectedAssetId(asset.id);
                    setShowOptions(false);
                  }}
                  className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition ${
                    selectedAsset?.id === asset.id
                      ? isDark
                        ? "border-cyan-400/40 bg-cyan-400/10"
                        : "border-cyan-300 bg-cyan-50"
                      : isDark
                      ? "border-white/10 bg-white/5 hover:bg-white/10"
                      : "border-slate-200 bg-slate-50 hover:bg-slate-100"
                  }`}
                >
                  {asset.kind === "image" ? (
                    <img
                      src={asset.dataUrl}
                      alt={asset.name}
                      className="h-16 w-16 rounded-xl object-cover"
                    />
                  ) : (
                    <div
                      className={`flex h-16 w-16 items-center justify-center rounded-xl text-xs font-semibold ${
                        isDark ? "bg-white/10 text-white/80" : "bg-slate-200 text-slate-700"
                      }`}
                    >
                      {getAssetLabel(asset.kind).toUpperCase()}
                    </div>
                  )}

                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{asset.name}</div>
                    <div
                      className={`mt-1 text-xs ${
                        isDark ? "text-white/45" : "text-slate-500"
                      }`}
                    >
                      {getAssetLabel(asset.kind)} ·{" "}
                      {new Date(asset.uploadedAt).toLocaleString("zh-TW")}
                    </div>
                  </div>
                </button>
              ))
            ) : (
              <div
                className={`rounded-2xl border p-4 text-sm ${
                  isDark
                    ? "border-white/10 bg-white/5 text-white/60"
                    : "border-slate-200 bg-slate-50 text-slate-500"
                }`}
              >
                沒有符合條件的資料。
              </div>
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          {selectedAsset ? (
            <>
              <div
                className={`flex items-center justify-between border-b px-6 py-4 ${
                  isDark ? "border-white/10" : "border-slate-200"
                }`}
              >
                <div className="min-w-0">
                  <div className="truncate text-lg font-semibold">
                    {selectedAsset.name}
                  </div>
                  <div
                    className={`mt-1 text-sm ${
                      isDark ? "text-white/45" : "text-slate-500"
                    }`}
                  >
                    {getAssetLabel(selectedAsset.kind)}資料 ·{" "}
                    {sourceChat ? `來自 ${sourceChat.name}` : "來源對話已刪除"}
                  </div>
                </div>

                <div className="relative">
                  <button
                    onClick={() => setShowOptions((prev) => !prev)}
                    className={`rounded-2xl px-4 py-2 text-sm ${
                      isDark ? "bg-white/10 text-white" : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    選項
                  </button>

                  {showOptions && (
                    <div
                      className={`absolute right-0 top-12 z-10 w-56 rounded-2xl border p-2 shadow-xl ${
                        isDark
                          ? "border-white/10 bg-[#0e1825]"
                          : "border-slate-200 bg-white"
                      }`}
                    >
                      <button
                        onClick={() => {
                          setShowOptions(false);
                          if (!sourceChat) {
                            window.alert("來源對話已不存在。");
                            return;
                          }
                          onGoToMessage(
                            selectedAsset.sourceChatId,
                            selectedAsset.sourceMessageId
                          );
                          onClose();
                        }}
                        className={`w-full rounded-xl px-3 py-2 text-left text-sm ${
                          isDark ? "hover:bg-white/10" : "hover:bg-slate-100"
                        }`}
                      >
                        前往上傳訊息
                      </button>

                      <button
                        onClick={() => {
                          setShowOptions(false);
                          onDeleteAsset(selectedAsset.id);
                        }}
                        className={`mt-1 w-full rounded-xl px-3 py-2 text-left text-sm text-red-500 ${
                          isDark ? "hover:bg-white/10" : "hover:bg-slate-100"
                        }`}
                      >
                        刪除附件
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex min-h-0 flex-1 flex-col">
                <div
                  className={`border-b px-6 py-3 text-sm ${
                    isDark ? "border-white/10 text-white/45" : "border-slate-200 text-slate-500"
                  }`}
                >
                  上傳時間：{new Date(selectedAsset.uploadedAt).toLocaleString("zh-TW")}
                </div>

                <div className="flex min-h-0 flex-1 items-center justify-center p-6">
                  {selectedAsset.kind === "image" ? (
                    <img
                      src={selectedAsset.dataUrl}
                      alt={selectedAsset.name}
                      className="max-h-full max-w-full rounded-3xl object-contain"
                    />
                  ) : selectedAsset.kind === "audio" ? (
                    <div className="w-full max-w-2xl">
                      <div
                        className={`mb-4 rounded-2xl border px-4 py-3 text-sm ${
                          isDark
                            ? "border-white/10 bg-white/5 text-white/75"
                            : "border-slate-200 bg-slate-50 text-slate-700"
                        }`}
                      >
                        音訊預覽
                      </div>
                      <div
                        className={`rounded-3xl border p-6 ${
                          isDark
                            ? "border-white/10 bg-white/5"
                            : "border-slate-200 bg-slate-50"
                        }`}
                      >
                        <div className="mb-4 text-lg font-medium">{selectedAsset.name}</div>
                        <audio controls className="w-full">
                          <source src={selectedAsset.dataUrl} type={selectedAsset.mimeType} />
                        </audio>
                      </div>
                    </div>
                  ) : (
                    <div className="flex h-full w-full flex-col">
                      <div
                        className={`mb-4 rounded-2xl border px-4 py-3 text-sm ${
                          isDark
                            ? "border-white/10 bg-white/5 text-white/75"
                            : "border-slate-200 bg-slate-50 text-slate-700"
                        }`}
                      >
                        PDF 預覽
                      </div>
                      <iframe
                        src={selectedAsset.dataUrl}
                        title={selectedAsset.name}
                        className={`min-h-0 w-full flex-1 rounded-2xl border ${
                          isDark ? "border-white/10 bg-white" : "border-slate-200 bg-white"
                        }`}
                      />
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-6 text-center">
              <div>
                <div className="text-3xl font-semibold">請選擇資料</div>
                <div
                  className={`mt-3 text-sm ${
                    isDark ? "text-white/45" : "text-slate-500"
                  }`}
                >
                  可搜尋、篩選、預覽、刪除，或跳回原本的上傳訊息。
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
