import { ai } from "@/lib/gemini";
import type { Message } from "@/types/chat";

export function buildRecentMessages(messages: Message[], memoryTurns: number) {
  const recentCount = Math.max(memoryTurns * 2, 2);
  return messages.slice(-recentCount);
}

export function toGeminiContents(memorySummary: string, recentMessages: Message[]) {
  const contents: Array<{
    role: "user" | "model";
    parts: Array<{ text: string }>;
  }> = [];

  if (memorySummary.trim()) {
    contents.push({
      role: "user",
      parts: [
        {
          text: `以下是這段對話較早內容的摘要，請把它當成背景記憶參考：\n${memorySummary}`,
        },
      ],
    });
  }

  for (const msg of recentMessages) {
    contents.push({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }],
    });
  }

  return contents;
}

export async function buildMemorySummary(
  allMessages: Message[],
  memoryTurns: number,
  previousSummary: string,
  model: string
) {
  const cutoff = Math.max(allMessages.length - memoryTurns * 2, 0);
  const olderMessages = allMessages.slice(0, cutoff);

  if (olderMessages.length === 0) {
    return previousSummary;
  }

  const joined = olderMessages
    .map((m) => `${m.role === "user" ? "使用者" : "助手"}：${m.content}`)
    .join("\n");

  const prompt = `
你是「對話短期記憶整理器」。
請根據提供的先前摘要與較早對話內容，輸出一份更新後的短期記憶摘要。

規則：
1. 只輸出摘要內容本身。
2. 不要加入任何前言、開場白、解釋、客套話。
3. 不要寫「好的」、「以下是摘要」、「這是根據目前對話整理的內容」這類句子。
4. 使用繁體中文。
5. 控制在 200 字內。
6. 只保留對後續對話有幫助的資訊：使用者偏好、目前任務、已完成決策、重要上下文。
7. 若沒有值得保留的新資訊，直接輸出先前摘要；若先前摘要也沒有內容，輸出「無」。

先前摘要：
${previousSummary || "無"}

較早對話內容：
${joined}

請直接輸出更新後的短期記憶摘要：
`;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      temperature: 0.2,
      maxOutputTokens: 256,
    },
  });

  const rawText = response.text?.trim() ?? previousSummary;

  return rawText
    .replace(/^好的[，、,:：]?\s*/u, "")
    .replace(/^以下是.*?摘要[：:]?\s*/u, "")
    .replace(/^這是根據目前對話內容.*?[：:]?\s*/u, "")
    .replace(/^短期對話摘要[：:]?\s*/u, "")
    .trim();
}