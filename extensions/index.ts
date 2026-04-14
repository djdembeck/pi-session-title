import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { complete as completeFn, Model } from "@oh-my-pi/pi-ai";
import * as fs from "node:fs";
import * as path from "node:path";

const DEFAULT_TITLE_PROMPT = `Generate a concise title (max 6 words) for this coding session based on the first user message.

First message: {{firstMessage}}
Working directory: {{cwd}}

Respond with ONLY the title, no quotes or punctuation.`;

const DEFAULT_MAX_INPUT = 2000;
const DEFAULT_MAX_TOKENS = 30;

interface TemplateContext {
  firstMessage: string;
  cwd: string;
  timestamp: string;
  [key: string]: string;
}

interface TitleConfig {
  templatePath?: string;
  maxInputLength?: number;
  maxOutputTokens?: number;
  enabled?: boolean;
}

type CompletionModel = NonNullable<ExtensionContext["model"]>;

type SessionNameCapableApi = ExtensionAPI & {
  getSessionName?: () => string | undefined;
  setSessionName?: (name: string, source?: "auto" | "user") => void | Promise<void>;
};

interface SessionNameApi {
  available: boolean;
  get: () => string | undefined;
  set: (name: string, source?: "auto" | "user") => Promise<void>;
}

interface ResolvedAuth {
  apiKey: string;
  headers?: Record<string, string>;
}

const PROJECT_TEMPLATE_PATHS = [
  ".pi/prompts/title.md",
  ".omp/prompts/title.md",
];

const GLOBAL_TEMPLATE_PATHS = [
  (home: string) => path.join(home, ".pi", "agent", "prompts", "title.md"),
  (home: string) => path.join(home, ".omp", "agent", "prompts", "title.md"),
];

function validatePositiveInteger(value: unknown, defaultValue: number): number {
  const num = Number(value);
  return Number.isFinite(num) && Number.isInteger(num) && num > 0 ? num : defaultValue;
}

function createConfigFromEnv(): TitleConfig {
  return {
    templatePath: process.env.PI_TITLE_TEMPLATE,
    maxInputLength: validatePositiveInteger(
      process.env.PI_TITLE_MAX_INPUT ? parseInt(process.env.PI_TITLE_MAX_INPUT, 10) : DEFAULT_MAX_INPUT,
      DEFAULT_MAX_INPUT,
    ),
    maxOutputTokens: validatePositiveInteger(
      process.env.PI_TITLE_MAX_TOKENS ? parseInt(process.env.PI_TITLE_MAX_TOKENS, 10) : DEFAULT_MAX_TOKENS,
      DEFAULT_MAX_TOKENS,
    ),
    enabled: process.env.PI_TITLE_ENABLED !== "false",
  };
}

function createSessionNameApi(pi: ExtensionAPI): SessionNameApi {
  const api = pi as SessionNameCapableApi;
  const getSessionName = typeof api.getSessionName === "function"
    ? api.getSessionName.bind(api)
    : undefined;
  const setSessionName = typeof api.setSessionName === "function"
    ? api.setSessionName.bind(api)
    : undefined;

  return {
    available: getSessionName !== undefined && setSessionName !== undefined,
    get: () => getSessionName?.() ?? undefined,
    set: async (name: string, source: "auto" | "user" = "auto") => {
      if (!setSessionName) {
        return;
      }
      await setSessionName(name, source);
    },
  };
}

function simpleTemplate(template: string, context: TemplateContext): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (key in context) {
      return context[key];
    }
    return match;
  });
}

function renderTemplate(
  template: string,
  context: { firstMessage: string; cwd: string; timestamp: string },
): string {
  return simpleTemplate(template, context);
}

function sanitizeTitle(title: string): string {
  return title
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\n+/g, " ")
    .slice(0, 72);
}

function isPromptTitleCandidate(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  return !trimmed.startsWith("/") && !trimmed.startsWith("!") && !trimmed.startsWith("$");
}

async function resolveTemplatePath(cwd: string, customPath?: string): Promise<string | null> {
  const existsAsync = async (candidatePath: string): Promise<boolean> =>
    await fs.promises.access(candidatePath).then(() => true).catch(() => false);

  if (customPath) {
    const absolutePath = path.isAbsolute(customPath)
      ? customPath
      : path.join(cwd, customPath);

    if (await existsAsync(absolutePath)) {
      return absolutePath;
    }
    return null;
  }

  for (const relativePath of PROJECT_TEMPLATE_PATHS) {
    const fullPath = path.join(cwd, relativePath);
    if (await existsAsync(fullPath)) {
      return fullPath;
    }
  }

  const home = process.env.HOME || process.env.USERPROFILE;
  if (home) {
    for (const getPath of GLOBAL_TEMPLATE_PATHS) {
      const fullPath = getPath(home);
      if (await existsAsync(fullPath)) {
        return fullPath;
      }
    }
  }

  return null;
}

