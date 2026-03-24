import { NextRequest } from "next/server";
import { ai } from "@/lib/gemini";
import {
  buildMemorySummary,
  buildRecentMessages,
  toGeminiContents,
} from "@/lib/chat-memory";
import type { ChatRequestBody } from "@/types/chat";

export const runtime = "nodejs";

function buildTimeGroundingPrompt() {
  const now = new Date();

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

  return `
目前伺服器時間如下：
- 時區：Asia/Taipei
- 日期：${taipeiDate}
- 時間：${taipeiTime}

規則：
1. 回答任何與目前日期、時間、年份、星期有關的問題時，必須以以上伺服器時間為準。
2. 不要自行猜測今天的日期或年份。
3. 不要聲稱你有內部時鐘、系統即時時間、或即時上網查詢能力，除非本系統明確提供。
`;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ChatRequestBody;

    const {
      model,
      systemPrompt,
      messages,
      memorySummary,
      generationConfig,
      memoryTurns,
    } = body;

    console.log({
      model,
      temperature: generationConfig?.temperature,
      topP: generationConfig?.topP,
      topK: generationConfig?.topK,
      maxOutputTokens: generationConfig?.maxOutputTokens,
    });

    const recentMessages = buildRecentMessages(messages, memoryTurns);
    const contents = toGeminiContents(memorySummary ?? "", recentMessages);

    const mergedSystemPrompt = [
      systemPrompt ?? "",
      buildTimeGroundingPrompt(),
    ]
      .filter(Boolean)
      .join("\n\n");

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          const response = await ai.models.generateContentStream({
            model,
            contents,
            config: {
              systemInstruction: mergedSystemPrompt,
              temperature: generationConfig?.temperature ?? 0.7,
              topP: generationConfig?.topP ?? 0.95,
              topK: generationConfig?.topK ?? 40,
              maxOutputTokens: generationConfig?.maxOutputTokens ?? 2048,
            },
          });

          let fullText = "";

          for await (const chunk of response) {
            const text = chunk.text ?? "";
            if (!text) continue;

            fullText += text;
            controller.enqueue(
              encoder.encode(JSON.stringify({ type: "delta", text }) + "\n")
            );
          }

          const newSummary = await buildMemorySummary(
            [...messages, { role: "assistant", content: fullText, id: Date.now() }],
            memoryTurns,
            memorySummary ?? "",
            model
          );

          controller.enqueue(
            encoder.encode(
              JSON.stringify({ type: "memorySummary", text: newSummary }) + "\n"
            )
          );

          controller.close();
        } catch (error) {
          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                type: "error",
                message: error instanceof Error ? error.message : "Unknown error",
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
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}