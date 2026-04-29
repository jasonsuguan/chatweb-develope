/* eslint-disable @typescript-eslint/no-require-imports */
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const z = require("zod");

function summarizeWeatherCode(code) {
  const mapping = {
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

async function getWeather(location) {
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

  const weatherData = await weatherResponse.json();
  const current = weatherData.current;

  if (!current) {
    throw new Error("Weather data did not include current conditions");
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
    source: "weather-mcp-server",
  };
}

async function getWeatherForecast(location, day) {
  const geocoded = await geocodeLocation(location);
  if (!geocoded) {
    throw new Error(`Could not find location: ${location}`);
  }

  const forecastDays = day === "week" ? 7 : 2;
  const weatherResponse = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${geocoded.latitude}&longitude=${geocoded.longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=${forecastDays}&timezone=auto`,
    {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    }
  );

  if (!weatherResponse.ok) {
    throw new Error(`Weather lookup failed with HTTP ${weatherResponse.status}`);
  }

  const weatherData = await weatherResponse.json();
  const current = weatherData.current;
  const daily = weatherData.daily;
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
      source: "weather-mcp-server",
    };
  }

  const index = day === "tomorrow" ? 1 : 0;

  if (!current || !daily?.time?.[index]) {
    throw new Error("Weather data did not include the requested forecast");
  }

  return {
    location: [geocoded.name, geocoded.admin1, geocoded.country]
      .filter(Boolean)
      .join(", "),
    day,
    date: daily.time[index],
    weather: summarizeWeatherCode(daily.weather_code?.[index] ?? current.weather_code ?? -1),
    temperature_min_c: daily.temperature_2m_min?.[index] ?? null,
    temperature_max_c: daily.temperature_2m_max?.[index] ?? null,
    precipitation_probability_max:
      daily.precipitation_probability_max?.[index] ?? null,
    current_temperature_c: current.temperature_2m ?? null,
    source: "weather-mcp-server",
  };
}

const server = new McpServer({
  name: "weather-mcp-server",
  version: "1.0.0",
});

server.registerTool(
  "get_weather",
  {
    description:
      "Get weather conditions for a city or place. Supports today and tomorrow forecasts.",
    inputSchema: {
      location: z.string().describe("City or place name, for example Taipei or Tokyo"),
      day: z
        .enum(["today", "tomorrow", "week"])
        .optional()
        .describe("Whether to get today's, tomorrow's, or this week's weather"),
    },
  },
  async ({ location, day }) => {
    try {
      const output = day
        ? await getWeatherForecast(location, day)
        : await getWeather(location);
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
            text: error instanceof Error ? error.message : "Unknown weather tool error",
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
  console.error("Weather MCP server error:", error);
  process.exit(1);
});
