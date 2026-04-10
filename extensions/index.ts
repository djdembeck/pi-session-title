import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { complete } from "@mariozechner/pi-ai";
import type { Model, Api } from "@mariozechner/pi-ai";
import * as fs from "node:fs";
import * as path from "node:path";

const DEFAULT_TITLE_PROMPT = `Generate a concise title (max 6 words) for this coding session based on the first user message.

First message: {{firstMessage}}
Working directory: {{cwd}}

Respond with ONLY the title, no quotes or punctuation.`;

const DEFAULT_MAX_INPUT = 2000;
const DEFAULT_MAX_TOKENS = 30;

function validatePositiveInteger(value: unknown, defaultValue: number): number {
  return (Number.isFinite(value) && Number.isInteger(value) && (value as number > 0)) ? value as number : defaultValue;
}

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

function simpleTemplate(template: string, context: TemplateContext): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (key in context) {
      return context[key];
    }
    return match;
  });
}

const PROJECT_TEMPLATE_PATHS = [
  ".pi/prompts/title.md",
  ".omp/prompts/title.md",
];

const GLOBAL_TEMPLATE_PATHS = [
  (home: string) => path.join(home, ".pi", "agent", "prompts", "title.md"),
  (home: string) => path.join(home, ".omp", "agent", "prompts", "title.md"),
];

async function resolveTemplatePath(
  cwd: string,
  customPath?: string
): Promise<string | null> {
  const existsAsync = async (p: string): Promise<boolean> =>
    await fs.promises.access(p).then(() => true).catch(() => false);

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
  const content = await fs.promises.readFile(templatePath, "utf-8");
  return content;
}

function renderTemplate(
  template: string,
  context: { firstMessage: string; cwd: string; timestamp: string }
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
    }
  );

  const text = response.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map(c => c.text)
    .join("");

  return text;
}

export default function sessionTitleExtension(pi: ExtensionAPI) {
  // Instance-scoped state
  let titleSet = false;
  let firstMessage: string | null = null;

  // Read config from environment or use defaults
  const config: TitleConfig = {
    templatePath: process.env.PI_TITLE_TEMPLATE,
    maxInputLength: process.env.PI_TITLE_MAX_INPUT ? parseInt(process.env.PI_TITLE_MAX_INPUT, 10) : DEFAULT_MAX_INPUT,
    maxOutputTokens: process.env.PI_TITLE_MAX_TOKENS ? parseInt(process.env.PI_TITLE_MAX_TOKENS, 10) : DEFAULT_MAX_TOKENS,
    enabled: process.env.PI_TITLE_ENABLED !== "false",
  };

  // Capture the first user message via input event
  pi.on("input", async (event, ctx) => {
    // Skip if already processed or from extension
    if (titleSet || event.source === "extension") {
      return { action: "continue" };
    }

    // Store the first message
    if (!firstMessage && event.text.trim()) {
      firstMessage = event.text.trim();
    }

    return { action: "continue" };
  });

  // Generate title at turn_end (after first response completes)
  pi.on("turn_end", async (event, ctx) => {
    // Early exit: if session already has a name, skip title generation
    const existingName = pi.getSessionName();
    if (existingName) {
      titleSet = true;
      return;
    }

    // Skip if already set or no first message captured
    if (titleSet || !firstMessage) {
      return;
    }

    // Skip if disabled
    if (config.enabled === false) {
      return;
    }

    try {
      const maxInput = validatePositiveInteger(config.maxInputLength, DEFAULT_MAX_INPUT);
      const truncatedInput = firstMessage.slice(0, maxInput);

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

      const model = ctx.model;
      if (!model) {
        console.warn(`[session-title] No model available, skipping title generation`);
        return;
      }

      // Get API key for the model
      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
      if (!auth.ok || !auth.apiKey) {
        console.warn(`[session-title] No API key available for model, skipping title generation`);
        return;
      }

      const title = await generateTitle({
        model: model,
        apiKey: auth.apiKey,
        headers: auth.headers,
        template,
        context: {
          firstMessage: truncatedInput,
          cwd,
          timestamp: new Date().toISOString(),
        },
        maxTokens: validatePositiveInteger(config.maxOutputTokens, DEFAULT_MAX_TOKENS),
        signal: ctx.signal,
      });

      const sanitizedName = sanitizeTitle(title);
      if (sanitizedName) {
        // Check if session already has a name
        const currentName = pi.getSessionName();
        if (!currentName) {
          pi.setSessionName(sanitizedName);
          titleSet = true;
        }
      }
    } catch (error) {
      console.error('Error in sessionTitleExtension:', error);
    }
  });

  // Reset state on session start
  pi.on("session_start", async (event, ctx) => {
    titleSet = false;
    firstMessage = null;
  });
}
