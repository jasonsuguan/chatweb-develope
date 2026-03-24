export type Role = "user" | "assistant";

export type Message = {
  id: number;
  role: Role;
  content: string;
};

export type ChatPreset = "general" | "coding" | "custom";

export type ChatSettings = {
  preset: ChatPreset;
  model: string;
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
  settings: ChatSettings;
};

export type ChatRequestBody = {
  model: string;
  systemPrompt: string;
  messages: Message[];
  memorySummary: string;
  generationConfig: {
    temperature?: number;
    topP?: number;
    topK?: number;
    maxOutputTokens?: number;
  };
  memoryTurns: number;
};

export type StreamChunk =
  | { type: "delta"; text: string }
  | { type: "memorySummary"; text: string }
  | { type: "error"; message: string };