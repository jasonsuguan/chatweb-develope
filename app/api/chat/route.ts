import { NextRequest } from "next/server";
import type { CallableTool } from "@google/genai";
import { ai } from "@/lib/gemini";
import {
  generateGroqPlannerJson,
  getGroqPreprocessorModel,
  isGroqPreprocessorConfigured,
} from "@/lib/groq-preprocessor";
import {
  buildMemorySummary,
  buildRecentMessages,
  toGeminiContents,
} from "@/lib/chat-memory";
import {
  buildLongTermMemoryContext,
  updateLongTermMemories,
} from "@/lib/long-term-memory";
import { buildAssistantTools } from "@/lib/assistant-tools";
import {
  getDiscordMcpTool,
  getSearchMcpTool,
  getTelegramMcpTool,
  getTimeMcpTool,
  getWeatherMcpTool,
} from "@/lib/mcp-client";
import type {
  ChatRequestBody,
  Message,
  ModelRoutingMode,
  TaskExecutionResult,
  TaskPlan,
  TaskPlanStep,
  TaskType,
} from "@/types/chat";

export const runtime = "nodejs";

type GenerationConfig = ChatRequestBody["generationConfig"];
type TimeSource = "network" | "system";
type OutputLanguage = "zh-TW" | "en";

type GeocodingResult = {
  name: string;
  country?: string;
  admin1?: string;
  latitude: number;
  longitude: number;
};

type ForecastScope = "current" | "today" | "tomorrow" | "week";

async function getCurrentTaipeiTime(): Promise<{
  now: Date;
  source: TimeSource;
}> {
  try {
    const response = await fetch(
      "https://worldtimeapi.org/api/timezone/Asia/Taipei",
      {
        cache: "no-store",
        signal: AbortSignal.timeout(3000),
      }
    );

    if (!response.ok) {
      throw new Error(`Time API HTTP ${response.status}`);
    }

    const data = (await response.json()) as { datetime?: string };
    if (!data.datetime) {
      throw new Error("Time API response missing datetime");
    }

    return {
      now: new Date(data.datetime),
      source: "network",
    };
  } catch {
    return {
      now: new Date(),
      source: "system",
    };
  }
}

async function buildTimeGroundingPrompt() {
  const { now, source } = await getCurrentTaipeiTime();

  const taipeiDate = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
  }).format(now);

  const taipeiTime = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now);

  return [
    "Current time grounding:",
    "- Time zone: Asia/Taipei",
    `- Date: ${taipeiDate}`,
    `- Time: ${taipeiTime}`,
    `- Time source: ${source}`,
    "",
    "When the user asks about today, tomorrow, this week, or deadlines, anchor your answer to this time context.",
  ].join("\n");
}

function detectOutputLanguage(params: {
  messages: ChatRequestBody["messages"];
  systemPrompt: string;
  longTermMemories: string[];
}): OutputLanguage {
  const latestUserText = [...params.messages]
    .reverse()
    .filter((message) => message.role === "user")
    .slice(0, 4)
    .map((message) => message.content)
    .join("\n")
    .toLowerCase();
  const longTermText = params.longTermMemories.join("\n").toLowerCase();
  const combined = `${params.systemPrompt}\n${latestUserText}\n${longTermText}`;

  if (
    /reply in english|respond in english|use english|英文為主|用英文|請用英文|english preferred/.test(
      combined
    )
  ) {
    return "en";
  }

  return "zh-TW";
}

function buildToolUsagePrompt() {
  return [
    "Tool usage rules:",
    "- Use tools when the user asks for time, weather, forecast, web lookup, news lookup, or message sending.",
    "- Prefer weather tools for weather questions and search tools only as a fallback when weather tools cannot satisfy the requested timeframe.",
    "- Prefer news lookup for recent-news requests and use web search only as a fallback.",
    "- Discord tools can send text, create polls, and send images when the user explicitly asks.",
    "- For Telegram or Discord actions, only call the tool when the user explicitly asks to send a message, create a poll, or send an image.",
    "- When the user gives a Telegram or Discord target label such as a nickname or alias, pass that alias to the tool exactly as the target.",
    "- Do not infer or substitute raw chat IDs, channel IDs, or user IDs from prior conversation or long-term memory.",
    "- If a tool returns an error, explain the issue clearly and suggest what is missing.",
    "- When you mention a news article or web page, prefer markdown links like [title](url) instead of pasting a raw long URL.",
  ].join("\n");
}

function buildActionConfirmationPrompt(requireActionConfirmation: boolean) {
  if (!requireActionConfirmation) {
    return [
      "Action confirmation rules:",
      "- Confirmation before sending is disabled.",
      "- If the user explicitly asks to send a Discord or Telegram message, create a poll, or send an image, you may call the relevant tool directly.",
    ].join("\n");
  }

  return [
    "Action confirmation rules:",
    "- Confirmation before sending is enabled.",
    "- Before any external side-effect action, do NOT call the tool immediately.",
    "- External side-effect actions include send_telegram_message, send_discord_message, create_discord_poll, and send_discord_image.",
    "- First summarize the exact action you plan to take, including the platform, target, and content, then ask for explicit confirmation.",
    "- Accept confirmation only when the user clearly confirms, for example: confirm, yes, send it, proceed, 確認, 送出.",
    "- After the user confirms, call the tool and do not ask for confirmation again unless the requested action changed.",
    "- Read-only tools like weather, search, and time lookup do not need confirmation.",
  ].join("\n");
}

function buildMemoryBehaviorPrompt() {
  return [
    "Memory usage rules:",
    "- Treat long-term memory as silent background context, not as content to proactively mention.",
    "- Only use a stored memory when it is clearly relevant to the user's current request.",
    "- Do not greet the user with remembered identities, nicknames, or persona details unless the user explicitly asks for that style in this conversation.",
    "- For routine questions such as weather, time, search, and factual Q&A, ignore unrelated long-term memories.",
    "- If a memory is low-relevance, keep it in mind but leave it out of the response.",
  ].join("\n");
}

function buildPlannerCapabilitiesSummary() {
  return [
    "Available capabilities:",
    "- time_lookup: current time and timezone lookup",
    "- weather_mcp: weather lookup via MCP",
    "- web_search_mcp: general web lookup",
    "- news_search: recent news lookup",
    "- telegram_mcp: Telegram message sending",
    "- discord_mcp: Discord message sending, poll creation, image sending",
    "- multimodal_image: image understanding",
    "- multimodal_pdf: PDF understanding",
    "- multimodal_audio: audio understanding",
    "- memory_short_term: rolling chat summary",
    "- memory_long_term: cross-chat memory",
  ].join("\n");
}

