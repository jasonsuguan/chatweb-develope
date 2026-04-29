import type { IntegrationStatus } from "@/types/chat";

export const runtime = "nodejs";

function getTelegramNamedTargetsCount() {
  try {
    const raw = process.env.TELEGRAM_TARGETS_JSON;
    if (!raw) return 0;

    const parsed = JSON.parse(raw) as Record<string, string>;
    return Object.keys(parsed).length;
  } catch {
    return 0;
  }
}

function getDiscordNamedChannelsCount() {
  try {
    const raw = process.env.DISCORD_CHANNELS_JSON;
    if (!raw) return 0;

    const parsed = JSON.parse(raw) as Record<string, string>;
    return Object.keys(parsed).length;
  } catch {
    return 0;
  }
}

function getDiscordNamedUsersCount() {
  try {
    const raw = process.env.DISCORD_USERS_JSON;
    if (!raw) return 0;

    const parsed = JSON.parse(raw) as Record<string, string>;
    return Object.keys(parsed).length;
  } catch {
    return 0;
  }
}

export async function GET() {
  const payload: IntegrationStatus = {
    telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim()),
    telegramDefaultTargetConfigured: Boolean(
      process.env.TELEGRAM_CHAT_ID_DEFAULT?.trim()
    ),
    telegramNamedTargetsCount: getTelegramNamedTargetsCount(),
    discordConfigured: Boolean(process.env.DISCORD_BOT_TOKEN?.trim()),
    discordDefaultChannelConfigured: Boolean(
      process.env.DISCORD_CHANNEL_ID_DEFAULT?.trim()
    ),
    discordNamedChannelsCount: getDiscordNamedChannelsCount(),
    discordNamedUsersCount: getDiscordNamedUsersCount(),
    timeMcpEnabled: true,
    searchMcpEnabled: true,
    telegramMcpEnabled: true,
    discordMcpEnabled: true,
    weatherMcpEnabled: true,
  };

  return Response.json(payload);
}
