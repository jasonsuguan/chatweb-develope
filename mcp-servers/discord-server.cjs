/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("node:path");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const z = require("zod");

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function normalizeTarget(value) {
  return String(value || "")
    .trim()
    .replace(/^[\s"'`#@()[\]{}<>.,!?;:]+/u, "")
    .replace(/[\s"'`()[\]{}<>.,!?;:]+$/u, "")
    .trim()
    .toLowerCase();
}

function parseMapping(rawValue) {
  try {
    if (!rawValue) return {};
    const parsed = JSON.parse(rawValue);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function resolveMappedId(rawTarget, rawMapping) {
  const normalizedTarget = normalizeTarget(rawTarget);
  if (!normalizedTarget) return "";

  if (/^\d+$/.test(normalizedTarget)) {
    return normalizedTarget;
  }

  const mapping = parseMapping(rawMapping);
  for (const [key, value] of Object.entries(mapping)) {
    if (normalizeTarget(key) === normalizedTarget && typeof value === "string") {
      return value.trim();
    }
  }

  return "";
}

function resolveChannelId(target) {
  const normalizedTarget = normalizeTarget(target);
  if (!normalizedTarget) {
    return process.env.DISCORD_CHANNEL_ID_DEFAULT?.trim() ?? "";
  }

  if (/^\d+$/.test(normalizedTarget)) {
    return normalizedTarget;
  }

  return resolveMappedId(target, process.env.DISCORD_CHANNELS_JSON);
}

function resolveUserId(target) {
  const normalizedTarget = normalizeTarget(target);
  if (!normalizedTarget) return "";

  if (/^\d+$/.test(normalizedTarget)) {
    return normalizedTarget;
  }

  return resolveMappedId(target, process.env.DISCORD_USERS_JSON);
}

function inferExtension(mimeType) {
  const mapping = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
  };

  return mapping[mimeType] ?? "png";
}

function safeFilenameFromUrl(url, mimeType) {
  try {
    const pathname = new URL(url).pathname;
    const baseName = path.basename(pathname).replace(/[^\w.-]+/g, "_");
    if (baseName && baseName.includes(".")) {
      return baseName;
    }
  } catch {
    // ignore
  }

  return `discord-image.${inferExtension(mimeType)}`;
}

function buildMessagePayload(content = "") {
  return {
    content,
    allowed_mentions: {
      parse: [],
    },
  };
}

async function discordRequest(pathname, init = {}) {
  const token = process.env.DISCORD_BOT_TOKEN?.trim() ?? "";

  if (!token) {
    throw new Error("Discord is not configured. DISCORD_BOT_TOKEN is missing.");
  }

  const headers = new Headers(init.headers ?? {});
  headers.set("Authorization", `Bot ${token}`);

  if (!headers.has("Content-Type") && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`https://discord.com/api/v10${pathname}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Discord API failed with HTTP ${response.status}: ${errorText}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

async function resolveDiscordChannel({ target, delivery }) {
  const resolvedDelivery = String(delivery || "channel").trim().toLowerCase();

  if (resolvedDelivery === "channel") {
    const channelId = resolveChannelId(target);
    if (!channelId) {
      throw new Error(
        "Discord channel target not found. Set DISCORD_CHANNEL_ID_DEFAULT or DISCORD_CHANNELS_JSON."
      );
    }

    return {
      delivery: "channel",
      resolvedTarget: normalizeTarget(target) || "default",
      channelId,
      recipientId: null,
    };
  }

  if (resolvedDelivery === "dm") {
    const recipientId = resolveUserId(target);
    if (!recipientId) {
      throw new Error(
        "Discord DM target not found. Add a user mapping in DISCORD_USERS_JSON or use a raw Discord user ID."
      );
    }

    const dmChannel = await discordRequest("/users/@me/channels", {
      method: "POST",
      body: JSON.stringify({
        recipient_id: recipientId,
      }),
    });

    return {
      delivery: "dm",
      resolvedTarget: normalizeTarget(target),
      channelId: dmChannel.id,
      recipientId,
    };
  }

  throw new Error("delivery must be either 'channel' or 'dm'");
}

async function createDiscordMessage(destination, payload) {
  return discordRequest(`/channels/${destination.channelId}/messages`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function createDiscordMultipartMessage(destination, payload, file) {
  const formData = new FormData();
  formData.append("payload_json", JSON.stringify(payload));
  formData.append(
    "files[0]",
    new Blob([file.buffer], { type: file.mimeType }),
    file.filename
  );

  return discordRequest(`/channels/${destination.channelId}/messages`, {
    method: "POST",
    body: formData,
  });
}

async function searchImageOnWikimedia(query) {
  const searchUrl =
    "https://commons.wikimedia.org/w/api.php?" +
    new URLSearchParams({
      action: "query",
      format: "json",
      origin: "*",
      generator: "search",
      gsrsearch: query,
      gsrnamespace: "6",
      gsrlimit: "5",
      prop: "imageinfo",
      iiprop: "url|mime",
    }).toString();

  const response = await fetch(searchUrl, {
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`Image search failed with HTTP ${response.status}`);
  }

  const data = await response.json();
  const pages = Object.values(data?.query?.pages ?? {});

  const firstImage = pages
    .map((page) => page.imageinfo?.[0])
    .find((image) => image?.url && image?.mime?.startsWith("image/"));

  if (!firstImage) {
    throw new Error(`No suitable image found for query: ${query}`);
  }

  return {
    url: firstImage.url,
    mimeType: firstImage.mime,
    source: "wikimedia-commons",
  };
}

async function fetchImageAsset({ imageUrl, searchQuery }) {
  let resolvedImageUrl = String(imageUrl || "").trim();
  let discoveredFromQuery = null;

  if (!resolvedImageUrl) {
    const query = String(searchQuery || "").trim();
    if (!query) {
      throw new Error("Either image_url or search_query is required.");
    }

    discoveredFromQuery = await searchImageOnWikimedia(query);
    resolvedImageUrl = discoveredFromQuery.url;
  }

  const response = await fetch(resolvedImageUrl, {
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`Image download failed with HTTP ${response.status}`);
  }

  const mimeType =
    response.headers.get("content-type")?.split(";")[0]?.trim() ||
    discoveredFromQuery?.mimeType ||
    "application/octet-stream";

  if (!mimeType.startsWith("image/")) {
    throw new Error(`The provided URL did not return an image. MIME type: ${mimeType}`);
  }

  const contentLength = Number(response.headers.get("content-length") || "0");
  if (contentLength > MAX_IMAGE_BYTES) {
    throw new Error("The image is too large for Discord upload in this demo.");
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_IMAGE_BYTES) {
    throw new Error("The image is too large for Discord upload in this demo.");
  }

  return {
    buffer: Buffer.from(arrayBuffer),
    mimeType,
    filename: safeFilenameFromUrl(resolvedImageUrl, mimeType),
    sourceUrl: resolvedImageUrl,
    searchSource: discoveredFromQuery?.source ?? null,
  };
}

async function sendDiscordMessage({ target, message, delivery }) {
  const trimmedMessage = String(message || "").trim();

  if (!trimmedMessage) {
    throw new Error("message is required");
  }

  const destination = await resolveDiscordChannel({ target, delivery });
  const created = await createDiscordMessage(
    destination,
    buildMessagePayload(trimmedMessage)
  );

  return {
    platform: "discord",
    delivery: destination.delivery,
    target: destination.resolvedTarget,
    channel_id: destination.channelId,
    recipient_id: destination.recipientId,
    message_id: created?.id ?? null,
    status: "sent",
    source: "discord-mcp-server",
  };
}

async function createDiscordPoll({
  target,
  delivery,
  question,
  answers,
  duration_hours,
  allow_multiselect,
  message,
}) {
  const trimmedQuestion = String(question || "").trim();
  const normalizedAnswers = Array.isArray(answers)
    ? answers.map((item) => String(item || "").trim()).filter(Boolean)
    : [];

  if (!trimmedQuestion) {
    throw new Error("question is required");
  }

  if (normalizedAnswers.length < 2) {
    throw new Error("A Discord poll requires at least 2 answers.");
  }

  const durationHours = Math.min(
    Math.max(Number(duration_hours || 24), 1),
    168
  );

  const destination = await resolveDiscordChannel({ target, delivery });
  const created = await createDiscordMessage(destination, {
    ...buildMessagePayload(String(message || "").trim()),
    poll: {
      question: {
        text: trimmedQuestion,
      },
      answers: normalizedAnswers.map((answer) => ({
        poll_media: {
          text: answer,
        },
      })),
      duration: durationHours,
      allow_multiselect: Boolean(allow_multiselect),
    },
  });

  return {
    platform: "discord",
    delivery: destination.delivery,
    target: destination.resolvedTarget,
    channel_id: destination.channelId,
    recipient_id: destination.recipientId,
    message_id: created?.id ?? null,
    poll_question: trimmedQuestion,
    poll_answers: normalizedAnswers,
    duration_hours: durationHours,
    allow_multiselect: Boolean(allow_multiselect),
    status: "sent",
    source: "discord-mcp-server",
  };
}

async function sendDiscordImage({
  target,
  delivery,
  caption,
  image_url,
  search_query,
}) {
  const destination = await resolveDiscordChannel({ target, delivery });
  const image = await fetchImageAsset({
    imageUrl: image_url,
    searchQuery: search_query,
  });

  const payload = {
    ...buildMessagePayload(String(caption || "").trim()),
    attachments: [
      {
        id: "0",
        filename: image.filename,
      },
    ],
  };

  const created = await createDiscordMultipartMessage(destination, payload, image);

  return {
    platform: "discord",
    delivery: destination.delivery,
    target: destination.resolvedTarget,
    channel_id: destination.channelId,
    recipient_id: destination.recipientId,
    message_id: created?.id ?? null,
    image_filename: image.filename,
    image_source_url: image.sourceUrl,
    image_search_source: image.searchSource,
    status: "sent",
    source: "discord-mcp-server",
  };
}

const server = new McpServer({
  name: "discord-mcp-server",
  version: "2.0.0",
});

server.registerTool(
  "send_discord_message",
  {
    description:
      "Send a Discord text message to a configured server channel or direct-message target. Only use this when the user explicitly asks to send or notify someone on Discord.",
    inputSchema: {
      target: z
        .string()
        .optional()
        .describe(
          "Channel alias, raw channel ID, user alias, or raw user ID depending on delivery mode."
        ),
      message: z.string().describe("The message text to send"),
      delivery: z
        .enum(["channel", "dm"])
        .optional()
        .describe("Use 'channel' for a server channel or 'dm' for a direct message"),
    },
  },
  async ({ target, message, delivery }) => {
    try {
      const output = await sendDiscordMessage({ target, message, delivery });
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: error instanceof Error ? error.message : "Unknown Discord tool error",
          },
        ],
      };
    }
  }
);

server.registerTool(
  "create_discord_poll",
  {
    description:
      "Create a Discord poll in a server channel or DM. Use this only when the user explicitly asks to create a poll.",
    inputSchema: {
      target: z
        .string()
        .optional()
        .describe(
          "Channel alias, raw channel ID, user alias, or raw user ID depending on delivery mode."
        ),
      delivery: z
        .enum(["channel", "dm"])
        .optional()
        .describe("Use 'channel' for a server channel or 'dm' for a direct message"),
      question: z.string().describe("The poll question"),
      answers: z
        .array(z.string())
        .min(2)
        .max(10)
        .describe("A list of poll answer options"),
      duration_hours: z
        .number()
        .int()
        .min(1)
        .max(168)
        .optional()
        .describe("Poll duration in hours"),
      allow_multiselect: z
        .boolean()
        .optional()
        .describe("Whether the poll allows selecting multiple answers"),
      message: z
        .string()
        .optional()
        .describe("Optional message content to include with the poll"),
    },
  },
  async (args) => {
    try {
      const output = await createDiscordPoll(args);
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: error instanceof Error ? error.message : "Unknown Discord poll error",
          },
        ],
      };
    }
  }
);

server.registerTool(
  "send_discord_image",
  {
    description:
      "Send an image to Discord. You can provide a direct image URL or a search query and the tool will find an image before sending it.",
    inputSchema: {
      target: z
        .string()
        .optional()
        .describe(
          "Channel alias, raw channel ID, user alias, or raw user ID depending on delivery mode."
        ),
      delivery: z
        .enum(["channel", "dm"])
        .optional()
        .describe("Use 'channel' for a server channel or 'dm' for a direct message"),
      caption: z
        .string()
        .optional()
        .describe("Optional caption to send with the image"),
      image_url: z
        .string()
        .url()
        .optional()
        .describe("Direct URL to an image"),
      search_query: z
        .string()
        .optional()
        .describe("Search query used to find an image automatically if image_url is not provided"),
    },
  },
  async (args) => {
    try {
      const output = await sendDiscordImage(args);
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: error instanceof Error ? error.message : "Unknown Discord image error",
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
  console.error("Discord MCP server error:", error);
  process.exit(1);
});
