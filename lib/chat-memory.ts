import { ai } from "@/lib/gemini";
import type { ChatRequestMessage, Message, RequestAttachment } from "@/types/chat";

type MemoryLanguage = "zh-TW" | "en";

type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

function dataUrlToBase64(dataUrl: string) {
  const [, base64 = ""] = dataUrl.split(",", 2);
  return base64;
}

function buildAttachmentParts(attachments: RequestAttachment[] = []): GeminiPart[] {
  const parts: GeminiPart[] = [];

  for (const attachment of attachments) {
    const data = dataUrlToBase64(attachment.dataUrl);
    if (!data) {
      continue;
    }

    parts.push({
      inlineData: {
        mimeType: attachment.mimeType,
        data,
      },
    });
  }

  return parts;
}

function describeAttachments(
  attachments: Array<{ kind: string; name: string }> = [],
  language: MemoryLanguage = "zh-TW"
) {
  if (attachments.length === 0) return "";

  return attachments
    .map((attachment) =>
      language === "en"
        ? `[${attachment.kind.toUpperCase()}] ${attachment.name}`
        : `[${attachment.kind.toUpperCase()}] ${attachment.name}`
    )
    .join(language === "en" ? ", " : "、");
}

export function buildRecentMessages(
  messages: ChatRequestMessage[],
  memoryTurns: number
) {
  const recentCount = Math.max(memoryTurns * 2, 2);
  return messages.slice(-recentCount);
}

export function toGeminiContents(
  memorySummary: string,
  recentMessages: ChatRequestMessage[],
  longTermMemoryContext = ""
) {
  const contents: Array<{
    role: "user" | "model";
    parts: GeminiPart[];
  }> = [];

  if (longTermMemoryContext.trim()) {
    contents.push({
      role: "user",
      parts: [{ text: longTermMemoryContext }],
    });
  }

  if (memorySummary.trim()) {
    contents.push({
      role: "user",
      parts: [
        {
          text: `先前對話摘要：\n${memorySummary}`,
        },
      ],
    });
  }

  for (const message of recentMessages) {
    const parts: GeminiPart[] = [];

    if (message.content.trim()) {
      parts.push({ text: message.content });
    }

    parts.push(...buildAttachmentParts(message.attachments));

    if (parts.length === 0) {
      parts.push({ text: "使用者送出了一則空白訊息。" });
    }

    contents.push({
      role: message.role === "assistant" ? "model" : "user",
      parts,
    });
  }

  return contents;
}

export async function buildMemorySummary(
  allMessages: Message[],
  memoryTurns: number,
  previousSummary: string,
  model: string,
  language: MemoryLanguage = "zh-TW"
) {
  const cutoff = Math.max(allMessages.length - memoryTurns * 2, 0);
  const olderMessages = allMessages.slice(0, cutoff);

  if (olderMessages.length === 0) {
    return previousSummary;
  }

  const joined = olderMessages
    .map((message) => {
      const attachments = describeAttachments(message.attachments, language);
      const suffix =
        attachments.length > 0
          ? language === "en"
            ? ` | Attachments: ${attachments}`
            : ` | 附件：${attachments}`
          : "";

      return `${message.role === "user" ? (language === "en" ? "User" : "使用者") : language === "en" ? "Assistant" : "助理"}: ${message.content}${suffix}`;
    })
    .join("\n");

  const languageInstruction =
    language === "en"
      ? "Write the summary in English."
      : "請將摘要以繁體中文撰寫。只有當使用者明確要求英文時才改用英文。";

  const prompt = `
You maintain a concise rolling conversation summary for an AI assistant.

Summarize only durable conversational context that helps future replies inside the same chat.
- Keep it compact and factual.
- Include user goals, constraints, preferences, and unresolved tasks.
- Mention uploaded files only when they matter for later context.
- Do not invent facts.
- Keep the summary under 200 words.
${languageInstruction}

Previous summary:
${previousSummary || "(none)"}

Older conversation:
${joined}
`;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      temperature: 0.2,
      maxOutputTokens: 256,
    },
  });

  return response.text?.trim() ?? previousSummary;
}