async function loadTemplate(templatePath: string): Promise<string> {
  return fs.promises.readFile(templatePath, "utf-8");
}

/**
 * Resolve API key and headers for a model, supporting both pi-mono and oh-my-pi runtimes.
 * - pi-mono: getApiKeyAndHeaders(model) → { ok, apiKey?, headers? }
 * - oh-my-pi: getApiKey(model, sessionId?) → string | undefined
 *
 * Note: oh-my-pi ModelRegistry.getApiKey returns "N/A" (kNoAuth) for keyless providers.
 * We filter this out since "N/A" is not a valid API key for calling complete().
 */
const K_NO_AUTH = "N/A";

function isAuthenticated(apiKey: string | undefined | null): apiKey is string {
  return Boolean(apiKey) && apiKey !== K_NO_AUTH;
}

async function resolveModelAuth(
  modelRegistry: ExtensionContext["modelRegistry"],
  model: CompletionModel,
  sessionId?: string,
): Promise<ResolvedAuth | undefined> {
  const registry = modelRegistry as ExtensionContext["modelRegistry"] & {
    getApiKeyAndHeaders?: (model: CompletionModel) => Promise<{ ok: boolean; apiKey?: string; headers?: Record<string, string>; error?: string }>;
    getApiKey?: (model: CompletionModel, sessionId?: string) => Promise<string | undefined>;
  };

  // Prefer getApiKeyAndHeaders (pi-mono) which includes dynamic auth headers
  if (typeof registry.getApiKeyAndHeaders === "function") {
    const result = await registry.getApiKeyAndHeaders(model);
    if (result.ok && isAuthenticated(result.apiKey)) {
      return { apiKey: result.apiKey, headers: { ...model.headers, ...result.headers } };
    }
    return undefined;
  }

  // Fall back to getApiKey (oh-my-pi)
  if (typeof registry.getApiKey === "function") {
    const apiKey = await registry.getApiKey(model, sessionId);
    if (isAuthenticated(apiKey)) {
      return { apiKey, headers: model.headers };
    }
    return undefined;
  }

  return undefined;
}
async function generateTitle(options: {
  model: CompletionModel;
  apiKey: string;
  headers?: Record<string, string>;
  template: string;
  context: {
    firstMessage: string;
    cwd: string;
    timestamp: string;
  };
  maxTokens: number;
  signal?: AbortSignal;
}): Promise<string> {
  const { model, apiKey, headers, template, context, maxTokens, signal } = options;
  const prompt = renderTemplate(template, context);

  try {
    // Try @oh-my-pi/pi-ai first (oh-my-pi binary), then fall back to @mariozechner/pi-ai (opencode)
    let complete: typeof completeFn;
    try {
      const piAi = await import("@oh-my-pi/pi-ai");
      complete = piAi.complete as typeof completeFn;
    } catch (error) {
      // Only catch module-not-found errors; re-throw actual package errors
      if (
        error instanceof Error && (
          error.message?.includes("Cannot find package") ||
          (error as any).code === "ERR_MODULE_NOT_FOUND" ||
          (error as any).code === "MODULE_NOT_FOUND"
        )
      ) {
        const piAi = await import("@mariozechner/pi-ai");
        complete = piAi.complete as typeof completeFn;
      } else {
        throw error;
      }
    }

    if (typeof complete !== "function") {
      console.error("complete is not a function from pi-ai");
      return "";
    }

    const response = await complete(
      model as Model,
      {
        messages: [{
          role: "user",
          content: [{ type: "text", text: prompt }],
          timestamp: Date.now(),
        }],
      },
      {
        apiKey,
        headers,
        maxTokens,
        signal,
      },
    );

    const textContent = response.content.find(
      (c: { type: string }) => c.type === "text",
    ) as { type: "text"; text: string } | undefined;
    if (textContent) {
      return textContent.text;
    }

    // Fallback: extract title from thinking content when model only returns reasoning
    const thinkingContent = response.content.find(
      (c: { type: string }) => c.type === "thinking",
    ) as { type: "thinking"; thinking: string } | undefined;
    if (thinkingContent) {
      const titleLine = extractTitleFromThinking(thinkingContent.thinking);
      if (titleLine) {
        return titleLine;
      }
    }

    return "";
  } catch (error) {
    if (
      error instanceof Error && (
        error.message?.includes("Cannot find package") ||
        (error as any).code === "ERR_MODULE_NOT_FOUND" ||
        (error as any).code === "MODULE_NOT_FOUND"
      )
    ) {
      // pi-ai not installed — skip gracefully without noise
      return "";
    }
    console.error("Error calling complete:", error);
    return "";
  }
}