function buildTaskPlanContext(plan: TaskPlan | null) {
  if (!plan) return "";

  const steps = plan.steps
    .map(
      (step, index) =>
        `${index + 1}. ${step.title} | objective: ${step.objective} | model: ${
          step.recommendedModel
        } | capabilities: ${step.requiredCapabilities.join(", ")}`
    )
    .join("\n");

  return [
    "Task planner context:",
    `- Summary: ${plan.summary}`,
    `- Task type: ${plan.taskType}`,
    `- Complexity: ${plan.complexity}`,
    `- Planner provider: ${plan.plannerProvider ?? "unknown"}`,
    `- Planner model used: ${plan.plannerModelUsed ?? "unknown"}`,
    `- Planner recommended model: ${plan.recommendedModel}`,
    `- Reasoning: ${plan.reasoning}`,
    `- Required capabilities: ${plan.requiredCapabilities.join(", ") || "none"}`,
    "- Planned steps:",
    steps || "1. Respond directly using the main model",
    "",
    "Use this plan as execution guidance, but do not expose it unless the user asks about the plan.",
  ].join("\n");
}

function buildExecutionContext(results: TaskExecutionResult[]) {
  if (results.length === 0) return "";

  return [
    "Subtask execution results:",
    ...results.map(
      (result) =>
        `- ${result.title} | mode: ${result.mode} | status: ${result.status} | summary: ${result.summary}`
    ),
    "",
    "Use completed subtask results as reliable working context.",
  ].join("\n");
}

function buildAssistantMessage(messages: Message[], fullText: string): Message {
  return {
    role: "assistant",
    content: fullText,
    id: Date.now() + messages.length,
  };
}

function getFallbackModels(model: string) {
  const fallbackMap: Record<string, string[]> = {
    "gemini-2.5-flash": [
      "gemini-2.5-flash-lite",
      "gemini-2.5-pro",
      "gemini-3.1-flash-lite-preview",
    ],
    "gemini-2.5-flash-lite": [
      "gemini-2.5-flash",
      "gemini-2.5-pro",
      "gemini-3.1-flash-lite-preview",
    ],
    "gemini-2.5-pro": [
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
      "gemini-3.1-pro-preview",
    ],
    "gemini-3-flash-preview": [
      "gemini-3.1-flash-lite-preview",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
    ],
    "gemini-3.1-flash-lite-preview": [
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
      "gemini-2.5-pro",
    ],
    "gemini-3.1-pro-preview": [
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-3.1-flash-lite-preview",
    ],
  };

  const defaults = [
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.5-pro",
    "gemini-3.1-flash-lite-preview",
  ];

  return [...new Set([model, ...(fallbackMap[model] ?? defaults), ...defaults])];
}

function detectTaskType(
  messages: ChatRequestBody["messages"],
  systemPrompt: string
): TaskType {
  const lastUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user");

  const latestText = lastUserMessage?.content.toLowerCase() ?? "";
  const latestAttachments = lastUserMessage?.attachments ?? [];
  const combinedPrompt = `${systemPrompt}\n${latestText}`.toLowerCase();

  const codingKeywords = [
    "code",
    "debug",
    "bug",
    "typescript",
    "javascript",
    "python",
    "react",
    "next.js",
    "nextjs",
    "api",
    "sql",
    "程式",
    "寫程式",
    "除錯",
    "function",
    "演算法",
  ];
  const toolKeywords = [
    "weather",
    "forecast",
    "天氣",
    "氣象",
    "time",
    "時間",
    "search",
    "搜尋",
    "查詢",
    "news",
    "新聞",
    "telegram",
    "discord",
    "message",
    "dm",
    "傳訊息",
    "發訊息",
    "投票",
  ];
  const reasoningKeywords = [
    "compare",
    "比較",
    "plan",
    "規劃",
    "design",
    "設計",
    "architecture",
    "tradeoff",
    "取捨",
    "reason",
    "推理",
    "分析",
    "optimize",
    "optimization",
    "優化",
  ];

  if (
    latestAttachments.some(
      (attachment) =>
        attachment.kind === "image" ||
        attachment.kind === "pdf" ||
        attachment.kind === "audio"
    )
  ) {
    return "multimodal";
  }

  if (codingKeywords.some((keyword) => combinedPrompt.includes(keyword))) {
    return "coding";
  }

  if (toolKeywords.some((keyword) => latestText.includes(keyword))) {
    return "tool_call";
  }

  if (reasoningKeywords.some((keyword) => combinedPrompt.includes(keyword))) {
    return "deep_reasoning";
  }

  return "general";
}

function selectModelForTaskType(taskType: TaskType, preferredModel: string) {
  const stableChoiceByTask: Record<TaskType, { model: string; reason: string }> =
    {
      multimodal: {
        model: "gemini-2.5-flash",
        reason:
          "multimodal input detected, so a strong general-purpose model was preferred",
      },
      coding: {
        model: "gemini-2.5-pro",
        reason:
          "coding or implementation task detected, so a stronger reasoning model was preferred",
      },
      tool_call: {
        model: "gemini-2.5-flash",
        reason:
          "tool-based task detected, so a balanced model was preferred for speed and tool orchestration",
      },
      deep_reasoning: {
        model: "gemini-2.5-pro",
        reason:
          "deeper reasoning task detected, so a higher-capability model was preferred",
      },
      general: {
        model: "gemini-2.5-flash-lite",
        reason:
          "general chat task detected, so a faster lightweight model was preferred",
      },
    };

  if (
    preferredModel.startsWith("gemini-3.1") ||
    preferredModel.startsWith("gemini-3-")
  ) {
    return {
      model: preferredModel,
      reason:
        "auto routing kept your selected preview-family model as the starting point",
    };
  }

  return stableChoiceByTask[taskType];
}

function extractErrorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;

  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

function summarizeFallbackReason(error: unknown) {
  const message = extractErrorText(error).toLowerCase();

  if (
    message.includes('"code":503') ||
    message.includes('"status":"unavailable"') ||
    message.includes("high demand") ||
    message.includes("service unavailable")
  ) {
    return "The original model was temporarily unavailable due to high demand.";
  }

  if (
    message.includes('"code":429') ||
    message.includes("quota exceeded") ||
    message.includes('"status":"resource_exhausted"') ||
    message.includes("resource_exhausted")
  ) {
    return "The original model hit a rate limit or quota limit.";
  }

  return "The original model could not be used, so a fallback model was selected.";
}

function isRetryableModelError(error: unknown) {
  const message = extractErrorText(error).toLowerCase();

  return (
    message.includes('"code":429') ||
    message.includes('"code":503') ||
    message.includes('"status":"too many requests"') ||
    message.includes('"status":"resource_exhausted"') ||
    message.includes('"status":"service unavailable"') ||
    message.includes('"status":"unavailable"') ||
    message.includes("quota exceeded") ||
    message.includes("resource_exhausted") ||
    message.includes("high demand") ||
    message.includes("service unavailable") ||
    message.includes("model is overloaded") ||
    message.includes("please retry in") ||
    message.includes("retrydelay") ||
    message.includes("try again later")
  );
}

