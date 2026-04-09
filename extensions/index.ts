import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
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
  modelId?: string;
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
  if (customPath) {
    const absolutePath = path.isAbsolute(customPath)
      ? customPath
      : path.join(cwd, customPath);

    if (fs.existsSync(absolutePath)) {
      return absolutePath;
    }
    return null;
  }

  for (const relativePath of PROJECT_TEMPLATE_PATHS) {
    const fullPath = path.join(cwd, relativePath);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }

  const home = process.env.HOME || process.env.USERPROFILE;
  if (home) {
    for (const getPath of GLOBAL_TEMPLATE_PATHS) {
      const fullPath = getPath(home);
      if (fs.existsSync(fullPath)) {
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
  model: {
    completeSimple(prompt: string, options?: {
      maxTokens?: number;
      signal?: AbortSignal;
    }): Promise<string>;
  };
  template: string;
  context: {
    firstMessage: string;
    cwd: string;
    timestamp: string;
  };
  maxTokens: number;
  signal?: AbortSignal;
}): Promise<string> {
  const { model, template, context, maxTokens, signal } = options;

  const prompt = renderTemplate(template, context);

  const response = await model.completeSimple(prompt, {
    maxTokens,
    signal,
  });

  return response;
}

type AutoNameEvent = {
  firstUserMessage: string;
};

type AutoNameResult = { name: string } | { cancel: boolean };

export default function sessionTitleExtension(pi: ExtensionAPI) {
  const config = (pi as unknown as { config: TitleConfig }).config || {} as TitleConfig;
  const cwd = process.cwd();
  const signal = undefined as AbortSignal | undefined;

  const typedOn = pi.on as unknown as (
    event: string,
    handler: (event: AutoNameEvent) => Promise<AutoNameResult>
  ) => void;

  typedOn("session_before_auto_name", async (event) => {
    if (config.enabled === false) {
      return { cancel: true };
    }

    try {
      const maxInput = config.maxInputLength || DEFAULT_MAX_INPUT;
      const truncatedInput = event.firstUserMessage.slice(0, maxInput);

      const templatePath = await resolveTemplatePath(cwd, config.templatePath);
      const template = templatePath
        ? await loadTemplate(templatePath)
        : DEFAULT_TITLE_PROMPT;

      const model = (pi as unknown as { model: { completeSimple: (...args: unknown[]) => Promise<string> } | undefined }).model;

      if (!model) {
        return { cancel: true };
      }

      const title = await generateTitle({
        model,
        template,
        context: {
          firstMessage: truncatedInput,
          cwd,
          timestamp: new Date().toISOString(),
        },
        maxTokens: config.maxOutputTokens || DEFAULT_MAX_TOKENS,
        signal,
      });

      return { name: sanitizeTitle(title) };
    } catch (error) {
      return { cancel: true };
    }
  });
}
