/* eslint-disable @typescript-eslint/no-require-imports */
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const z = require("zod");

async function searchWeb(query, maxResults) {
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

  const data = await response.json();
  const results = [];

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
          results.push({
            title: nested.Text,
            url: nested.FirstURL,
            snippet: nested.Text,
          });
        }
      }
      continue;
    }

    if (topic.Text && topic.FirstURL) {
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
    source: "search-mcp-server",
  };
}

function decodeXmlEntities(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripHtmlTags(text) {
  return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeGoogleNewsUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get("url") || url;
  } catch {
    return url;
  }
}

async function searchNews(query, maxResults) {
  const response = await fetch(
    `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`,
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
  const results = [];
  const now = Date.now();
  const maxAgeMs = 1000 * 60 * 60 * 24 * 7;
  let match;

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
        url: normalizeGoogleNewsUrl(decodeXmlEntities(link.trim())),
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
    source: "search-mcp-server",
  };
}

const server = new McpServer({
  name: "search-mcp-server",
  version: "1.0.0",
});

server.registerTool(
  "search_web",
  {
    description: "Search the web for recent or factual information.",
    inputSchema: {
      query: z.string().describe("Search query"),
      max_results: z
        .number()
        .int()
        .min(1)
        .max(5)
        .optional()
        .describe("Number of results to return, between 1 and 5"),
    },
  },
  async ({ query, max_results }) => {
    try {
      const output = await searchWeb(query, max_results ?? 3);
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
            text: error instanceof Error ? error.message : "Unknown search tool error",
          },
        ],
      };
    }
  }
);

server.registerTool(
  "search_news",
  {
    description: "Search recent news articles related to a topic.",
    inputSchema: {
      query: z.string().describe("News search query"),
      max_results: z
        .number()
        .int()
        .min(1)
        .max(5)
        .optional()
        .describe("Number of results to return, between 1 and 5"),
    },
  },
  async ({ query, max_results }) => {
    try {
      const output = await searchNews(query, max_results ?? 3);
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
            text: error instanceof Error ? error.message : "Unknown news tool error",
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
  console.error("Search MCP server error:", error);
  process.exit(1);
});