function stripCodeFences(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1].trim() : text.trim();
}

function normalizeTaskType(value: unknown): TaskType {
  if (
    value === "multimodal" ||
    value === "coding" ||
    value === "tool_call" ||
    value === "deep_reasoning" ||
    value === "general"
  ) {
    return value;
  }

  return "general";
}

function normalizeRecommendedModel(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : "gemini-2.5-flash";
}

function isSupportedModelName(value: string) {
  return [
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.5-pro",
    "gemini-3-flash-preview",
    "gemini-3.1-flash-lite-preview",
    "gemini-3.1-pro-preview",
  ].includes(value);
}

function alignTaskPlanModels(taskPlan: TaskPlan, preferredModel: string): TaskPlan {
  if (!preferredModel || !isSupportedModelName(preferredModel)) {
    return taskPlan;
  }

  return {
    ...taskPlan,
    recommendedModel: preferredModel,
    reasoning: `${taskPlan.reasoning} Preferred planner model was pinned to ${preferredModel}.`,
    steps: taskPlan.steps.map((step) => ({
      ...step,
      recommendedModel: preferredModel,
    })),
  };
}

function isGroqPlannerSelection(value: string) {
  return value === "groq-auto";
}

function resolveGeminiPlannerModel(plannerSelection: string, preferredExecutionModel: string) {
  if (plannerSelection && !isGroqPlannerSelection(plannerSelection)) {
    return plannerSelection;
  }

  if (preferredExecutionModel && isSupportedModelName(preferredExecutionModel)) {
    return preferredExecutionModel;
  }

  return "gemini-2.5-flash-lite";
}

function extractFocusedTopic(latestUserMessage: string) {
  const normalized = latestUserMessage
    .replace(/\s+/g, " ")
    .replace(/請幫我|幫我|請/gu, "")
    .replace(/並且.*$/u, "")
    .replace(/然後.*$/u, "")
    .replace(/最後.*$/u, "")
    .replace(/把資訊傳到.*$/u, "")
    .replace(/傳到.*$/u, "")
    .trim();

  const extracted =
    normalized.match(/有關(.+?)(?:的)?新聞/u)?.[1] ??
    normalized.match(/關於(.+?)(?:的)?新聞/u)?.[1] ??
    normalized.match(/(.+?)(?:現況|近況|最新發展)/u)?.[1];

  return (extracted ?? normalized).replace(/新聞$/u, "").trim();
}

function normalizeTaskPlan(raw: unknown, fallbackTaskType: TaskType): TaskPlan {
  const value =
    typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const stepValues = Array.isArray(value.steps) ? value.steps : [];
  const requiredCapabilities = Array.isArray(value.requiredCapabilities)
    ? value.requiredCapabilities.filter(
        (item): item is string => typeof item === "string" && item.trim().length > 0
      )
    : [];
  const taskType = normalizeTaskType(value.taskType) || fallbackTaskType;

  return {
    summary:
      typeof value.summary === "string" && value.summary.trim()
        ? value.summary.trim()
        : "Direct response with minimal decomposition",
    taskType,
    complexity:
      value.complexity === "low" ||
      value.complexity === "medium" ||
      value.complexity === "high"
        ? value.complexity
        : "medium",
    recommendedModel: normalizeRecommendedModel(value.recommendedModel),
    reasoning:
      typeof value.reasoning === "string" && value.reasoning.trim()
        ? value.reasoning.trim()
        : "Planner analysis was not fully specified.",
    requiredCapabilities,
    plannerProvider:
      value.plannerProvider === "groq" ||
      value.plannerProvider === "gemini" ||
      value.plannerProvider === "heuristic"
        ? value.plannerProvider
        : undefined,
    plannerModelUsed:
      typeof value.plannerModelUsed === "string" && value.plannerModelUsed.trim()
        ? value.plannerModelUsed.trim()
        : undefined,
    steps:
      stepValues.length > 0
        ? stepValues.map((step, index) => {
            const stepValue =
              typeof step === "object" && step !== null
                ? (step as Record<string, unknown>)
                : {};
            const capabilities = Array.isArray(stepValue.requiredCapabilities)
              ? stepValue.requiredCapabilities.filter(
                  (item): item is string =>
                    typeof item === "string" && item.trim().length > 0
                )
              : [];

            return {
              id:
                typeof stepValue.id === "string" && stepValue.id.trim()
                  ? stepValue.id.trim()
                  : `step-${index + 1}`,
              title:
                typeof stepValue.title === "string" && stepValue.title.trim()
                  ? stepValue.title.trim()
                  : `Step ${index + 1}`,
              objective:
                typeof stepValue.objective === "string" && stepValue.objective.trim()
                  ? stepValue.objective.trim()
                  : "Handle this part of the task",
              recommendedModel: normalizeRecommendedModel(
                stepValue.recommendedModel
              ),
              requiredCapabilities: capabilities,
            };
          })
        : [
            {
              id: "step-1",
              title: "Respond directly",
              objective: "Answer the user request with the main model",
              recommendedModel: normalizeRecommendedModel(value.recommendedModel),
              requiredCapabilities,
            },
          ],
  };
}

function localizeTaskPlan(taskPlan: TaskPlan, language: OutputLanguage): TaskPlan {
  if (language === "en") {
    return taskPlan;
  }

  const translatedTaskType: Record<TaskType, string> = {
    multimodal: "多模態",
    coding: "程式任務",
    tool_call: "工具調用",
    deep_reasoning: "深度推理",
    general: "一般任務",
  };

  void translatedTaskType;

  return {
    ...taskPlan,
    summary: taskPlan.summary,
    reasoning: taskPlan.reasoning,
    taskType: taskPlan.taskType,
    steps: taskPlan.steps.map((step) => ({
      ...step,
      title: step.title,
      objective: step.objective,
      requiredCapabilities: step.requiredCapabilities,
    })),
    requiredCapabilities: taskPlan.requiredCapabilities,
  };
}

