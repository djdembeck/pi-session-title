declare module "@oh-my-pi/pi-ai" {
  export type KnownApi =
    | "anthropic-messages"
    | "google-generative-ai"
    | "google-gemini-cli"
    | "google-vertex"
    | "openai-completions"
    | "openai-responses"
    | "openai-codex-responses"
    | "azure-openai-responses"
    | "bedrock-converse-stream"
    | "cursor-agent";

  export type Api = KnownApi | (string & {});

  export type KnownProvider =
    | "alibaba-coding-plan"
    | "amazon-bedrock"
    | "anthropic"
    | "google"
    | "google-gemini-cli"
    | "google-antigravity"
    | "google-vertex"
    | "openai"
    | "openai-codex"
    | "kimi-code"
    | "minimax-code"
    | "minimax-code-cn"
    | "github-copilot"
    | "cursor"
    | "gitlab-duo"
    | "synthetic"
    | "xai"
    | "groq"
    | "cerebras"
    | "openrouter"
    | "kilo"
    | "vercel-ai-gateway"
    | "zai"
    | "mistral"
    | "minimax"
    | "opencode-go"
    | "opencode-zen"
    | "cloudflare-ai-gateway"
    | "huggingface"
    | "litellm"
    | "moonshot"
    | "nvidia"
    | "nanogpt"
    | "ollama"
    | "qianfan"
    | "qwen-portal"
    | "together"
    | "venice"
    | "vllm"
    | "xiaomi"
    | "zenmux"
    | "lm-studio";

  export type Provider = KnownProvider | (string & {});

  export interface Model<TApi extends Api = Api> {
    id: string;
    name: string;
    api: TApi;
    provider: Provider;
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
    premiumMultiplier?: number;
    preferWebsockets?: boolean;
    contextPromotionTarget?: string;
    priority?: number;
    thinking?: ThinkingConfig;
    compat?: TApi extends "openai-completions" ? OpenAICompat : never;
  }

  export interface ThinkingConfig {
    minLevel: Effort;
    maxLevel: Effort;
    mode: ThinkingControlMode;
  }

  export type Effort = "low" | "medium" | "high";

  export type ThinkingControlMode =
    | "effort"
    | "budget"
    | "google-level"
    | "anthropic-adaptive"
    | "anthropic-budget-effort";

  export interface OpenAICompat {
    supportsStore?: boolean;
    supportsDeveloperRole?: boolean;
    supportsReasoningEffort?: boolean;
    reasoningEffortMap?: Partial<Record<Effort, string>>;
    supportsUsageInStreaming?: boolean;
    maxTokensField?: "max_completion_tokens" | "max_tokens";
    requiresToolResultName?: boolean;
    requiresAssistantAfterToolResult?: boolean;
    requiresThinkingAsText?: boolean;
    requiresMistralToolIds?: boolean;
    thinkingFormat?: "openai" | "openrouter" | "zai" | "qwen" | "qwen-chat-template";
  }

  export interface Context {
    systemPrompt?: string;
    messages: Message[];
    tools?: Tool[];
  }

  export interface Message {
    role: "user" | "assistant" | "developer" | "toolResult";
    content: string | Content[];
    timestamp: number;
    [key: string]: unknown;
  }

  export type Content =
    | TextContent
    | ThinkingContent
    | ImageContent
    | ToolCall;

  export interface TextContent {
    type: "text";
    text: string;
  }

  export interface ThinkingContent {
    type: "thinking";
    thinking: string;
  }

  export interface ImageContent {
    type: "image";
    data: string;
    mimeType: string;
  }

  export interface ToolCall {
    type: "toolCall";
    id: string;
    name: string;
    input: Record<string, unknown>;
  }

  export interface Tool {
    name: string;
    description: string;
    parameters: unknown;
    strict?: boolean;
  }

  export interface StreamOptions {
    temperature?: number;
    topP?: number;
    topK?: number;
    minP?: number;
    presencePenalty?: number;
    repetitionPenalty?: number;
    maxTokens?: number;
    signal?: AbortSignal;
    apiKey?: string;
    headers?: Record<string, string>;
    sessionId?: string;
  }

  export interface SimpleStreamOptions extends StreamOptions {
    reasoning?: Effort;
    thinkingBudgets?: Record<Effort, number>;
    cursorExecHandlers?: CursorExecHandlers;
    cursorOnToolResult?: (result: unknown) => void;
    toolChoice?: ToolChoice;
    serviceTier?: ServiceTier;
    kimiApiFormat?: "kimi" | "openai";
    syntheticApiFormat?: "openai" | "anthropic";
    preferWebsockets?: boolean;
  }

  export interface Usage {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
    premiumRequests?: number;
    cost: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      total: number;
    };
  }

  export type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";

  export interface AssistantMessage {
    role: "assistant";
    content: (TextContent | ThinkingContent | ToolCall)[];
    api: Api;
    provider: Provider;
    model: string;
    responseId?: string;
    usage: Usage;
    stopReason: StopReason;
    errorMessage?: string;
    timestamp: number;
    duration?: number;
    ttft?: number;
  }

  export function complete<TApi extends Api>(
    model: Model<TApi>,
    context: Context,
    options?: StreamOptions | ApiSpecificOptions<TApi>,
  ): Promise<AssistantMessage>;

  export function completeSimple<TApi extends Api>(
    model: Model<TApi>,
    context: Context,
    options?: SimpleStreamOptions,
  ): Promise<AssistantMessage>;

  export type ApiSpecificOptions<TApi extends Api> =
    | StreamOptions
    | (TApi extends keyof ApiOptionsMap ? ApiOptionsMap[TApi] : never);

  export interface ApiOptionsMap {
    "anthropic-messages": AnthropicOptions;
    "bedrock-converse-stream": unknown;
    "openai-completions": unknown;
    "openai-responses": unknown;
    "openai-codex-responses": unknown;
    "azure-openai-responses": unknown;
    "google-generative-ai": unknown;
    "google-gemini-cli": unknown;
    "google-vertex": unknown;
    "cursor-agent": unknown;
  }

  export interface AnthropicOptions extends StreamOptions {
    cacheRetention?: unknown;
  }

  export type CursorExecHandlers = {
    executeBash?: (command: string) => Promise<{ output: string; exitCode: number }>;
    readFile?: (path: string) => Promise<string>;
    writeFile?: (path: string, content: string) => Promise<void>;
  };

  export type ToolChoice =
    | "auto"
    | "required"
    | { type: "function"; function: { name: string } };

  export type ServiceTier =
    | "auto"
    | "default"
    | "flex";
}