/**
 * Extract a plausible title from thinking/reasoning content by filtering
 * out common reasoning patterns and returning the first substantive line.
 */
function extractTitleFromThinking(thinking: string): string | null {
  // Lines that are clearly meta-reasoning, not title candidates
  const metaPrefixes = [
    "we are", "according to", "let me", "i need to",
    "the user wants", "the user asked", "the user is",
    "processing", "analyzing", "i'll", "i will", "i should",
    "i'm going to", "i can", "i need", "i want",
    "looking at", "based on", "first,", "so,",
    "this is", "this seems", "it looks",
  ];

  const lines = thinking
    .split("\n")
    .map(l => l.trim())
    .filter(l => {
      if (!l) return false;
      const lower = l.toLowerCase();
      return !metaPrefixes.some(prefix => lower.startsWith(prefix));
    });

  if (lines.length > 0) {
    return lines[0];
  }
  return null;
}

export default function sessionTitleExtension(pi: ExtensionAPI) {
  let titleSettled = false;
  let firstMessage: string | null = null;
  let sawInteractiveInput = false;
  let generateTitlePromise: Promise<void> | null = null;
  let sessionGenerationId = 0;
  const config = createConfigFromEnv();
  const sessionNameApi = createSessionNameApi(pi);

  const maybeGenerateTitle = async (message: string, ctx: ExtensionContext): Promise<void> => {
    if (titleSettled) {
      return;
    }

    // Prevent concurrent generateTitle calls with a promise-based mutex.
    // Set the promise eagerly (before async pre-work) to close the mutex gap.
    if (generateTitlePromise) {
      await generateTitlePromise;
      return;
    }

    const existingName = sessionNameApi.get();
    if (existingName) {
      titleSettled = true;
      return;
    }

    if (config.enabled === false || !sessionNameApi.available) {
      titleSettled = true;
      return;
    }

    if (!isPromptTitleCandidate(message)) {
      return;
    }

    if (!firstMessage) {
      firstMessage = message.trim();
    }

    const model = ctx.model;
    if (!model) {
      return;
    }
    const capturedGenerationId = sessionGenerationId;

    generateTitlePromise = (async () => {
      try {
        const sessionId = ctx.sessionManager?.getSessionId();
        const auth = await resolveModelAuth(ctx.modelRegistry, model, sessionId);
        if (!auth?.apiKey) {
          return;
        }

        const cwd = ctx.cwd;
        let template = DEFAULT_TITLE_PROMPT;

        const templatePath = await resolveTemplatePath(cwd, config.templatePath);
        if (templatePath) {
          try {
            template = await loadTemplate(templatePath);
          } catch (error) {
            console.error(`Failed to load template from ${templatePath}, using default:`, error);
          }
        }

        if (sessionGenerationId !== capturedGenerationId) {
          return;
        }

        const title = await generateTitle({
          model,
          apiKey: auth.apiKey,
          headers: auth.headers,
          template,
          context: {
            firstMessage: firstMessage!.slice(
              0,
              validatePositiveInteger(config.maxInputLength, DEFAULT_MAX_INPUT),
            ),
            cwd,
            timestamp: new Date().toISOString(),
          },
          maxTokens: validatePositiveInteger(config.maxOutputTokens, DEFAULT_MAX_TOKENS),
          signal: ctx.signal,
        });

        if (sessionGenerationId !== capturedGenerationId) {
          return;
        }

        const sanitizedTitle = sanitizeTitle(title);
        if (!sanitizedTitle) {
          titleSettled = true;
          return;
        }

        if (!sessionNameApi.get()) {
          await sessionNameApi.set(sanitizedTitle, "auto");
        }
        titleSettled = true;
      } finally {
        if (sessionGenerationId === capturedGenerationId) {
          generateTitlePromise = null;
        }
      }
    })();

    try {
      await generateTitlePromise;
    } catch (error) {
      console.error("Error in sessionTitleExtension:", error);
      // Do NOT set titleSettled = true here — allow retries on transient errors
    }
  };

  pi.on("input", async (event, ctx) => {
    if (event.source === "extension") {
      return;
    }
    sawInteractiveInput = true;

    await maybeGenerateTitle(event.text, ctx);
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (sawInteractiveInput) {
      return;
    }

    await maybeGenerateTitle(event.prompt, ctx);
  });

  pi.on("session_start", async () => {
    sessionGenerationId++;
    titleSettled = false;
    firstMessage = null;
    sawInteractiveInput = false;
    generateTitlePromise = null;
  });
}