async function analyzeTaskPlanWithFallback(params: {
  messages: ChatRequestBody["messages"];
  systemPrompt: string;
  plannerSelection: string;
  preferredExecutionModel: string;
  outputLanguage: OutputLanguage;
}) {
  const fallbackTaskType = detectTaskType(params.messages, params.systemPrompt);
  const lastUserMessage = [...params.messages]
    .reverse()
    .find((message) => message.role === "user");

  if (!lastUserMessage) {
    return null;
  }

  const attachmentSummary =
    lastUserMessage.attachments
      ?.map((attachment) => `${attachment.kind}:${attachment.name}`)
      .join(", ") ?? "none";

  const plannerPrompt = [
    "You are a lightweight task planner for a multi-agent assistant.",
    "Analyze the user request, break it into a few actionable subtasks, and recommend the tools or model family each step may need.",
    "Return JSON only. Do not use markdown fences.",
    `Strong preference: recommend ${params.preferredExecutionModel} as the Gemini execution model unless there is a very strong reason not to.`,
    params.outputLanguage === "en"
      ? "Write all user-facing plan text in English."
      : "請將 task summary、reasoning、step title、objective 都用繁體中文撰寫。只有當使用者明確要求英文時才改成英文。",
    params.outputLanguage === "en"
      ? "Keep all plan wording concise and practical."
      : "請以繁體中文輸出所有計畫欄位，包含 summary、reasoning、step title 與 objective。",
    "",
    buildPlannerCapabilitiesSummary(),
    "",
    "Valid taskType values: multimodal, coding, tool_call, deep_reasoning, general",
    "Valid complexity values: low, medium, high",
    "Keep the plan compact and practical. Use 1 to 4 steps.",
    "The planner only sees the latest text and attachment metadata; the execution model will receive actual files later if available.",
    "",
    `System prompt context: ${params.systemPrompt || "none"}`,
    `Latest user message: ${lastUserMessage.content || "(empty text)"}`,
    `Latest attachments: ${attachmentSummary}`,
    "",
    "Return this JSON shape exactly:",
    '{"summary":"...","taskType":"general","complexity":"medium","recommendedModel":"gemini-2.5-flash","reasoning":"...","requiredCapabilities":["..."],"steps":[{"id":"step-1","title":"...","objective":"...","recommendedModel":"gemini-2.5-flash","requiredCapabilities":["..."]}]}',
  ].join("\n");

  if (
    isGroqPlannerSelection(params.plannerSelection) &&
    isGroqPreprocessorConfigured()
  ) {
    try {
      const groqResult = await generateGroqPlannerJson<unknown>({
        prompt: plannerPrompt,
        systemPrompt:
          "You are a lightweight task planner for a multi-agent assistant. Return valid JSON only and never use markdown fences.",
        preferredModel: getGroqPreprocessorModel(),
        temperature: 0.2,
        topP: 0.8,
        maxCompletionTokens: 1024,
      });

      const groqTaskPlan = localizeTaskPlan(
        alignTaskPlanModels(
          normalizeTaskPlan(groqResult.value, fallbackTaskType),
          params.preferredExecutionModel
        ),
        params.outputLanguage
      );

      const groqReasoningNote =
        params.outputLanguage === "en"
          ? `Groq preprocessor (${groqResult.model}) decomposed the task; Gemini will execute the plan and handle multimodal files or MCP tools.`
          : `Groq 前處理模型（${groqResult.model}）已完成任務拆解，後續由 Gemini 負責執行步驟，並處理圖片、PDF 與 MCP 工具調用。`;

      return {
        ...groqTaskPlan,
        plannerProvider: "groq" as const,
        plannerModelUsed: groqResult.model,
        reasoning: groqTaskPlan.reasoning
          ? `${groqTaskPlan.reasoning} ${groqReasoningNote}`
          : groqReasoningNote,
      };
    } catch (error) {
      console.error(
        "Groq task preprocessor unavailable, falling back to Gemini planner",
        error
      );
    }
  }

  const geminiPlannerModel = resolveGeminiPlannerModel(
    params.plannerSelection,
    params.preferredExecutionModel
  );
  const candidateModels = getFallbackModels(geminiPlannerModel);
  let lastError: unknown = null;

  for (const candidateModel of candidateModels) {
    try {
      const response = await ai.models.generateContent({
        model: candidateModel,
        contents: plannerPrompt,
        config: {
          temperature: 0.2,
          topP: 0.8,
          topK: 20,
          maxOutputTokens: 1024,
        },
      });

      const parsed = JSON.parse(stripCodeFences(response.text ?? ""));
      const geminiTaskPlan = localizeTaskPlan(
        alignTaskPlanModels(
          normalizeTaskPlan(parsed, fallbackTaskType),
          params.preferredExecutionModel
        ),
        params.outputLanguage
      );

      return {
        ...geminiTaskPlan,
        plannerProvider: "gemini" as const,
        plannerModelUsed: candidateModel,
      };
    } catch (error) {
      lastError = error;
      if (!isRetryableModelError(error)) {
        break;
      }
    }
  }

  if (lastError) {
    console.error("Task planner unavailable, falling back to heuristic routing", lastError);
  }

  return localizeTaskPlan(
    alignTaskPlanModels(
    {
      summary: "Planner fallback: respond directly using heuristic task routing.",
      taskType: fallbackTaskType,
      complexity:
        fallbackTaskType === "deep_reasoning" || fallbackTaskType === "coding"
          ? "high"
          : "medium",
      recommendedModel:
        fallbackTaskType === "general"
          ? "gemini-2.5-flash-lite"
          : fallbackTaskType === "coding" || fallbackTaskType === "deep_reasoning"
          ? "gemini-2.5-pro"
          : "gemini-2.5-flash",
      reasoning: "The lightweight planner was unavailable, so heuristic routing was used.",
      requiredCapabilities: [],
      plannerProvider: "heuristic",
      plannerModelUsed: "heuristic",
      steps: [
        {
          id: "step-1",
          title: "Main response",
          objective: "Handle the request with the primary model and available tools.",
          recommendedModel:
            fallbackTaskType === "general"
              ? "gemini-2.5-flash-lite"
              : fallbackTaskType === "coding" || fallbackTaskType === "deep_reasoning"
              ? "gemini-2.5-pro"
              : "gemini-2.5-flash",
          requiredCapabilities: [],
        },
      ],
    } satisfies TaskPlan,
    params.preferredExecutionModel
  ),
    params.outputLanguage
  );
}

async function buildModelTools() {
  const localFallback = {
    includeTime: true,
    includeSearch: true,
    includeTelegram: true,
    includeWeather: true,
  };
  const tools: CallableTool[] = [];

  try {
    tools.push(await getTimeMcpTool());
    localFallback.includeTime = false;
  } catch (error) {
    console.error("Time MCP unavailable, falling back to local time tool", error);
  }

  try {
    tools.push(await getSearchMcpTool());
    localFallback.includeSearch = false;
  } catch (error) {
    console.error("Search MCP unavailable, falling back to local search tool", error);
  }

  try {
    tools.push(await getTelegramMcpTool());
    localFallback.includeTelegram = false;
  } catch (error) {
    console.error(
      "Telegram MCP unavailable, falling back to local Telegram tool",
      error
    );
  }

  try {
    tools.push(await getDiscordMcpTool());
  } catch (error) {
    console.error("Discord MCP unavailable, Discord sending will be disabled", error);
  }

  try {
    tools.push(await getWeatherMcpTool());
    localFallback.includeWeather = false;
  } catch (error) {
    console.error(
      "Weather MCP unavailable, falling back to local weather tool",
      error
    );
  }

  return [...buildAssistantTools(localFallback), ...tools];
}

