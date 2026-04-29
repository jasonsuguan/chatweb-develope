/* eslint-disable @typescript-eslint/no-require-imports */
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const z = require("zod");

function normalizeTelegramTarget(value) {
  return String(value || "")
    .trim()
    .replace(/^[\s"'`()[\]{}<>.,!?;:]+/u, "")
    .replace(/[\s"'`()[\]{}<>.,!?;:]+$/u, "")
    .trim()
    .toLowerCase();
}

function resolveTelegramChatId(target) {
  const normalizedTarget = normalizeTelegramTarget(target);

  if (!normalizedTarget) {
    return process.env.TELEGRAM_CHAT_ID_DEFAULT?.trim() ?? "";
  }

  if (/^-?\d+$/.test(normalizedTarget) || normalizedTarget.startsWith("@")) {
    return normalizedTarget;
  }

  try {
    const raw = process.env.TELEGRAM_TARGETS_JSON;
    if (!raw) return "";
    const parsed = JSON.parse(raw);

    for (const [key, value] of Object.entries(parsed)) {
      if (normalizeTelegramTarget(key) === normalizedTarget) {
        return typeof value === "string" ? value.trim() : "";
      }
    }

    return "";
  } catch {
    return "";
  }
}

async function sendTelegramMessage(target, message) {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
  const chatId = resolveTelegramChatId(target);

  if (!token) {
    throw new Error("Telegram is not configured. TELEGRAM_BOT_TOKEN is missing.");
  }

  if (!chatId) {
    throw new Error(
      "Telegram target not found. Set TELEGRAM_CHAT_ID_DEFAULT or TELEGRAM_TARGETS_JSON."
    );
  }

  if (!message.trim()) {
    throw new Error("message is required");
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
    }),
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`Telegram API failed with HTTP ${response.status}`);
  }

  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.description || "Telegram API returned an error");
  }

  return {
    platform: "telegram",
    target: normalizeTelegramTarget(target) || "default",
    chat_id: chatId,
    message_id: data.result?.message_id ?? null,
    sent_at_unix: data.result?.date ?? null,
    status: "sent",
    source: "telegram-mcp-server",
  };
}

const server = new McpServer({
  name: "telegram-mcp-server",
  version: "1.0.0",
});

server.registerTool(
  "send_telegram_message",
  {
    description:
      "Send a Telegram message. Only use this when the user explicitly asks you to send or notify someone via Telegram.",
    inputSchema: {
      target: z
        .string()
        .optional()
        .describe(
          "Optional target label from TELEGRAM_TARGETS_JSON, raw chat id, or @channel username."
        ),
      message: z.string().describe("The message text to send"),
    },
  },
  async ({ target, message }) => {
    try {
      const output = await sendTelegramMessage(target ?? "", message);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(output),
          },
        ],
        structuredContent: output,
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              error instanceof Error ? error.message : "Unknown Telegram tool error",
          },
        ],
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Telegram MCP server error:", error);
  process.exit(1);
});
