# Chat Web Develope

This project is a `Next.js + Gemini API` chat web with:

- short-term memory
- long-term memory
- multimodal image / PDF upload
- asset library with jump-to-message
- tool use for time, weather, web search, Telegram messaging, and Discord messaging
- MCP integration for time, weather, web search, Telegram messaging, and Discord messaging

## Architecture

```mermaid
flowchart LR
    A[User / Browser] --> B[Next.js Chat UI]
    B --> C[/api/chat route]
    C --> D[Gemini API]
    C --> E[Local Tools]
    E --> E1[Fallback Time API]
    E --> E2[Fallback DuckDuckGo Search]
    E --> E3[Fallback Telegram Bot API]
    E --> E4[Fallback Open-Meteo APIs]
    E --> E5[Discord disabled if MCP unavailable]
    C --> F[MCP Clients]
    F --> G[Time MCP Server]
    F --> H[Search MCP Server]
    F --> I[Telegram MCP Server]
    F --> J[Weather MCP Server]
    F --> O[Discord MCP Server]
    G --> K[World Time API]
    H --> L[DuckDuckGo Instant Answer API]
    I --> M[Telegram Bot API]
    J --> N[Open-Meteo APIs]
    O --> P[Discord REST API]
    D --> C
    E --> C
    F --> C
    C --> B
```

### What Uses MCP

- normal text chat: Gemini answers directly, no MCP needed
- time lookup: MCP server, with local fallback
- web search: MCP server, with local fallback
- Telegram send-message: MCP server, with local fallback
- Discord send-message: MCP server
- weather lookup: MCP server, with local fallback

This means your project now demonstrates both:

- built-in local tool use
- external MCP server integration

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Environment Variables

Create `.env.local` with at least:

```env
GEMINI_API_KEY=your_gemini_api_key
```

Optional Telegram integration:

```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID_DEFAULT=your_default_chat_id
TELEGRAM_TARGETS_JSON={"self":"123456789","team":"-1001234567890"}
```

Optional Discord integration:

```env
DISCORD_BOT_TOKEN=your_discord_bot_token
DISCORD_CHANNEL_ID_DEFAULT=your_default_channel_id
DISCORD_CHANNELS_JSON={"team":"123456789012345678","announcements":"234567890123456789"}
DISCORD_USERS_JSON={"alice":"345678901234567890","bob":"456789012345678901"}
```

Notes:

- `TELEGRAM_BOT_TOKEN` comes from Telegram BotFather.
- `TELEGRAM_CHAT_ID_DEFAULT` is the default target chat for send-message commands.
- `TELEGRAM_TARGETS_JSON` lets you map friendly labels to chat IDs.
- `DISCORD_BOT_TOKEN` comes from the Discord Developer Portal bot page.
- `DISCORD_CHANNEL_ID_DEFAULT` is the fallback Discord channel target.
- `DISCORD_CHANNELS_JSON` maps friendly labels to Discord channel IDs.
- `DISCORD_USERS_JSON` maps friendly labels to Discord user IDs for DM sending.

## Tool Use

The assistant can use these tools when needed:

- current time lookup
- weather lookup via MCP
- web search
- Telegram message sending
- Discord message sending
- Discord poll creation
- Discord image sending from a direct URL or automatic image search

Telegram sending is only intended for explicit user requests such as:

- `幫我傳 Telegram 訊息到 self，內容是測試一下`
- `幫我通知 team 今天晚上 8 點開會`

Discord sending is only intended for explicit user requests such as:

- `幫我傳 Discord 訊息到 team，內容是今天晚上 8 點開會`
- `幫我用 Discord 私訊 alice，內容是 demo 已完成`
- `幫我在 Discord 的 team 頻道建立投票，問題是明天要不要開會，選項是要 / 不要`
- `幫我傳一張貓咪圖片到 Discord 的 team 頻道`

## Multimodal

Supported uploads:

- images
- PDF files

Current demo limit:

- each file must be under `4 MB`

## MCP Development

Run standalone MCP servers:

```bash
npm run mcp:weather
npm run mcp:time
npm run mcp:search
npm run mcp:telegram
npm run mcp:discord
```

In the actual app flow, `/api/chat` launches and connects to these MCP servers automatically through stdio.
