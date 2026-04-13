declare module "@oh-my-pi/pi-ai" {
  export type Api =
    | "anthropic-messages"
    | "google-gemini"
    | "openai-completions"
    | "openai-responses"
    | "openai-codex-responses"
    | "vertex-claude-api"
    | "bedrock-claude-api"
    | (string & {});

  export interface Model<TApi extends Api = Api> {
    id: string;
    name: string;
    api: TApi;
    provider: string;
    baseUrl: string;
    reasoning: boolean;
    input: ("text" | "image")[];
    cost: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
    };
    contextWindow: number;
    maxTokens: number;
    headers?: Record<string, string>;
    [key: string]: unknown;
  }

  export interface CompletionMessage {
    role: "user" | "assistant" | "system";
    content: string | Array<{ type: string; text?: string; [key: string]: unknown }>;
    timestamp: number;
  }

  export interface CompletionOptions {
    apiKey?: string;
    headers?: Record<string, string>;
    maxTokens?: number;
    signal?: AbortSignal;
  }

  export interface AssistantMessage {
    role: "assistant";
    content: Array<
      | { type: "text"; text: string }
      | { type: "thinking"; thinking: string }
      | { type: "toolCall"; [key: string]: unknown }
      | { type: string; [key: string]: unknown }
    >;
    api: Api;
    provider: string;
    model: string;
    timestamp: number;
    duration: number;
    stopReason?: string;
    errorMessage?: string;
    usage?: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
    };
  }

  export function complete<TApi extends Api>(
    model: Model<TApi>,
    context: { messages: CompletionMessage[] },
    options: CompletionOptions,
  ): Promise<AssistantMessage>;

  export function completeSimple<TApi extends Api>(
    model: Model<TApi>,
    context: { systemPrompt?: string; messages: CompletionMessage[] },
    options?: CompletionOptions & { reasoning?: unknown },
  ): Promise<AssistantMessage>;
}
