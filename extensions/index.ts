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
  setSessionName?: (name: string) => void | Promise<void>;
};

interface SessionNameApi {
  available: boolean;
  get: () => string | undefined;
  set: (name: string) => Promise<void>;
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
  return Number.isFinite(value) && Number.isInteger(value) && (value as number) > 0
    ? value as number
    : defaultValue;
}

function createConfigFromEnv(): TitleConfig {
  return {
    templatePath: process.env.PI_TITLE_TEMPLATE,
    maxInputLength: process.env.PI_TITLE_MAX_INPUT
      ? parseInt(process.env.PI_TITLE_MAX_INPUT, 10)
      : DEFAULT_MAX_INPUT,
    maxOutputTokens: process.env.PI_TITLE_MAX_TOKENS
      ? parseInt(process.env.PI_TITLE_MAX_TOKENS, 10)
      : DEFAULT_MAX_TOKENS,
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
    set: async (name: string) => {
      if (!setSessionName) {
        return;
      }
      await setSessionName(name);
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
    const piAi = await import("@oh-my-pi/pi-ai");
    const complete = piAi.complete as typeof completeFn;

    if (typeof complete !== "function") {
      console.error("complete is not a function from @oh-my-pi/pi-ai");
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

    const thinkingContent = response.content.find(
      (c: { type: string }) => c.type === "thinking",
    ) as { type: "thinking"; thinking: string } | undefined;
    if (thinkingContent) {
      const lines = thinkingContent.thinking
        .split("\n")
        .map((l: string) => l.trim())
        .filter((l: string) => {
          if (!l) return false;
          // Filter out common non-title reasoning patterns (case-insensitive)
          const lower = l.toLowerCase();
          if (lower.startsWith("we are") || lower.startsWith("according to")) return false;
          if (lower.startsWith("let me") || lower.startsWith("i need to")) return false;
          if (lower.startsWith("the user wants") || lower.startsWith("the user asked")) return false;
          if (lower.startsWith("processing") || lower.startsWith("analyzing")) return false;
          if (lower.startsWith("i'll") || lower.startsWith("i will")) return false;
          return true;
        });
      if (lines.length > 0) {
        return lines[0].slice(0, 72);
      }
    }

    return "";
  } catch (error) {
    console.error("Error calling complete:", error);
    return "";
  }
}

export default function sessionTitleExtension(pi: ExtensionAPI) {
  let titleSettled = false;
  let firstMessage: string | null = null;
  let sawInteractiveInput = false;
  let generateTitlePromise: Promise<void> | null = null;
  const config = createConfigFromEnv();
  const sessionNameApi = createSessionNameApi(pi);


  const maybeGenerateTitle = async (message: string, ctx: ExtensionContext): Promise<void> => {
    if (titleSettled) {
      return;
    }

    // Prevent concurrent generateTitle calls with a promise-based mutex
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

    const sessionId = ctx.sessionManager.getSessionId();
    const authRegistry = ctx.modelRegistry as ExtensionContext["modelRegistry"] & {
      getApiKey?: (model: CompletionModel, sessionId?: string) => Promise<string | undefined>;
    };
    const apiKey = typeof authRegistry.getApiKey === "function"
      ? await authRegistry.getApiKey(model, sessionId)
      : undefined;
    if (!apiKey) {
      return;
    }
    try {
      const cwd = ctx.cwd;
      const templatePath = await resolveTemplatePath(cwd, config.templatePath);
      let template = DEFAULT_TITLE_PROMPT;

      if (templatePath) {
        try {
          template = await loadTemplate(templatePath);
        } catch (error) {
          console.error(`Failed to load template from ${templatePath}, using default:`, error);
        }
      }

      // Wrap in promise so we can track it for mutex
      generateTitlePromise = (async () => {
        try {
          const title = await generateTitle({
            model,
            apiKey,
            headers: model.headers,
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

          const sanitizedTitle = sanitizeTitle(title);
          if (!sanitizedTitle) {
            titleSettled = true;
            return;
          }

          if (!sessionNameApi.get()) {
            await sessionNameApi.set(sanitizedTitle);
          }
          titleSettled = true;
        } finally {
          generateTitlePromise = null;
        }
      })();

      await generateTitlePromise;
    } catch (error) {
      console.error("Error in sessionTitleExtension:", error);
      // Do NOT set titleSettled = true here — allow retries on transient errors
    }
  };

  pi.on("input", async (event, ctx) => {
    if (event.source === "extension") {
      return { action: "continue" };
    }
    sawInteractiveInput = true;

    await maybeGenerateTitle(event.text, ctx);
    return { action: "continue" };
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (sawInteractiveInput) {
      return;
    }

    await maybeGenerateTitle(event.prompt, ctx);
  });

  pi.on("session_start", async () => {
    titleSettled = false;
    firstMessage = null;
    sawInteractiveInput = false;
  });
}
