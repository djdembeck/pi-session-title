import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { complete } from "@mariozechner/pi-ai";
import type { Api, Model } from "@mariozechner/pi-ai";
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
  model: Model<Api>;
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
  const response = await complete(
    model,
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

  return response.content
    .filter((content): content is { type: "text"; text: string } => content.type === "text")
    .map(content => content.text)
    .join("");
}

export default function sessionTitleExtension(pi: ExtensionAPI) {
  let titleSettled = false;
  let firstMessage: string | null = null;
  const config = createConfigFromEnv();
  const sessionNameApi = createSessionNameApi(pi);

  pi.on("input", async (event, ctx) => {
    if (titleSettled || event.source === "extension") {
      return { action: "continue" };
    }

    const existingName = sessionNameApi.get();
    if (existingName) {
      titleSettled = true;
      return { action: "continue" };
    }

    if (config.enabled === false || !sessionNameApi.available) {
      titleSettled = true;
      return { action: "continue" };
    }

    if (!isPromptTitleCandidate(event.text)) {
      return { action: "continue" };
    }

    if (!firstMessage) {
      firstMessage = event.text.trim();
    }

    const model = ctx.model;
    if (!model) {
      return { action: "continue" };
    }

    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok || !auth.apiKey) {
      return { action: "continue" };
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

      const title = await generateTitle({
        model,
        apiKey: auth.apiKey,
        headers: auth.headers,
        template,
        context: {
          firstMessage: firstMessage.slice(
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
        return { action: "continue" };
      }

      if (!sessionNameApi.get()) {
        await sessionNameApi.set(sanitizedTitle);
      }
      titleSettled = true;
    } catch (error) {
      console.error("Error in sessionTitleExtension:", error);
    }

    return { action: "continue" };
  });

  pi.on("session_start", async () => {
    titleSettled = false;
    firstMessage = null;
  });
}
