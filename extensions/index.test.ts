import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { Model, Api } from "@mariozechner/pi-ai";
import * as fs from "node:fs";
import sessionTitleExtension, { resetState } from "./index.js";

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
  type TurnEndHandler = (event: { turnIndex: number; message: unknown; toolResults: unknown[] }, ctx: Partial<ExtensionContext>) => Promise<void>;
  type SessionStartHandler = (event: { type: string; reason: string }, ctx: Partial<ExtensionContext>) => Promise<void>;
  type MockPi = ExtensionAPI & { 
    _handlers?: Record<string, InputHandler | TurnEndHandler | SessionStartHandler>;
  };
  let mockPi: MockPi;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = { ...originalEnv };
    resetState();

    mockPi = {
      on: vi.fn((event: string, handler: InputHandler | TurnEndHandler | SessionStartHandler) => {
        if (!mockPi._handlers) {
          mockPi._handlers = {};
        }
        mockPi._handlers[event] = handler;
      }),
      getSessionName: vi.fn().mockReturnValue(undefined),
      setSessionName: vi.fn(),
      _handlers: {} as Record<string, InputHandler | TurnEndHandler | SessionStartHandler>,
    } as unknown as MockPi;
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
      const turnEndHandler = mockPi._handlers!['turn_end'] as TurnEndHandler;

      await inputHandler({ text: "Hello world", source: "user" }, ctx);
      await turnEndHandler({ turnIndex: 0, message: {}, toolResults: [] }, ctx);

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
      const turnEndHandler = mockPi._handlers!['turn_end'] as TurnEndHandler;

      await inputHandler({ text: "Test", source: "user" }, ctx);
      await turnEndHandler({ turnIndex: 0, message: {}, toolResults: [] }, ctx);

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
      const turnEndHandler = mockPi._handlers!['turn_end'] as TurnEndHandler;

      await inputHandler({ text: "Test", source: "user" }, ctx);
      await turnEndHandler({ turnIndex: 0, message: {}, toolResults: [] }, ctx);

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
      const turnEndHandler = mockPi._handlers!['turn_end'] as TurnEndHandler;

      await inputHandler({ text: "Test", source: "user" }, ctx);
      await turnEndHandler({ turnIndex: 0, message: {}, toolResults: [] }, ctx);

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
      const turnEndHandler = mockPi._handlers!['turn_end'] as TurnEndHandler;

      await inputHandler({ text: "Test", source: "user" }, ctx);
      await turnEndHandler({ turnIndex: 0, message: {}, toolResults: [] }, ctx);

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
      const turnEndHandler = mockPi._handlers!['turn_end'] as TurnEndHandler;

      await inputHandler({ text: "Test", source: "user" }, ctx);
      await turnEndHandler({ turnIndex: 0, message: {}, toolResults: [] }, ctx);

      expect(mockPi.setSessionName).toHaveBeenCalledWith("Line1 Line2 Line3");
    });
  });

  describe("Error handling", () => {
    it("should skip when disabled via environment", async () => {
      process.env.PI_TITLE_ENABLED = "false";

      const ctx = createMockContext();

      sessionTitleExtension(mockPi as ExtensionAPI);

      const inputHandler = mockPi._handlers!['input'] as InputHandler;
      const turnEndHandler = mockPi._handlers!['turn_end'] as TurnEndHandler;

      await inputHandler({ text: "Test", source: "user" }, ctx);
      await turnEndHandler({ turnIndex: 0, message: {}, toolResults: [] }, ctx);

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
      const turnEndHandler = mockPi._handlers!['turn_end'] as TurnEndHandler;

      await inputHandler({ text: "Test", source: "user" }, ctx);
      await turnEndHandler({ turnIndex: 0, message: {}, toolResults: [] }, ctx);

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
      const turnEndHandler = mockPi._handlers!['turn_end'] as TurnEndHandler;

      await inputHandler({ text: "Test", source: "user" }, ctx);
      await turnEndHandler({ turnIndex: 0, message: {}, toolResults: [] }, ctx);

      expect(mockPi.setSessionName).not.toHaveBeenCalled();
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
      const turnEndHandler = mockPi._handlers!['turn_end'] as TurnEndHandler;

      await inputHandler({ text: "Hello", source: "user" }, ctx);
      await turnEndHandler({ turnIndex: 0, message: {}, toolResults: [] }, ctx);

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
      const turnEndHandler = mockPi._handlers!['turn_end'] as TurnEndHandler;

      await inputHandler({ text: "Hello world", source: "user" }, ctx);
      await turnEndHandler({ turnIndex: 0, message: {}, toolResults: [] }, ctx);

      const callArgs = vi.mocked(complete).mock.calls[0];
      const messages = callArgs[1].messages as Array<{ content: Array<{ text: string }> }>;
      expect(messages[0].content[0].text).toContain("Generate a concise title");
      expect(messages[0].content[0].text).toContain("Hello world");
    });

    it("should check project templates before global", async () => {
      const fsMock = fs as unknown as {
        promises: {
          access: ReturnType<typeof vi.fn>;
          readFile: ReturnType<typeof vi.fn>;
        };
      };

      fsMock.promises.access
        .mockRejectedValueOnce(new Error("Not found"))
        .mockResolvedValueOnce(undefined);
      fsMock.promises.readFile.mockResolvedValueOnce("Project template");

      const { complete } = await import("@mariozechner/pi-ai");
      vi.mocked(complete).mockResolvedValue({
        content: [{ type: "text", text: "Title" }],
      } as unknown as Awaited<ReturnType<typeof complete>>);

      const ctx = createMockContext();

      sessionTitleExtension(mockPi as ExtensionAPI);

      const inputHandler = mockPi._handlers!['input'] as InputHandler;
      const turnEndHandler = mockPi._handlers!['turn_end'] as TurnEndHandler;

      await inputHandler({ text: "Test", source: "user" }, ctx);
      await turnEndHandler({ turnIndex: 0, message: {}, toolResults: [] }, ctx);

      const readFileCalls = fsMock.promises.readFile.mock.calls;
      expect(readFileCalls.length).toBeGreaterThan(0);
      const pathArg = readFileCalls[0][0] as string;
      expect(pathArg.includes(".pi") || pathArg.includes(".omp")).toBe(true);
    });
  });

  describe("Input handling", () => {
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
      const turnEndHandler = mockPi._handlers!['turn_end'] as TurnEndHandler;

      await inputHandler({ text: longMessage, source: "user" }, ctx);
      await turnEndHandler({ turnIndex: 0, message: {}, toolResults: [] }, ctx);

      const firstMessageMatch = capturedPrompt.match(/First message: ([\s\S]+?)(?:\n|$)/);
      expect(firstMessageMatch).toBeTruthy();
      if (firstMessageMatch) {
        expect(firstMessageMatch[1].trim().length).toBeLessThanOrEqual(100);
      }

      delete process.env.PI_TITLE_MAX_INPUT;
    });
  });
});
