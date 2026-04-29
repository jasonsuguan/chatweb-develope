/* eslint-disable @typescript-eslint/no-require-imports */
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const z = require("zod");

async function geocodeLocation(location) {
  const response = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
      location
    )}&count=1&language=zh&format=json`,
    {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    }
  );

  if (!response.ok) {
    throw new Error(`Geocoding failed with HTTP ${response.status}`);
  }

  const data = await response.json();
  return data.results?.[0] ?? null;
}

async function getCurrentTime({ timezone, location }) {
  let resolvedTimezone = (timezone || "").trim() || "Asia/Taipei";
  let resolvedLocation = (location || "").trim() || "Taipei";

  if (!timezone && location) {
    const geocoded = await geocodeLocation(location);
    if (geocoded?.timezone) {
      resolvedTimezone = geocoded.timezone;
      resolvedLocation = [geocoded.name, geocoded.admin1, geocoded.country]
        .filter(Boolean)
        .join(", ");
    }
  }

  const response = await fetch(
    `https://worldtimeapi.org/api/timezone/${encodeURIComponent(
      resolvedTimezone
    )}`,
    {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    }
  );

  if (!response.ok) {
    throw new Error(`Time lookup failed with HTTP ${response.status}`);
  }

  const data = await response.json();
  if (!data.datetime) {
    throw new Error("Time lookup did not return datetime");
  }

  const now = new Date(data.datetime);
  const formattedDate = new Intl.DateTimeFormat("zh-TW", {
    timeZone: data.timezone ?? resolvedTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now);

  return {
    location: resolvedLocation,
    timezone: data.timezone ?? resolvedTimezone,
    utc_offset: data.utc_offset ?? "",
    current_time: formattedDate,
    source: "time-mcp-server",
  };
}

const server = new McpServer({
  name: "time-mcp-server",
  version: "1.0.0",
});

server.registerTool(
  "get_current_time",
  {
    description: "Get the current date and time for a timezone or city.",
    inputSchema: {
      timezone: z
        .string()
        .optional()
        .describe("IANA timezone like Asia/Taipei or America/New_York"),
      location: z
        .string()
        .optional()
        .describe("A city or place name if timezone is unknown"),
    },
  },
  async ({ timezone, location }) => {
    try {
      const output = await getCurrentTime({ timezone, location });
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
            text: error instanceof Error ? error.message : "Unknown time tool error",
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
  console.error("Time MCP server error:", error);
  process.exit(1);
});