function isParallelizableStep(step: TaskPlanStep) {
  const capabilities = new Set(step.requiredCapabilities);
  const combined = `${step.title} ${step.objective}`.toLowerCase();

  if (capabilities.has("telegram_mcp") || capabilities.has("discord_mcp")) {
    return false;
  }

  if (
    /send|notify|message|dm|poll|discord|telegram|傳送|發送|通知|投票/.test(
      combined
    )
  ) {
    return false;
  }

  return true;
}

function inferExecutionStatusFromSummary(summary: string) {
  const normalized = summary.toLowerCase();

  if (
    /could not find|not found|unavailable|failed|no recent|no relevant|查不到|找不到|無法|失敗/.test(
      normalized
    )
  ) {
    return "failed" as const;
  }

  return "completed" as const;
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

  const data = (await response.json()) as { results?: GeocodingResult[] };
  return data.results?.[0] ?? null;
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
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    71: "Slight snow fall",
    73: "Moderate snow fall",
    75: "Heavy snow fall",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    95: "Thunderstorm",
  };

  return mapping[code] ?? `Weather code ${code}`;
}

async function fetchWeatherSummary(
  location: string,
  scope: ForecastScope,
  language: OutputLanguage
) {
  const geocoded = await geocodeLocation(location);
  if (!geocoded) {
    throw new Error(`Could not find location: ${location}`);
  }

  const forecastDays = scope === "week" ? 7 : 2;
  const response = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${geocoded.latitude}&longitude=${geocoded.longitude}&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=${forecastDays}&timezone=auto`,
    {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    }
  );

  if (!response.ok) {
    throw new Error(`Weather lookup failed with HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    current?: { temperature_2m?: number; weather_code?: number };
    daily?: {
      time?: string[];
      weather_code?: number[];
      temperature_2m_max?: number[];
      temperature_2m_min?: number[];
      precipitation_probability_max?: number[];
    };
  };

  const displayLocation = [geocoded.name, geocoded.admin1, geocoded.country]
    .filter(Boolean)
    .join(", ");

  if (scope === "current") {
    return language === "en"
      ? [
          `${displayLocation} current weather`,
          `Condition: ${summarizeWeatherCode(data.current?.weather_code ?? -1)}`,
          `Temperature: ${data.current?.temperature_2m ?? "-"}°C`,
        ].join("; ")
      : [
          `${displayLocation}目前天氣`,
          `天氣狀況：${summarizeWeatherCode(data.current?.weather_code ?? -1)}`,
          `氣溫：${data.current?.temperature_2m ?? "-"}°C`,
        ].join("；");
  }

  if (scope === "week") {
    const rows =
      data.daily?.time?.map((date, index) => {
        const min = data.daily?.temperature_2m_min?.[index] ?? "-";
        const max = data.daily?.temperature_2m_max?.[index] ?? "-";
        const rain = data.daily?.precipitation_probability_max?.[index] ?? "-";
        const weather = summarizeWeatherCode(data.daily?.weather_code?.[index] ?? -1);
        return `${date}: ${weather}, ${min}°C to ${max}°C, rain ${rain}%`;
      }) ?? [];

    if (rows.length === 0) {
      throw new Error("Weekly forecast data was unavailable.");
    }

    return language === "en"
      ? `${displayLocation} 7-day forecast:\n- ${rows.join("\n- ")}`
      : `${displayLocation} 一週天氣預報：\n- ${rows.join("\n- ")}`;
  }

  const index = scope === "tomorrow" ? 1 : 0;
  const date = data.daily?.time?.[index];

  if (!date) {
    throw new Error("Weather forecast data was unavailable.");
  }

  return language === "en"
    ? [
        `${displayLocation} ${scope === "tomorrow" ? "tomorrow" : "today"} weather`,
        `Condition: ${summarizeWeatherCode(data.daily?.weather_code?.[index] ?? data.current?.weather_code ?? -1)}`,
        `Temperature: ${data.daily?.temperature_2m_min?.[index] ?? "-"}°C to ${
          data.daily?.temperature_2m_max?.[index] ?? "-"
        }°C`,
        `Rain probability: ${data.daily?.precipitation_probability_max?.[index] ?? "-"}%`,
      ].join("; ")
    : [
        `${displayLocation}${scope === "tomorrow" ? "明天" : "今天"}天氣`,
        `天氣狀況：${summarizeWeatherCode(data.daily?.weather_code?.[index] ?? data.current?.weather_code ?? -1)}`,
        `溫度：${data.daily?.temperature_2m_min?.[index] ?? "-"}°C 到 ${
          data.daily?.temperature_2m_max?.[index] ?? "-"
        }°C`,
        `降雨機率：${data.daily?.precipitation_probability_max?.[index] ?? "-"}%`,
      ].join("；");
}

