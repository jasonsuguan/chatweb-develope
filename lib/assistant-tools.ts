import type { CallableTool, FunctionCall, Part, Tool } from "@google/genai";
import { createPartFromFunctionResponse } from "@google/genai";

type GeocodingResult = {
  name: string;
  country?: string;
  admin1?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
};

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function asRecord(value: unknown) {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown) {
  return typeof value === "number" ? value : Number(value);
}

function normalizeTelegramTarget(value: string) {
  return value
    .trim()
    .replace(/^[\s"'`“”‘’「」『』（）()【】\[\]{}<>]+/u, "")
    .replace(/[\s"'`“”‘’「」『』（）()【】\[\]{}<>.,!?;:]+$/u, "")
    .trim()
    .toLowerCase();
}

function summarizeWeatherCode(code: number) {
  const mapping: Record<number, string> = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    56: "Light freezing drizzle",
    57: "Dense freezing drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    66: "Light freezing rain",
    67: "Heavy freezing rain",
    71: "Slight snow fall",
    73: "Moderate snow fall",
    75: "Heavy snow fall",
    77: "Snow grains",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    85: "Slight snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with slight hail",
    99: "Thunderstorm with heavy hail",
  };

  return mapping[code] ?? `Weather code ${code}`;
}

async function geocodeLocation(location: string): Promise<GeocodingResult | null> {
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

  const data = (await response.json()) as {
    results?: GeocodingResult[];
  };

  return data.results?.[0] ?? null;
}

async function getCurrentTimeTool(args: Record<string, unknown>) {
  const timezone = asString(args.timezone);
  const location = asString(args.location);

  let resolvedTimezone = timezone || "Asia/Taipei";
  let resolvedLocation = location || "Taipei";

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

  const data = (await response.json()) as {
    datetime?: string;
    day_of_week?: number;
    utc_offset?: string;
    timezone?: string;
  };

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
  };
}

async function getWeatherTool(args: Record<string, unknown>) {
  const location = asString(args.location);
  const day = asString(args.day).toLowerCase();
  if (!location) {
    throw new Error("location is required");
  }

  const geocoded = await geocodeLocation(location);
  if (!geocoded) {
    throw new Error(`Could not find location: ${location}`);
  }

  const weatherResponse = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${geocoded.latitude}&longitude=${geocoded.longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m&timezone=auto`,
    {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    }
  );

  if (!weatherResponse.ok) {
    throw new Error(`Weather lookup failed with HTTP ${weatherResponse.status}`);
  }

  const weatherData = (await weatherResponse.json()) as {
    current?: {
      temperature_2m?: number;
      apparent_temperature?: number;
      relative_humidity_2m?: number;
      weather_code?: number;
      wind_speed_10m?: number;
      time?: string;
    };
  };

  const current = weatherData.current;
  if (!current) {
    throw new Error("Weather data did not include current conditions");
  }

  if (day === "today" || day === "tomorrow" || day === "week") {
    const dailyResponse = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${geocoded.latitude}&longitude=${geocoded.longitude}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=${
        day === "week" ? 7 : 2
      }&timezone=auto`,
      {
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      }
    );

    if (!dailyResponse.ok) {
      throw new Error(`Weather forecast lookup failed with HTTP ${dailyResponse.status}`);
    }

    const dailyData = (await dailyResponse.json()) as {
      daily?: {
        time?: string[];
        weather_code?: number[];
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
        precipitation_probability_max?: number[];
      };
    };

    const daily = dailyData.daily;

    if (day === "week") {
      if (!daily?.time?.length) {
        throw new Error("Weather data did not include the requested forecast");
      }

      return {
        location: [geocoded.name, geocoded.admin1, geocoded.country]
          .filter(Boolean)
          .join(", "),
        day,
        forecast: daily.time.map((date, index) => ({
          date,
          weather: summarizeWeatherCode(daily.weather_code?.[index] ?? -1),
          temperature_min_c: daily.temperature_2m_min?.[index] ?? null,
          temperature_max_c: daily.temperature_2m_max?.[index] ?? null,
          precipitation_probability_max:
            daily.precipitation_probability_max?.[index] ?? null,
        })),
      };
    }

    const index = day === "tomorrow" ? 1 : 0;
    if (!daily?.time?.[index]) {
      throw new Error("Weather data did not include the requested forecast");
    }

    return {
      location: [geocoded.name, geocoded.admin1, geocoded.country]
        .filter(Boolean)
        .join(", "),
      day,
      date: daily.time[index],
      weather: summarizeWeatherCode(daily.weather_code?.[index] ?? -1),
      temperature_min_c: daily.temperature_2m_min?.[index] ?? null,
      temperature_max_c: daily.temperature_2m_max?.[index] ?? null,
      precipitation_probability_max:
        daily.precipitation_probability_max?.[index] ?? null,
    };
  }

  return {
    location: [geocoded.name, geocoded.admin1, geocoded.country]
      .filter(Boolean)
      .join(", "),
    observation_time: current.time ?? "",
    temperature_c: current.temperature_2m ?? null,
    feels_like_c: current.apparent_temperature ?? null,
    humidity_percent: current.relative_humidity_2m ?? null,
    wind_speed_kmh: current.wind_speed_10m ?? null,
    weather: summarizeWeatherCode(current.weather_code ?? -1),
  };
}

function decodeXmlEntities(text: string) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripHtmlTags(text: string) {
  return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function searchNewsTool(args: Record<string, unknown>) {
  const query = asString(args.query);
  const maxResultsRaw = asNumber(args.max_results);
  const maxResults = Number.isFinite(maxResultsRaw)
    ? Math.min(Math.max(Math.trunc(maxResultsRaw), 1), 5)
    : 3;

  if (!query) {
    throw new Error("query is required");
  }

  const response = await fetch(
    `https://news.google.com/rss/search?q=${encodeURIComponent(
      query
    )}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`,
    {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    }
  );

  if (!response.ok) {
    throw new Error(`News search failed with HTTP ${response.status}`);
  }

  const xml = await response.text();
  const itemPattern = /<item>([\s\S]*?)<\/item>/g;
  const results: Array<{
    title: string;
    url: string;
    published_at?: string;
    snippet?: string;
  }> = [];
  const now = Date.now();
  const maxAgeMs = 1000 * 60 * 60 * 24 * 7;
  let match: RegExpExecArray | null;

  while ((match = itemPattern.exec(xml)) && results.length < maxResults) {
    const item = match[1];
    const title = item.match(/<title>([\s\S]*?)<\/title>/i)?.[1];
    const link = item.match(/<link>([\s\S]*?)<\/link>/i)?.[1];
    const pubDate = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1];
    const description = item.match(/<description>([\s\S]*?)<\/description>/i)?.[1];

    if (title && link) {
      const publishedAt = pubDate ? Date.parse(pubDate) : Number.NaN;
      if (!Number.isNaN(publishedAt) && now - publishedAt > maxAgeMs) {
        continue;
      }

      results.push({
        title: decodeXmlEntities(title.trim()),
        url: (() => {
          try {
            const parsed = new URL(decodeXmlEntities(link.trim()));
            return parsed.searchParams.get("url") || parsed.toString();
          } catch {
            return decodeXmlEntities(link.trim());
          }
        })(),
        published_at: pubDate ? decodeXmlEntities(pubDate.trim()) : undefined,
        snippet: description
          ? stripHtmlTags(decodeXmlEntities(description.trim()))
          : undefined,
      });
    }
  }

  return {
    query,
    results,
    note: results.length === 0 ? "No recent news results were found." : undefined,
  };
}

async function searchWebTool(args: Record<string, unknown>) {
  const query = asString(args.query);
  const maxResultsRaw = asNumber(args.max_results);
  const maxResults = Number.isFinite(maxResultsRaw)
    ? Math.min(Math.max(Math.trunc(maxResultsRaw), 1), 5)
    : 3;

  if (!query) {
    throw new Error("query is required");
  }

  const response = await fetch(
    `https://api.duckduckgo.com/?q=${encodeURIComponent(
      query
    )}&format=json&no_html=1&skip_disambig=1`,
    {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    }
  );

  if (!response.ok) {
    throw new Error(`Web search failed with HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    AbstractText?: string;
    AbstractURL?: string;
    Heading?: string;
    Results?: Array<{ Text?: string; FirstURL?: string }>;
    RelatedTopics?: Array<
      { Text?: string; FirstURL?: string } | { Topics?: Array<{ Text?: string; FirstURL?: string }> }
    >;
  };

  const results: Array<{ title: string; url: string; snippet?: string }> = [];

  if (data.AbstractText && data.AbstractURL) {
    results.push({
      title: data.Heading || query,
      url: data.AbstractURL,
      snippet: data.AbstractText,
    });
  }

  for (const item of data.Results ?? []) {
    if (item.Text && item.FirstURL) {
      results.push({ title: item.Text, url: item.FirstURL, snippet: item.Text });
    }
  }

  for (const topic of data.RelatedTopics ?? []) {
    if ("Topics" in topic && Array.isArray(topic.Topics)) {
      for (const nested of topic.Topics) {
        if (nested.Text && nested.FirstURL) {
          results.push({ title: nested.Text, url: nested.FirstURL, snippet: nested.Text });
        }
      }
      continue;
    }

    if ("Text" in topic && topic.Text && topic.FirstURL) {
      results.push({ title: topic.Text, url: topic.FirstURL, snippet: topic.Text });
    }
  }

  return {
    query,
    results: results.slice(0, maxResults),
    note:
      results.length === 0
        ? "No strong instant-answer results were found."
        : undefined,
  };
}

function resolveTelegramChatId(target: string) {
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
    const parsed = JSON.parse(raw) as Record<string, string>;

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

async function sendTelegramMessageTool(args: Record<string, unknown>) {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
  const message = asString(args.message);
  const target = asString(args.target);
  const chatId = resolveTelegramChatId(target);

  if (!token) {
    throw new Error("Telegram is not configured. TELEGRAM_BOT_TOKEN is missing.");
  }

  if (!chatId) {
    throw new Error(
      "Telegram target not found. Set TELEGRAM_CHAT_ID_DEFAULT or TELEGRAM_TARGETS_JSON."
    );
  }

  if (!message) {
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

  const data = (await response.json()) as {
    ok?: boolean;
    description?: string;
    result?: {
      message_id?: number;
      date?: number;
      chat?: {
        id?: number | string;
      };
    };
  };

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
  };
}

async function executeFunction(name: string, args: Record<string, unknown>) {
  switch (name) {
    case "get_current_time":
      return await getCurrentTimeTool(args);
    case "get_weather":
      return await getWeatherTool(args);
    case "search_web":
      return await searchWebTool(args);
    case "search_news":
      return await searchNewsTool(args);
    case "send_telegram_message":
      return await sendTelegramMessageTool(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

const assistantToolDeclaration = {
  functionDeclarations: [
    {
      name: "get_current_time",
      description:
        "Get the current date and time for a timezone or city. Use this for questions about current time, today, tomorrow, or deadlines.",
      parametersJsonSchema: {
        type: "object",
        properties: {
          timezone: {
            type: "string",
            description: "IANA timezone like Asia/Taipei or America/New_York",
          },
          location: {
            type: "string",
            description: "A city or place name if timezone is unknown",
          },
        },
      },
    },
    {
      name: "search_web",
      description:
        "Search the web for recent or factual information when the answer should not rely only on memory.",
      parametersJsonSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query",
          },
          max_results: {
            type: "number",
            description: "Number of results to return, between 1 and 5",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "send_telegram_message",
      description:
        "Send a Telegram message. Only use this when the user explicitly asks you to send or notify someone via Telegram.",
      parametersJsonSchema: {
        type: "object",
        properties: {
          target: {
            type: "string",
            description:
              "Optional target label from TELEGRAM_TARGETS_JSON, raw chat id, or @channel username. If omitted, use the default configured chat.",
          },
          message: {
            type: "string",
            description: "The message text to send",
          },
        },
        required: ["message"],
      },
    },
  ],
} satisfies Tool;

const weatherToolDeclaration = {
  functionDeclarations: [
    {
      name: "get_weather",
      description:
        "Get current weather conditions for a city or place. Use for weather questions.",
      parametersJsonSchema: {
        type: "object",
        properties: {
          location: {
            type: "string",
            description: "City or place name, for example Taipei or Tokyo",
          },
          day: {
            type: "string",
            description: "Optional forecast range: today, tomorrow, or week",
          },
        },
        required: ["location"],
      },
    },
    {
      name: "search_news",
      description:
        "Search recent news articles related to a topic or location.",
      parametersJsonSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "News search query",
          },
          max_results: {
            type: "number",
            description: "Number of news results to return, between 1 and 5",
          },
        },
        required: ["query"],
      },
    },
  ],
} satisfies Tool;

export function buildAssistantTools(options?: {
  includeTime?: boolean;
  includeSearch?: boolean;
  includeTelegram?: boolean;
  includeWeather?: boolean;
}): CallableTool[] {
  const includeTime = options?.includeTime ?? true;
  const includeSearch = options?.includeSearch ?? true;
  const includeTelegram = options?.includeTelegram ?? true;
  const includeWeather = options?.includeWeather ?? true;

  const functionDeclarations = [
    ...(includeTime
      ? assistantToolDeclaration.functionDeclarations.filter(
          (tool) => tool.name === "get_current_time"
        )
      : []),
    ...(includeSearch
      ? assistantToolDeclaration.functionDeclarations.filter(
          (tool) => tool.name === "search_web"
        )
      : []),
    ...(includeSearch
      ? assistantToolDeclaration.functionDeclarations.filter(
          (tool) => tool.name === "search_news"
        )
      : []),
    ...(includeTelegram
      ? assistantToolDeclaration.functionDeclarations.filter(
          (tool) => tool.name === "send_telegram_message"
        )
      : []),
    ...(includeWeather ? weatherToolDeclaration.functionDeclarations : []),
  ];

  const toolDeclaration = {
    functionDeclarations,
  } satisfies Tool;

  const tool: CallableTool = {
    async tool() {
      return toolDeclaration;
    },
    async callTool(functionCalls: FunctionCall[]) {
      const parts: Part[] = [];

      for (const call of functionCalls) {
        const args = asRecord(call.args);

        try {
          const output = await executeFunction(call.name ?? "", args);
          parts.push(
            createPartFromFunctionResponse(
              call.id ?? createId(),
              call.name ?? "unknown_tool",
              { output }
            )
          );
        } catch (error) {
          parts.push(
            createPartFromFunctionResponse(
              call.id ?? createId(),
              call.name ?? "unknown_tool",
              {
                error:
                  error instanceof Error ? error.message : "Unknown tool error",
              }
            )
          );
        }
      }

      return parts;
    },
  };

  return [tool];
}
