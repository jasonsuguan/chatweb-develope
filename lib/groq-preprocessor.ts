const GROQ_CHAT_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_GROQ_PREPROCESSOR_MODEL = "llama-3.1-8b-instant";
const GROQ_PREPROCESSOR_FALLBACK_MODELS = ["llama-3.3-70b-versatile"];

type GroqJsonCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
  };
};

type GroqApiError = Error & {
  status?: number;
};

function uniqueModels(models: Array<string | undefined | null>) {
  return [...new Set(models.map((model) => model?.trim()).filter(Boolean))] as string[];
}

function stripCodeFences(text: string) {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function createGroqApiError(message: string, status?: number): GroqApiError {
  const error = new Error(message) as GroqApiError;
  if (typeof status === "number") {
    error.status = status;
  }
  return error;
}

function isRetryableGroqError(error: unknown) {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const status =
    "status" in error && typeof error.status === "number" ? error.status : undefined;
  const message =
    "message" in error && typeof error.message === "string"
      ? error.message.toLowerCase()
      : "";

  return (
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    /rate limit|quota|too many requests|resource exhausted|unavailable|overloaded|high demand|timeout/.test(
      message
    )
  );
}

export function isGroqPreprocessorConfigured() {
  return Boolean(process.env.GROQ_API_KEY?.trim());
}

export function getGroqPreprocessorModel() {
  return (
    process.env.GROQ_PREPROCESSOR_MODEL?.trim() || DEFAULT_GROQ_PREPROCESSOR_MODEL
  );
}

export function getGroqPreprocessorCandidateModels(preferredModel?: string) {
  return uniqueModels([
    preferredModel,
    getGroqPreprocessorModel(),
    ...GROQ_PREPROCESSOR_FALLBACK_MODELS,
  ]);
}

export async function generateGroqPlannerJson<T>(params: {
  prompt: string;
  systemPrompt?: string;
  preferredModel?: string;
  temperature?: number;
  topP?: number;
  maxCompletionTokens?: number;
}) {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    throw createGroqApiError("GROQ_API_KEY is not configured.");
  }

  const candidateModels = getGroqPreprocessorCandidateModels(params.preferredModel);
  let lastError: unknown = null;

  for (const candidateModel of candidateModels) {
    try {
      const response = await fetch(GROQ_CHAT_COMPLETIONS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: candidateModel,
          messages: [
            {
              role: "system",
              content:
                params.systemPrompt ||
                "You are a lightweight task planner that returns valid JSON only.",
            },
            {
              role: "user",
              content: params.prompt,
            },
          ],
          temperature: params.temperature ?? 0.2,
          top_p: params.topP ?? 0.8,
          max_completion_tokens: params.maxCompletionTokens ?? 1024,
          response_format: {
            type: "json_object",
          },
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });

      const data = (await response.json()) as GroqJsonCompletionResponse;

      if (!response.ok) {
        throw createGroqApiError(
          data.error?.message || `Groq request failed with HTTP ${response.status}`,
          response.status
        );
      }

      const rawContent = data.choices?.[0]?.message?.content;
      const content = typeof rawContent === "string" ? stripCodeFences(rawContent) : "";
      if (!content) {
        throw createGroqApiError(
          `Groq model ${candidateModel} returned an empty planner response.`
        );
      }

      return {
        model: candidateModel,
        value: JSON.parse(content) as T,
      };
    } catch (error) {
      lastError = error;
      if (!isRetryableGroqError(error)) {
        break;
      }
    }
  }

  throw (lastError ??
    createGroqApiError("Groq planner request failed without a specific error.")) as Error;
}