function decodeXmlEntities(text: string) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function inferNewsQuery(step: TaskPlanStep, latestUserMessage: string) {
  const source = `${step.title} ${step.objective} ${latestUserMessage}`;
  const focusedTopic = extractFocusedTopic(latestUserMessage);
  const location =
    source.match(/([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)/g)?.find(Boolean) ??
    source.match(/(台北|臺北|新竹|台中|臺中|台南|臺南|高雄|東京|大阪|香港|美國|伊朗|以色列|中東)/)?.[1] ??
    "";
  const weatherContext = /weather|forecast|天氣|氣象/.test(source) ? "weather" : "";
  const conflictContext =
    /戰爭|衝突|局勢|現況|近況|美伊|以伊|中東/.test(source) ? "最新發展" : "";

  return [focusedTopic || location, weatherContext, conflictContext]
    .filter(Boolean)
    .join(" ")
    .trim() || latestUserMessage.trim();
}

function normalizeGoogleNewsUrl(url: string) {
  try {
    const parsed = new URL(url);
    const direct = parsed.searchParams.get("url");
    return direct || url;
  } catch {
    return url;
  }
}

function stripHtmlTags(text: string) {
  return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

type SearchDigestResult = {
  title: string;
  url: string;
  snippet?: string;
  publishedAt?: string;
};

function buildSearchSourceList(results: SearchDigestResult[]) {
  return results
    .slice(0, 4)
    .map((result) => `- [${result.title}](${result.url})`)
    .join("\n");
}

function buildSearchDigestFallback(
  query: string,
  results: SearchDigestResult[],
  kind: "news" | "web",
  language: OutputLanguage
) {
  const digestLines = results
    .slice(0, 3)
    .map((result, index) => {
      const snippet = result.snippet ? `：${result.snippet}` : "";
      return `${index + 1}. ${result.title}${snippet}`;
    })
    .join("\n");

  const sources = buildSearchSourceList(results);
  return language === "en"
    ? `${kind === "news" ? "News digest" : "Search digest"} for "${query}":\n${digestLines}\n\nSources:\n${sources}`
    : `${kind === "news" ? "新聞整理" : "搜尋整理"}（${query}）：\n${digestLines}\n\n參考來源：\n${sources}`;
}

async function summarizeSearchResultsWithFallback(
  query: string,
  results: SearchDigestResult[],
  kind: "news" | "web",
  language: OutputLanguage
) {
  const sourceContext = results
    .slice(0, 4)
    .map((result, index) => {
      const publishedAt = result.publishedAt ? ` | published_at: ${result.publishedAt}` : "";
      const snippet = result.snippet ? ` | snippet: ${result.snippet}` : "";
      return `${index + 1}. title: ${result.title} | url: ${result.url}${publishedAt}${snippet}`;
    })
    .join("\n");

  const prompt =
    language === "en"
      ? [
          `You are summarizing ${kind === "news" ? "news" : "web"} search results for the query: ${query}`,
          "Write a concise factual digest in English using only the provided results.",
          "Do not invent details from the linked pages.",
          "Prefer overlap across multiple titles or snippets.",
          "Keep it short: 2 to 4 sentences or short bullets.",
          "End with a Sources section using markdown links.",
          "",
          sourceContext,
        ].join("\n")
      : [
          `你正在整理${kind === "news" ? "新聞" : "網頁搜尋"}結果，查詢主題是：${query}`,
          "請只根據提供的搜尋結果，用繁體中文整理成精簡重點。",
          "不要臆測連結內文，也不要編造未提供的細節。",
          "優先整理多筆標題或 snippet 共同出現的資訊。",
          "長度控制在 2 到 4 句或短條列。",
          "最後加上一個「參考來源」區塊，使用 markdown 連結。",
          "",
          sourceContext,
        ].join("\n");

  for (const candidateModel of getFallbackModels("gemini-2.5-flash-lite")) {
    try {
      const response = await ai.models.generateContent({
        model: candidateModel,
        contents: prompt,
        config: {
          temperature: 0.2,
          maxOutputTokens: 512,
        },
      });

      const text = response.text?.trim();
      if (text) {
        return text;
      }
    } catch {
      continue;
    }
  }

  return buildSearchDigestFallback(query, results, kind, language);
}

async function fetchNewsSummary(query: string, language: OutputLanguage) {
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
  const now = Date.now();
  const maxAgeMs = 1000 * 60 * 60 * 24 * 7;
  const results: SearchDigestResult[] = [];
  let match: RegExpExecArray | null;

  while ((match = itemPattern.exec(xml)) && results.length < 4) {
    const item = match[1];
    const title = item.match(/<title>([\s\S]*?)<\/title>/i)?.[1];
    const link = item.match(/<link>([\s\S]*?)<\/link>/i)?.[1];
    const pubDate = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1];
    const description = item.match(/<description>([\s\S]*?)<\/description>/i)?.[1];

    if (!title || !link) continue;

    if (pubDate) {
      const publishedAt = Date.parse(pubDate);
      if (!Number.isNaN(publishedAt) && now - publishedAt > maxAgeMs) {
        continue;
      }
    }

    const cleanTitle = decodeXmlEntities(title.trim());
    const cleanUrl = normalizeGoogleNewsUrl(decodeXmlEntities(link.trim()));
    results.push({
      title: cleanTitle,
      url: cleanUrl,
      publishedAt: pubDate ? decodeXmlEntities(pubDate.trim()) : undefined,
      snippet: description
        ? stripHtmlTags(decodeXmlEntities(description.trim()))
        : undefined,
    });
    if (results.length > 0) {
      continue;
    }
    return language === "en"
      ? `Related news: [${cleanTitle}](${cleanUrl})`
      : `相關新聞：[${cleanTitle}](${cleanUrl})`;
  }

  if (results.length > 0) {
    return summarizeSearchResultsWithFallback(query, results, "news", language);
  }

  throw new Error("No recent news article was found.");
}

async function fetchWebSearchSummary(query: string, language: OutputLanguage) {
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

  const candidates: SearchDigestResult[] = [];

  if (data.AbstractText && data.AbstractURL) {
    candidates.push({
      title: data.Heading || query,
      url: data.AbstractURL,
      snippet: data.AbstractText,
    });
  }

  for (const item of data.Results ?? []) {
    if (item.Text && item.FirstURL) {
      candidates.push({ title: item.Text, url: item.FirstURL, snippet: item.Text });
    }
  }

  for (const topic of data.RelatedTopics ?? []) {
    if ("Topics" in topic && Array.isArray(topic.Topics)) {
      for (const nested of topic.Topics) {
        if (nested.Text && nested.FirstURL) {
          candidates.push({
            title: nested.Text,
            url: nested.FirstURL,
            snippet: nested.Text,
          });
        }
      }
      continue;
    }

    if ("Text" in topic && topic.Text && topic.FirstURL) {
      candidates.push({ title: topic.Text, url: topic.FirstURL, snippet: topic.Text });
    }
  }

  if (candidates.length === 0) {
    throw new Error("No relevant web result was found.");
  }

  return summarizeSearchResultsWithFallback(
    query,
    candidates.slice(0, 4),
    "web",
    language
  );

  const best = candidates[0];
  return language === "en"
    ? `Fallback reference: [${best.title}](${best.url})`
    : `備援參考資料：[${best.title}](${best.url})`;
}

function inferWeatherRequestInfo(
  step: TaskPlanStep,
  latestUserMessage: string
): { location: string; scope: ForecastScope } | null {
  const source = `${step.title} ${step.objective} ${latestUserMessage}`;
  const scope: ForecastScope = /week|7-day|weekly|一周|一週|本週/.test(source)
    ? "week"
    : /tomorrow|明天/.test(source)
    ? "tomorrow"
    : /today|今天/.test(source)
    ? "today"
    : "current";
  const locationMatch =
    source.match(/([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\s*(?:weather|forecast)/i) ??
    source.match(
      /(台北|臺北|新竹|台中|臺中|台南|臺南|高雄|東京|大阪|香港)\s*(?:的)?(?:天氣|氣象)?/
    );

  if (!locationMatch?.[1]) {
    return null;
  }

  return {
    location: locationMatch[1].trim(),
    scope,
  };
}

async function fetchWeatherWithSearchFallback(
  location: string,
  scope: ForecastScope,
  language: OutputLanguage
) {
  try {
    return await fetchWeatherSummary(location, scope, language);
  } catch {
    const scopeLabel =
      scope === "week"
        ? "7-day weather forecast"
        : scope === "tomorrow"
        ? "tomorrow weather forecast"
        : scope === "today"
        ? "today weather forecast"
        : "current weather";

    const searchPrompt = `${location} ${scopeLabel}`;
    try {
      const webFallback = await fetchWebSearchSummary(searchPrompt, language);
      return language === "en"
        ? `Weather tool fallback used web search for ${searchPrompt}. ${webFallback}`
        : `天氣工具改以網頁搜尋補查 ${searchPrompt}。${webFallback}`;
    } catch {
      return language === "en"
        ? `Weather lookup failed for ${searchPrompt}, and web fallback did not return a strong result.`
        : `${searchPrompt} 的天氣查詢失敗，且網頁備援搜尋也沒有找到足夠可靠的結果。`;
    }
  }
}

async function executeSubtaskStepWithFallback(params: {
  step: TaskPlanStep;
  messages: ChatRequestBody["messages"];
  systemPrompt: string;
  tools: CallableTool[];
  outputLanguage: OutputLanguage;
}) {
  const lastUserMessage = [...params.messages]
    .reverse()
    .find((message) => message.role === "user");
  const latestUserText = lastUserMessage?.content ?? "";
  const attachmentSummary =
    lastUserMessage?.attachments
      ?.map((attachment) => `${attachment.kind}:${attachment.name}`)
      .join(", ") ?? "none";
  const combinedStepText = `${params.step.title} ${params.step.objective}`.toLowerCase();

  if (/weather|forecast|天氣|氣象/.test(combinedStepText)) {
    const weatherInfo = inferWeatherRequestInfo(params.step, latestUserText);
    if (weatherInfo) {
      return await fetchWeatherWithSearchFallback(
        weatherInfo.location,
        weatherInfo.scope,
        params.outputLanguage
      );
    }
  }

  if (/news|新聞/.test(combinedStepText)) {
    const newsQuery = inferNewsQuery(params.step, latestUserText);
    return await fetchNewsSummary(newsQuery, params.outputLanguage);
  }

  const candidateModels = getFallbackModels(params.step.recommendedModel);
  let lastError: unknown = null;

  const workerPrompt = [
    "You are a focused subtask worker inside a multi-agent assistant.",
    "Complete only the assigned step and return a concise result summary.",
    "Use tools when useful, but do not perform side-effect actions like sending messages.",
    "If the step is about weather or forecast, call get_weather.",
    "If the step is about news, call search_news first and use search_web only as fallback context.",
    "When you reference a URL, prefer markdown links like [title](url).",
    "Keep the final answer under 120 words.",
    params.outputLanguage === "en"
      ? "Write the result summary in English."
      : "請以繁體中文撰寫結果摘要。只有當使用者明確要求英文時才改成英文。",
    "",
    `System prompt context: ${params.systemPrompt || "none"}`,
    `Latest user message: ${lastUserMessage?.content || "(empty text)"}`,
    `Latest attachments: ${attachmentSummary}`,
    "",
    `Assigned step: ${params.step.title}`,
    `Objective: ${params.step.objective}`,
    `Required capabilities: ${params.step.requiredCapabilities.join(", ") || "none"}`,
  ].join("\n");

  for (const candidateModel of candidateModels) {
    try {
      const response = await ai.models.generateContent({
        model: candidateModel,
        contents: workerPrompt,
        config: {
          temperature: 0.2,
          topP: 0.9,
          topK: 30,
          maxOutputTokens: 512,
          tools: params.tools,
          automaticFunctionCalling: {
            maximumRemoteCalls: 4,
          },
        },
      });

      return (response.text ?? "").trim();
    } catch (error) {
      lastError = error;
      if (!isRetryableModelError(error)) {
        break;
      }
    }
  }

  throw lastError ?? new Error("Subtask execution failed.");
}

async function executeTaskPlanSteps(params: {
  taskPlan: TaskPlan | null;
  messages: ChatRequestBody["messages"];
  systemPrompt: string;
  tools: CallableTool[];
  outputLanguage: OutputLanguage;
}) {
  if (!params.taskPlan) return [] as TaskExecutionResult[];

  const jobs = params.taskPlan.steps.map(async (step) => {
    if (!isParallelizableStep(step)) {
      return {
        stepId: step.id,
        title: step.title,
        mode: "skipped",
        status: "skipped",
        modelUsed: step.recommendedModel,
        summary:
          "Skipped parallel execution because this step may have side effects or depends on later orchestration.",
      } satisfies TaskExecutionResult;
    }

    try {
      const summary = await executeSubtaskStepWithFallback({
        step,
        messages: params.messages,
        systemPrompt: params.systemPrompt,
        tools: params.tools,
        outputLanguage: params.outputLanguage,
      });
      const status = inferExecutionStatusFromSummary(summary);

      return {
        stepId: step.id,
        title: step.title,
        mode: "parallel",
        status,
        modelUsed: step.recommendedModel,
        summary: summary || "Subtask completed without additional details.",
      } satisfies TaskExecutionResult;
    } catch (error) {
      return {
        stepId: step.id,
        title: step.title,
        mode: "parallel",
        status: "failed",
        modelUsed: step.recommendedModel,
        summary: extractErrorText(error),
      } satisfies TaskExecutionResult;
    }
  });

  return await Promise.all(jobs);
}

async function startStreamWithFallback(params: {
  requestedModel: string;
  routingMode: ModelRoutingMode;
  messages: ChatRequestBody["messages"];
  systemPrompt: string;
  taskPlan: TaskPlan | null;
  tools: CallableTool[];
  contents: ReturnType<typeof toGeminiContents>;
  mergedSystemPrompt: string;
  generationConfig: GenerationConfig;
}) {
  const taskType =
    params.routingMode === "auto"
      ? params.taskPlan?.taskType ?? detectTaskType(params.messages, params.systemPrompt)
      : "general";
  const routedSelection =
    params.routingMode === "auto"
      ? params.taskPlan?.recommendedModel
        ? {
            model: params.taskPlan.recommendedModel,
            reason: `task planner recommended ${params.taskPlan.recommendedModel} for a ${taskType} task`,
          }
        : selectModelForTaskType(taskType, params.requestedModel)
      : {
          model: params.requestedModel,
          reason: "manual model selection is enabled",
        };

  const candidateModels = getFallbackModels(routedSelection.model);
  let lastError: unknown = null;
  let fallbackReason: string | undefined;

  for (const candidateModel of candidateModels) {
    try {
      const response = await ai.models.generateContentStream({
        model: candidateModel,
        contents: params.contents,
        config: {
          systemInstruction: params.mergedSystemPrompt,
          temperature: params.generationConfig?.temperature ?? 0.7,
          topP: params.generationConfig?.topP ?? 0.95,
          topK: params.generationConfig?.topK ?? 40,
          maxOutputTokens: params.generationConfig?.maxOutputTokens ?? 2048,
          tools: params.tools,
          automaticFunctionCalling: {
            maximumRemoteCalls: 6,
          },
        },
      });

      return {
        response,
        activeModel: candidateModel,
        routedModel: routedSelection.model,
        routeReason: routedSelection.reason,
        fallbackReason,
      };
    } catch (error) {
      lastError = error;
      if (!isRetryableModelError(error)) {
        throw error;
      }
      fallbackReason ??= summarizeFallbackReason(error);
    }
  }

  throw lastError ?? new Error("No available model could be started.");
}

async function generateSummaryWithFallback(params: {
  messages: Message[];
  memoryTurns: number;
  previousSummary: string;
  preferredModel: string;
  language: OutputLanguage;
}) {
  const candidateModels = getFallbackModels(params.preferredModel);
  let lastError: unknown = null;

  for (const candidateModel of candidateModels) {
    try {
      return await buildMemorySummary(
        params.messages,
        params.memoryTurns,
        params.previousSummary,
        candidateModel,
        params.language
      );
    } catch (error) {
      lastError = error;
      if (!isRetryableModelError(error)) {
        throw error;
      }
    }
  }

  if (params.previousSummary) {
    return params.previousSummary;
  }

  throw lastError ?? new Error("Failed to update memory summary.");
}

async function generateLongTermMemoryWithFallback(params: {
  messages: Message[];
  previousMemories: string[];
  preferredModel: string;
  language: OutputLanguage;
}) {
  const candidateModels = getFallbackModels(params.preferredModel);
  let lastError: unknown = null;

  for (const candidateModel of candidateModels) {
    try {
      return await updateLongTermMemories(
        params.messages,
        params.previousMemories,
        candidateModel,
        params.language
      );
    } catch (error) {
      lastError = error;
      if (!isRetryableModelError(error)) {
        throw error;
      }
    }
  }

  if (params.previousMemories.length > 0) {
    return params.previousMemories;
  }

  throw lastError ?? new Error("Failed to update long-term memory.");
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ChatRequestBody;
    const {
      model,
      modelRoutingMode,
      enableTaskPlanner,
      plannerModel,
      requireActionConfirmation,
      systemPrompt,
      messages,
      memorySummary,
      longTermMemories,
      generationConfig,
      memoryTurns,
    } = body;

    const outputLanguage = detectOutputLanguage({
      messages,
      systemPrompt: systemPrompt ?? "",
      longTermMemories: longTermMemories ?? [],
    });
    const recentMessages = buildRecentMessages(messages, memoryTurns);
    const taskPlan = enableTaskPlanner
      ? await analyzeTaskPlanWithFallback({
          messages,
          systemPrompt: systemPrompt ?? "",
          plannerSelection: plannerModel || "gemini-2.5-flash-lite",
          preferredExecutionModel: model || "gemini-2.5-flash-lite",
          outputLanguage,
        })
      : null;
    const tools = await buildModelTools();
    const taskExecutionResults =
      enableTaskPlanner && taskPlan
        ? await executeTaskPlanSteps({
            taskPlan,
            messages,
            systemPrompt: systemPrompt ?? "",
            tools,
            outputLanguage,
          })
        : [];

    const contents = toGeminiContents(
      memorySummary ?? "",
      recentMessages,
      buildLongTermMemoryContext(longTermMemories ?? [])
    );

    const mergedSystemPrompt = [
      systemPrompt ?? "",
      await buildTimeGroundingPrompt(),
      buildMemoryBehaviorPrompt(),
      buildTaskPlanContext(taskPlan),
      buildExecutionContext(taskExecutionResults),
      buildActionConfirmationPrompt(requireActionConfirmation),
      buildToolUsagePrompt(),
    ]
      .filter(Boolean)
      .join("\n\n");

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          const routingResult = await startStreamWithFallback({
            requestedModel: model,
            routingMode: modelRoutingMode,
            messages,
            systemPrompt: systemPrompt ?? "",
            taskPlan,
            tools,
            contents,
            mergedSystemPrompt,
            generationConfig,
          });

          if (taskPlan) {
            controller.enqueue(
              encoder.encode(
                JSON.stringify({
                  type: "taskPlan",
                  plan: taskPlan,
                }) + "\n"
              )
            );
          }

          if (taskExecutionResults.length > 0) {
            controller.enqueue(
              encoder.encode(
                JSON.stringify({
                  type: "taskExecution",
                  results: taskExecutionResults,
                }) + "\n"
              )
            );
          }

          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                type: "modelStatus",
                requestedModel: model,
                routingMode: modelRoutingMode,
                routedModel: routingResult.routedModel,
                routeReason: routingResult.routeReason,
                fallbackReason: routingResult.fallbackReason,
                activeModel: routingResult.activeModel,
                didFallback:
                  routingResult.activeModel !== routingResult.routedModel,
              }) + "\n"
            )
          );

          let fullText = "";

          for await (const chunk of routingResult.response) {
            const text = chunk.text ?? "";
            if (!text) continue;

            fullText += text;
            controller.enqueue(
              encoder.encode(JSON.stringify({ type: "delta", text }) + "\n")
            );
          }

          const assistantMessage = buildAssistantMessage(messages, fullText);
          const allMessages = [...messages, assistantMessage];

          const [newSummary, newLongTermMemories] = await Promise.all([
            generateSummaryWithFallback({
              messages: allMessages,
              memoryTurns,
              previousSummary: memorySummary ?? "",
              preferredModel: routingResult.activeModel,
              language: outputLanguage,
            }),
            generateLongTermMemoryWithFallback({
              messages: allMessages,
              previousMemories: longTermMemories ?? [],
              preferredModel: routingResult.activeModel,
              language: outputLanguage,
            }),
          ]);

          controller.enqueue(
            encoder.encode(
              JSON.stringify({ type: "memorySummary", text: newSummary }) + "\n"
            )
          );
          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                type: "longTermMemory",
                items: newLongTermMemories,
              }) + "\n"
            )
          );

          controller.close();
        } catch (error) {
          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                type: "error",
                message: extractErrorText(error),
              }) + "\n"
            )
          );
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return Response.json({ error: extractErrorText(error) }, { status: 500 });
  }
}
