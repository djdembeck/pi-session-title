import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { Model, Api } from "@mariozechner/pi-ai";
import * as fs from "node:fs";
import * as path from "node:path";
import sessionTitleExtension from "./index.js";

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    promises: {
      ...actual.promises,
      access: vi.fn(),
      readFile: vi.fn(),
    },
  };
});

vi.mock("@mariozechner/pi-ai", async () => {
  return {
    complete: vi.fn(),
  };
});

describe("sessionTitleExtension", () => {
  const originalEnv = { ...process.env };
  type InputHandler = (event: { text: string; source: string }, ctx: Partial<ExtensionContext>) => Promise<{ action: string }>;
  type SessionStartHandler = (event: { type: string; reason: string }, ctx: Partial<ExtensionContext>) => Promise<void>;
  type MockPi = ExtensionAPI & { 
    _handlers?: Record<string, InputHandler | SessionStartHandler>;
  };
  let mockPi: MockPi & {
    getSessionName: ReturnType<typeof vi.fn>;
    setSessionName: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = { ...originalEnv };

    mockPi = {
      on: vi.fn((event: string, handler: InputHandler | SessionStartHandler) => {
        if (!mockPi._handlers) {
          mockPi._handlers = {};
        }
        mockPi._handlers[event] = handler;
      }),
      getSessionName: vi.fn().mockReturnValue(undefined),
      setSessionName: vi.fn().mockResolvedValue(undefined),
      _handlers: {} as Record<string, InputHandler | SessionStartHandler>,
    } as unknown as MockPi & {
      getSessionName: ReturnType<typeof vi.fn>;
      setSessionName: ReturnType<typeof vi.fn>;
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  const createMockContext = (overrides?: Partial<ExtensionContext>): Partial<ExtensionContext> => ({
    cwd: process.cwd(),
    model: {
      id: "test-model",
      provider: "test-provider",
      name: "Test Model",
      api: "openai-completions" as Api,
      baseUrl: "https://api.test.com",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 4096,
      maxTokens: 1024,
    } as Model<Api>,
    modelRegistry: {
      getApiKeyAndHeaders: vi.fn().mockResolvedValue({
        ok: true,
        apiKey: "test-api-key",
        headers: {},
      }),
    } as unknown as ExtensionContext['modelRegistry'],
    signal: undefined,
    ...overrides,
  });

  describe("Template rendering", () => {
    it("should replace {{firstMessage}} in template", async () => {
      const fsMock = fs as unknown as {
        promises: {
          access: ReturnType<typeof vi.fn>;
          readFile: ReturnType<typeof vi.fn>;
        };
      };
      fsMock.promises.access.mockRejectedValue(new Error("File not found"));

      const { complete } = await import("@mariozechner/pi-ai");
      vi.mocked(complete).mockResolvedValue({
        content: [{ type: "text", text: "Test Title" }],
      } as unknown as Awaited<ReturnType<typeof complete>>);

      const ctx = createMockContext();

      sessionTitleExtension(mockPi as ExtensionAPI);

      const inputHandler = mockPi._handlers!['input'] as InputHandler;

      await inputHandler({ text: "Hello world", source: "user" }, ctx);

      expect(complete).toHaveBeenCalled();
      const callArgs = vi.mocked(complete).mock.calls[0];
      const messages = callArgs[1].messages as Array<{ content: Array<{ text: string }> }>;
      expect(messages[0].content[0].text).toContain("Hello world");
    });

    it("should replace {{cwd}} in template", async () => {
      const fsMock = fs as unknown as {
        promises: {
          access: ReturnType<typeof vi.fn>;
          readFile: ReturnType<typeof vi.fn>;
        };
      };
      fsMock.promises.access.mockRejectedValue(new Error("File not found"));

      const { complete } = await import("@mariozechner/pi-ai");
      vi.mocked(complete).mockResolvedValue({
        content: [{ type: "text", text: "Test Title" }],
      } as unknown as Awaited<ReturnType<typeof complete>>);

      const ctx = createMockContext();

      sessionTitleExtension(mockPi as ExtensionAPI);

      const inputHandler = mockPi._handlers!['input'] as InputHandler;

      await inputHandler({ text: "Test", source: "user" }, ctx);

      const callArgs = vi.mocked(complete).mock.calls[0];
      const messages = callArgs[1].messages as Array<{ content: Array<{ text: string }> }>;
      expect(messages[0].content[0].text).toContain(process.cwd());
    });

    it("should replace {{timestamp}} in custom template", async () => {
      const fsMock = fs as unknown as {
        promises: {
          access: ReturnType<typeof vi.fn>;
          readFile: ReturnType<typeof vi.fn>;
        };
      };
      fsMock.promises.access.mockResolvedValue(undefined);
      fsMock.promises.readFile.mockResolvedValue("Timestamp: {{timestamp}}");

      const { complete } = await import("@mariozechner/pi-ai");
      vi.mocked(complete).mockResolvedValue({
        content: [{ type: "text", text: "Test Title" }],
      } as unknown as Awaited<ReturnType<typeof complete>>);

      process.env.PI_TITLE_TEMPLATE = "./custom.md";

      const ctx = createMockContext();

      sessionTitleExtension(mockPi as ExtensionAPI);

      const inputHandler = mockPi._handlers!['input'] as InputHandler;

      await inputHandler({ text: "Test", source: "user" }, ctx);

      const callArgs = vi.mocked(complete).mock.calls[0];
      const messages = callArgs[1].messages as Array<{ content: Array<{ text: string }> }>;
      expect(messages[0].content[0].text).toMatch(/\d{4}-\d{2}-\d{2}T/);

      delete process.env.PI_TITLE_TEMPLATE;
    });
  });

  describe("Title sanitization", () => {
    it("should remove quotes from title", async () => {
      const fsMock = fs as unknown as {
        promises: {
          access: ReturnType<typeof vi.fn>;
          readFile: ReturnType<typeof vi.fn>;
        };
      };
      fsMock.promises.access.mockRejectedValue(new Error("File not found"));

      const { complete } = await import("@mariozechner/pi-ai");
      vi.mocked(complete).mockResolvedValue({
        content: [{ type: "text", text: '"Quoted Title"' }],
      } as unknown as Awaited<ReturnType<typeof complete>>);

      const ctx = createMockContext();

      sessionTitleExtension(mockPi as ExtensionAPI);

      const inputHandler = mockPi._handlers!['input'] as InputHandler;

      await inputHandler({ text: "Test", source: "user" }, ctx);

      expect(mockPi.setSessionName).toHaveBeenCalledWith("Quoted Title");
    });

    it("should trim title to 72 characters", async () => {
      const fsMock = fs as unknown as {
        promises: {
          access: ReturnType<typeof vi.fn>;
          readFile: ReturnType<typeof vi.fn>;
        };
      };
      fsMock.promises.access.mockRejectedValue(new Error("File not found"));

      const longTitle = "A".repeat(100);
      const { complete } = await import("@mariozechner/pi-ai");
      vi.mocked(complete).mockResolvedValue({
        content: [{ type: "text", text: longTitle }],
      } as unknown as Awaited<ReturnType<typeof complete>>);

      const ctx = createMockContext();

      sessionTitleExtension(mockPi as ExtensionAPI);

      const inputHandler = mockPi._handlers!['input'] as InputHandler;

      await inputHandler({ text: "Test", source: "user" }, ctx);

      expect(mockPi.setSessionName).toHaveBeenCalledWith("A".repeat(72));
    });

    it("should replace newlines with spaces", async () => {
      const fsMock = fs as unknown as {
        promises: {
          access: ReturnType<typeof vi.fn>;
          readFile: ReturnType<typeof vi.fn>;
        };
      };
      fsMock.promises.access.mockRejectedValue(new Error("File not found"));

      const { complete } = await import("@mariozechner/pi-ai");
      vi.mocked(complete).mockResolvedValue({
        content: [{ type: "text", text: "Line1\nLine2\n\nLine3" }],
      } as unknown as Awaited<ReturnType<typeof complete>>);

      const ctx = createMockContext();

      sessionTitleExtension(mockPi as ExtensionAPI);

      const inputHandler = mockPi._handlers!['input'] as InputHandler;

      await inputHandler({ text: "Test", source: "user" }, ctx);

      expect(mockPi.setSessionName).toHaveBeenCalledWith("Line1 Line2 Line3");
    });
  });

  describe("Error handling", () => {
    it("should skip when disabled via environment", async () => {
      process.env.PI_TITLE_ENABLED = "false";

      const ctx = createMockContext();

      sessionTitleExtension(mockPi as ExtensionAPI);

      const inputHandler = mockPi._handlers!['input'] as InputHandler;

      await inputHandler({ text: "Test", source: "user" }, ctx);

      expect(mockPi.setSessionName).not.toHaveBeenCalled();

      delete process.env.PI_TITLE_ENABLED;
    });

    it("should skip when model is not available", async () => {
      const fsMock = fs as unknown as {
        promises: {
          access: ReturnType<typeof vi.fn>;
          readFile: ReturnType<typeof vi.fn>;
        };
      };
      fsMock.promises.access.mockRejectedValue(new Error("File not found"));

      const ctx = createMockContext({ model: undefined });

      sessionTitleExtension(mockPi as ExtensionAPI);

      const inputHandler = mockPi._handlers!['input'] as InputHandler;

      await inputHandler({ text: "Test", source: "user" }, ctx);

      expect(mockPi.setSessionName).not.toHaveBeenCalled();
    });

    it("should skip on error", async () => {
      const fsMock = fs as unknown as {
        promises: {
          access: ReturnType<typeof vi.fn>;
          readFile: ReturnType<typeof vi.fn>;
        };
      };
      fsMock.promises.access.mockRejectedValue(new Error("Disk error"));

      const { complete } = await import("@mariozechner/pi-ai");
      vi.mocked(complete).mockRejectedValue(new Error("Model error"));

      const ctx = createMockContext();

      sessionTitleExtension(mockPi as ExtensionAPI);

      const inputHandler = mockPi._handlers!['input'] as InputHandler;

      await inputHandler({ text: "Test", source: "user" }, ctx);

      expect(mockPi.setSessionName).not.toHaveBeenCalled();
    });

    it("should skip when session already has a name", async () => {
      const fsMock = fs as unknown as {
        promises: {
          access: ReturnType<typeof vi.fn>;
          readFile: ReturnType<typeof vi.fn>;
        };
      };

      fsMock.promises.access.mockResolvedValueOnce(undefined);
      fsMock.promises.readFile.mockResolvedValueOnce("Generate title: {{firstMessage}}");

      const { complete } = await import("@mariozechner/pi-ai");
      vi.mocked(complete).mockResolvedValue({
        content: [{ type: "text", text: "My existing title" }],
      } as unknown as Awaited<ReturnType<typeof complete>>);

      // Mock session already has a name
      mockPi.getSessionName.mockReturnValue("Existing Session");

      const ctx = createMockContext();

      sessionTitleExtension(mockPi as ExtensionAPI);

      const inputHandler = mockPi._handlers!['input'] as InputHandler;

      await inputHandler({ text: "Test message", source: "user" }, ctx);

      // readFile should not have been called since session already has a name
      expect(fsMock.promises.readFile).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
      expect(mockPi.setSessionName).not.toHaveBeenCalled();
    });
  });

  describe("Input handling edge cases", () => {
    it("should skip when input is from extension", async () => {
      const ctx = createMockContext();

      sessionTitleExtension(mockPi as ExtensionAPI);

      const inputHandler = mockPi._handlers!['input'] as InputHandler;

      await inputHandler({ text: "Test message", source: "extension" }, ctx);

      expect(mockPi.setSessionName).not.toHaveBeenCalled();
    });

    it("should skip when input is empty/whitespace", async () => {
      const ctx = createMockContext();

      sessionTitleExtension(mockPi as ExtensionAPI);

      const inputHandler = mockPi._handlers!['input'] as InputHandler;

      await inputHandler({ text: "   ", source: "user" }, ctx);

      expect(mockPi.setSessionName).not.toHaveBeenCalled();
    });

    it("should skip slash commands", async () => {
      const { complete } = await import("@mariozechner/pi-ai");
      const ctx = createMockContext();

      sessionTitleExtension(mockPi as ExtensionAPI);

      const inputHandler = mockPi._handlers!["input"] as InputHandler;

      await inputHandler({ text: "/help", source: "interactive" }, ctx);

      expect(complete).not.toHaveBeenCalled();
      expect(mockPi.setSessionName).not.toHaveBeenCalled();
    });

    it("should skip bash commands", async () => {
      const { complete } = await import("@mariozechner/pi-ai");
      const ctx = createMockContext();

      sessionTitleExtension(mockPi as ExtensionAPI);

      const inputHandler = mockPi._handlers!["input"] as InputHandler;

      await inputHandler({ text: "!ls -la", source: "interactive" }, ctx);

      expect(complete).not.toHaveBeenCalled();
      expect(mockPi.setSessionName).not.toHaveBeenCalled();
    });

    it("should stop immediately when session name API is unavailable", async () => {
      const { complete } = await import("@mariozechner/pi-ai");
      const ctx = createMockContext();
      const handlers: Record<string, InputHandler | SessionStartHandler> = {};
      const piWithoutSessionNaming = {
        on: vi.fn((event: string, handler: InputHandler | SessionStartHandler) => {
          handlers[event] = handler;
        }),
      } as unknown as ExtensionAPI;

      sessionTitleExtension(piWithoutSessionNaming);

      const inputHandler = handlers["input"] as InputHandler;

      await inputHandler({ text: "Real prompt", source: "interactive" }, ctx);

      expect(complete).not.toHaveBeenCalled();
    });

    it("should not regenerate title if already generated", async () => {
      const fsMock = fs as unknown as {
        promises: {
          access: ReturnType<typeof vi.fn>;
          readFile: ReturnType<typeof vi.fn>;
        };
      };
      fsMock.promises.access.mockRejectedValue(new Error("File not found"));

      const { complete } = await import("@mariozechner/pi-ai");
      vi.mocked(complete).mockResolvedValue({
        content: [{ type: "text", text: "First Title" }],
      } as unknown as Awaited<ReturnType<typeof complete>>);

      const ctx = createMockContext();

      sessionTitleExtension(mockPi as ExtensionAPI);

      const inputHandler = mockPi._handlers!['input'] as InputHandler;

      // First input generates a title
      await inputHandler({ text: "First message", source: "user" }, ctx);
      expect(mockPi.setSessionName).toHaveBeenCalledWith("First Title");

      vi.mocked(complete).mockClear();

      // Second input should NOT generate another title
      await inputHandler({ text: "Second message", source: "user" }, ctx);
      expect(complete).not.toHaveBeenCalled();
    });
  });

  describe("Template discovery", () => {
    it("should use custom template when provided and exists", async () => {
      const fsMock = fs as unknown as {
        promises: {
          access: ReturnType<typeof vi.fn>;
          readFile: ReturnType<typeof vi.fn>;
        };
      };

      fsMock.promises.access.mockResolvedValueOnce(undefined);
      fsMock.promises.readFile.mockResolvedValueOnce("Custom template: {{firstMessage}}");

      const { complete } = await import("@mariozechner/pi-ai");
      vi.mocked(complete).mockResolvedValue({
        content: [{ type: "text", text: "Title" }],
      } as unknown as Awaited<ReturnType<typeof complete>>);

      process.env.PI_TITLE_TEMPLATE = "./custom.md";

      const ctx = createMockContext();

      sessionTitleExtension(mockPi as ExtensionAPI);

      const inputHandler = mockPi._handlers!['input'] as InputHandler;

      await inputHandler({ text: "Hello", source: "user" }, ctx);

      expect(fsMock.promises.readFile).toHaveBeenCalledWith(
        expect.stringContaining("custom.md"),
        "utf-8"
      );

      delete process.env.PI_TITLE_TEMPLATE;
    });

    it("should fall back to default when no templates found", async () => {
      const fsMock = fs as unknown as {
        promises: {
          access: ReturnType<typeof vi.fn>;
          readFile: ReturnType<typeof vi.fn>;
        };
      };
      fsMock.promises.access.mockRejectedValue(new Error("Not found"));

      const { complete } = await import("@mariozechner/pi-ai");
      vi.mocked(complete).mockResolvedValue({
        content: [{ type: "text", text: "Title" }],
      } as unknown as Awaited<ReturnType<typeof complete>>);

      const ctx = createMockContext();

      sessionTitleExtension(mockPi as ExtensionAPI);

      const inputHandler = mockPi._handlers!['input'] as InputHandler;

      await inputHandler({ text: "Hello world", source: "user" }, ctx);

      const callArgs = vi.mocked(complete).mock.calls[0];
      const messages = callArgs[1].messages as Array<{ content: Array<{ text: string }> }>;
      expect(messages[0].content[0].text).toContain("Generate a concise title");
      expect(messages[0].content[0].text).toContain("Hello world");
    });

    it("should check project templates before global", async () => {
      // Set deterministic HOME to ensure global template path is predictable
      process.env.HOME = "/mock/home";

      const fsMock = fs as unknown as {
        promises: {
          access: ReturnType<typeof vi.fn>;
          readFile: ReturnType<typeof vi.fn>;
        };
      };

      // Access fails for .pi project path, succeeds for .omp project path
      // This makes the test check the exact project path used
      fsMock.promises.access
        .mockRejectedValueOnce(new Error("Not found"))  // .pi/prompts/title.md in cwd - not found
        .mockResolvedValueOnce(undefined);                // .omp/prompts/title.md in cwd - found!
      fsMock.promises.readFile.mockResolvedValueOnce("Project template");

      const { complete } = await import("@mariozechner/pi-ai");
      vi.mocked(complete).mockResolvedValue({
        content: [{ type: "text", text: "Title" }],
      } as unknown as Awaited<ReturnType<typeof complete>>);

      const ctx = createMockContext();

      sessionTitleExtension(mockPi as ExtensionAPI);

      const inputHandler = mockPi._handlers!['input'] as InputHandler;

      await inputHandler({ text: "Test", source: "user" }, ctx);

      // Verify exact project template path was chosen
      const readFileCalls = fsMock.promises.readFile.mock.calls;
      expect(readFileCalls.length).toBeGreaterThan(0);
      const actualPath = readFileCalls[0][0] as string;
      const expectedProjectPath = path.join(ctx.cwd!, ".omp/prompts/title.md");
      expect(actualPath).toBe(expectedProjectPath);
    });
  });

  describe("Input truncation", () => {
    it("should truncate input to maxInputLength", async () => {
      const fsMock = fs as unknown as {
        promises: {
          access: ReturnType<typeof vi.fn>;
          readFile: ReturnType<typeof vi.fn>;
        };
      };
      fsMock.promises.access.mockRejectedValue(new Error("File not found"));

      const longMessage = "A".repeat(3000);
      let capturedPrompt = "";
      
      const { complete } = await import("@mariozechner/pi-ai");
      vi.mocked(complete).mockImplementation(async (_model, context) => {
        const ctx = context as { messages: Array<{ content: Array<{ text: string }> }> };
        capturedPrompt = ctx.messages[0].content[0].text;
        return { 
          role: "assistant",
          content: [{ type: "text", text: "Title" }],
          api: "openai-completions",
          provider: "test-provider",
          model: "test-model",
          timestamp: Date.now(),
          duration: 0,
        } as unknown as Awaited<ReturnType<typeof complete>>;
      });

      process.env.PI_TITLE_MAX_INPUT = "100";

      const ctx = createMockContext();

      sessionTitleExtension(mockPi as ExtensionAPI);

      const inputHandler = mockPi._handlers!['input'] as InputHandler;

      await inputHandler({ text: longMessage, source: "user" }, ctx);

      const firstMessageMatch = capturedPrompt.match(/First message: ([\s\S]+?)(?:\n|$)/);
      expect(firstMessageMatch).toBeTruthy();
      if (firstMessageMatch) {
        expect(firstMessageMatch[1].trim().length).toBeLessThanOrEqual(100);
      }

      delete process.env.PI_TITLE_MAX_INPUT;
    });
  });

  describe("Session reset", () => {
    it("should reset state on session_start", async () => {
      const fsMock = fs as unknown as {
        promises: {
          access: ReturnType<typeof vi.fn>;
          readFile: ReturnType<typeof vi.fn>;
        };
      };
      fsMock.promises.access.mockRejectedValue(new Error("File not found"));

      const { complete } = await import("@mariozechner/pi-ai");
      vi.mocked(complete).mockResolvedValue({
        content: [{ type: "text", text: "Test Title" }],
      } as unknown as Awaited<ReturnType<typeof complete>>);

      const ctx = createMockContext();

      sessionTitleExtension(mockPi as ExtensionAPI);

      const inputHandler = mockPi._handlers!['input'] as InputHandler;
      const sessionStartHandler = mockPi._handlers!['session_start'] as SessionStartHandler;

      // First session: generate a title
      await inputHandler({ text: "First session message", source: "user" }, ctx);
      expect(mockPi.setSessionName).toHaveBeenCalledWith("Test Title");

      // Simulate session end and new session start
      await sessionStartHandler({ type: "session_start", reason: "new" }, ctx);
      
      vi.mocked(complete).mockClear();
      vi.mocked(mockPi.setSessionName).mockClear();

      // Second session: should generate a new title
      await inputHandler({ text: "Second session message", source: "user" }, ctx);
      expect(complete).toHaveBeenCalled();
    });
  });
});