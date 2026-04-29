import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mcpToTool, type CallableTool } from "@google/genai";

type SupportedMcpServer = "weather" | "time" | "search" | "telegram" | "discord";

const serverFileMap: Record<SupportedMcpServer, string> = {
  weather: "weather-server.cjs",
  time: "time-server.cjs",
  search: "search-server.cjs",
  telegram: "telegram-server.cjs",
  discord: "discord-server.cjs",
};

const clientPromises = new Map<SupportedMcpServer, Promise<Client>>();
const NON_CACHED_SERVERS = new Set<SupportedMcpServer>(["telegram", "discord"]);

async function createClient(serverName: SupportedMcpServer) {
  const client = new Client({
    name: `chatweb-${serverName}-client`,
    version: "1.0.0",
  });

  const serverPath = path.join(
    process.cwd(),
    "mcp-servers",
    serverFileMap[serverName]
  );

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    stderr: "pipe",
    env: {
      NODE_NO_WARNINGS: "1",
      ...process.env,
    },
  });

  await client.connect(transport);
  return client;
}

async function getMcpTool(serverName: SupportedMcpServer): Promise<CallableTool> {
  if (NON_CACHED_SERVERS.has(serverName)) {
    const client = await createClient(serverName);
    return mcpToTool(client);
  }

  if (!clientPromises.has(serverName)) {
    clientPromises.set(
      serverName,
      createClient(serverName).catch((error) => {
        clientPromises.delete(serverName);
        throw error;
      })
    );
  }

  const client = await clientPromises.get(serverName)!;
  return mcpToTool(client);
}

export async function getWeatherMcpTool() {
  return getMcpTool("weather");
}

export async function getTimeMcpTool() {
  return getMcpTool("time");
}

export async function getSearchMcpTool() {
  return getMcpTool("search");
}

export async function getTelegramMcpTool() {
  return getMcpTool("telegram");
}

export async function getDiscordMcpTool() {
  return getMcpTool("discord");
}
