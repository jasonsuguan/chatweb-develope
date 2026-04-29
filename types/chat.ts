export type Role = "user" | "assistant";

export type AssetKind = "image" | "pdf" | "audio";

export type MessageAttachment = {
  assetId: string;
  kind: AssetKind;
  name: string;
  mimeType: string;
};

export type RequestAttachment = MessageAttachment & {
  dataUrl: string;
};

export type Message = {
  id: number;
  role: Role;
  content: string;
  attachments?: MessageAttachment[];
  diagnostics?: MessageDiagnostics;
};

export type ChatRequestMessage = Omit<Message, "attachments"> & {
  attachments?: RequestAttachment[];
};

export type AssetRecord = {
  id: string;
  kind: AssetKind;
  name: string;
  mimeType: string;
  dataUrl: string;
  size: number;
  uploadedAt: string;
  sourceChatId: number;
  sourceMessageId: number;
};

export type PendingUpload = {
  id: string;
  kind: AssetKind;
  name: string;
  mimeType: string;
  dataUrl: string;
  size: number;
};

export type ChatPreset = "general" | "coding" | "custom";
export type ModelRoutingMode = "manual" | "auto";
export type TaskComplexity = "low" | "medium" | "high";
export type TaskType =
  | "multimodal"
  | "coding"
  | "tool_call"
  | "deep_reasoning"
  | "general";

export type TaskPlanStep = {
  id: string;
  title: string;
  objective: string;
  recommendedModel: string;
  requiredCapabilities: string[];
};

export type TaskExecutionResult = {
  stepId: string;
  title: string;
  mode: "parallel" | "skipped";
  status: "completed" | "skipped" | "failed";
  summary: string;
  modelUsed?: string;
};

export type TaskPlan = {
  summary: string;
  taskType: TaskType;
  complexity: TaskComplexity;
  recommendedModel: string;
  reasoning: string;
  requiredCapabilities: string[];
  steps: TaskPlanStep[];
  plannerProvider?: "groq" | "gemini" | "heuristic";
  plannerModelUsed?: string;
};

export type ChatSettings = {
  preset: ChatPreset;
  model: string;
  modelRoutingMode: ModelRoutingMode;
  enableTaskPlanner: boolean;
  plannerModel: string;
  requireActionConfirmation: boolean;
  systemPrompt: string;
  temperature: number;
  topP: number;
  topK: number;
  maxOutputTokens: number;
  memoryTurns: number;
};

export type ChatRoom = {
  id: number;
  name: string;
  summary: string;
  messages: Message[];
  memorySummary: string;
  lastTaskPlan?: TaskPlan | null;
  lastTaskExecution?: TaskExecutionResult[];
  settings: ChatSettings;
};

export type ChatRequestBody = {
  chatId: number;
  model: string;
  modelRoutingMode: ModelRoutingMode;
  enableTaskPlanner: boolean;
  plannerModel: string;
  requireActionConfirmation: boolean;
  systemPrompt: string;
  messages: ChatRequestMessage[];
  memorySummary: string;
  longTermMemories: string[];
  generationConfig: {
    temperature?: number;
    topP?: number;
    topK?: number;
    maxOutputTokens?: number;
  };
  memoryTurns: number;
};

export type IntegrationStatus = {
  telegramConfigured: boolean;
  telegramDefaultTargetConfigured: boolean;
  telegramNamedTargetsCount: number;
  discordConfigured: boolean;
  discordDefaultChannelConfigured: boolean;
  discordNamedChannelsCount: number;
  discordNamedUsersCount: number;
  timeMcpEnabled: boolean;
  searchMcpEnabled: boolean;
  telegramMcpEnabled: boolean;
  discordMcpEnabled: boolean;
  weatherMcpEnabled: boolean;
};

export type StreamChunk =
  | { type: "delta"; text: string }
  | { type: "memorySummary"; text: string }
  | { type: "longTermMemory"; items: string[] }
  | { type: "taskPlan"; plan: TaskPlan }
  | { type: "taskExecution"; results: TaskExecutionResult[] }
  | {
      type: "modelStatus";
      requestedModel: string;
      routingMode?: ModelRoutingMode;
      routedModel?: string;
      routeReason?: string;
      fallbackReason?: string;
      activeModel: string;
      didFallback: boolean;
    }
  | { type: "error"; message: string };

export type ModelStatusInfo = {
  requestedModel: string;
  routingMode?: ModelRoutingMode;
  routedModel?: string;
  routeReason?: string;
  fallbackReason?: string;
  activeModel: string;
  didFallback: boolean;
};

export type MessageDiagnostics = {
  taskPlan?: TaskPlan | null;
  taskExecution?: TaskExecutionResult[];
  modelStatus?: ModelStatusInfo | null;
  error?: string | null;
};
