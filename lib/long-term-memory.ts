import { ai } from "@/lib/gemini";
import type { Message } from "@/types/chat";

const MAX_LONG_TERM_MEMORIES = 12;
type MemoryLanguage = "zh-TW" | "en";

function shouldKeepMemory(item: string) {
  const normalized = item.toLowerCase();

  const blockedPatterns = [
    "telegram",
    "discord",
    "chat id",
    "channel id",
    "user id",
    "bot token",
    "api key",
    "target name",
    "default target",
    "default channel",
    "alias",
    "mapped to",
    "configured successfully",
  ];

  return !blockedPatterns.some((pattern) => normalized.includes(pattern));
}

function normalizeMemories(memories: string[]) {
  const seen = new Set<string>();

  return memories
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter(shouldKeepMemory)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_LONG_TERM_MEMORIES);
}

function extractJsonArray(rawText: string) {
  const fencedMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fencedMatch ? fencedMatch[1] : rawText;

  try {
    const parsed = JSON.parse(candidate);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function buildLongTermMemoryContext(memories: string[]) {
  const normalized = normalizeMemories(memories);

  if (normalized.length === 0) {
    return "";
  }

  return [
    "以下是用於延續對話的長期背景記憶：",
    ...normalized.map((item, index) => `${index + 1}. ${item}`),
    "這些記憶只用於背景理解與延續性。",
    "除非使用者這一輪的需求明確依賴這些記憶，否則不要主動提及、打招呼式引用，或把它們直接改寫進一般回覆。",
    "若記憶和目前任務無關，尤其是玩笑、角色扮演或低相關個人細節，請忽略。",
    "如果新訊息和舊記憶衝突，優先以新的使用者訊息為準。",
  ].join("\n");
}

export async function updateLongTermMemories(
  allMessages: Message[],
  previousMemories: string[],
  model: string,
  language: MemoryLanguage = "zh-TW"
) {
  if (allMessages.length === 0) {
    return normalizeMemories(previousMemories);
  }

  const recentTranscript = allMessages
    .slice(-8)
    .map((message) => {
      const attachmentText =
        message.attachments && message.attachments.length > 0
          ? language === "en"
            ? ` | Attachments: ${message.attachments
                .map((attachment) => attachment.name)
                .join(", ")}`
            : ` | 附件：${message.attachments
                .map((attachment) => attachment.name)
                .join("、")}`
          : "";

      return `${message.role === "user" ? (language === "en" ? "User" : "使用者") : language === "en" ? "Assistant" : "助理"}: ${message.content}${attachmentText}`;
    })
    .join("\n");

  const languageInstruction =
    language === "en"
      ? "Record the memory items in English."
      : "請將記憶項目以繁體中文記錄。只有當使用者明確要求英文時才改用英文。";

  const prompt = `
You maintain long-term memory for a personal AI assistant.

Keep only durable, reusable facts that would help in future chats. Good memory candidates:
- user preferences
- profile/background
- ongoing projects or long-lived goals
- stable constraints or recurring needs

Do not keep:
- one-off requests
- temporary details
- assistant-written content that the user did not confirm
- anything sensitive unless the user clearly asked the assistant to remember it
- playful roleplay identities, nicknames, or joke personas unless the user explicitly says this should permanently affect future answers
- facts that are unlikely to matter outside the immediate topic
- tool configuration details such as chat IDs, channel IDs, user IDs, alias-to-ID mappings, token status, or whether Telegram / Discord targets were configured

When uncertain, prefer not to store the memory.
${languageInstruction}

Return a strict JSON array of strings only. No markdown. No explanation.
Keep at most ${MAX_LONG_TERM_MEMORIES} items.

Existing long-term memory:
${previousMemories.length > 0 ? previousMemories.map((item) => `- ${item}`).join("\n") : "(none)"}

Recent conversation:
${recentTranscript}
`;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      temperature: 0.1,
      maxOutputTokens: 512,
    },
  });

  const extracted = extractJsonArray(response.text ?? "");

  if (extracted.length === 0) {
    return normalizeMemories(previousMemories);
  }

  return normalizeMemories(extracted);
}
