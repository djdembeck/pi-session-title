import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { complete as completeFn } from "@oh-my-pi/pi-ai";
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

vi.mock("@oh-my-pi/pi-ai", async () => {
  return {
    complete: vi.fn(),
  };
});

describe("sessionTitleExtension", () => {
  const originalEnv = { ...process.env };
  type InputHandler = (event: { text: string; source: string }, ctx: Partial<ExtensionContext>) => Promise<{ action: string }>;
  type SessionStartHandler = (event: { type: string; reason: string }, ctx: Partial<ExtensionContext>) => Promise<void>;
  type BeforeAgentStartHandler = (
    event: { type: string; prompt: string; systemPrompt: string; images?: unknown[] },
    ctx: Partial<ExtensionContext>,
  ) => Promise<void>;
  type MockHandler = InputHandler | SessionStartHandler | BeforeAgentStartHandler;
  type MockPi = ExtensionAPI & {
    _handlers?: Record<string, MockHandler>;
    pi?: { complete: any };
  };
  let mockPi: MockPi & {
    getSessionName: ReturnType<typeof vi.fn>;
    setSessionName: ReturnType<typeof vi.fn>;
    pi: { complete: any };
  };

  beforeEach(async () => {
    vi.resetAllMocks();
    process.env = { ...originalEnv };

    mockPi = {
      on: vi.fn((event: string, handler: MockHandler) => {
        if (!mockPi._handlers) {
          mockPi._handlers = {};
        }
        mockPi._handlers[event] = handler;
      }),
      getSessionName: vi.fn().mockReturnValue(undefined),
      setSessionName: vi.fn().mockResolvedValue(undefined),
      _handlers: {} as Record<string, MockHandler>,
      pi: {
        complete: vi.fn(),
      },
    } as unknown as MockPi & {
      getSessionName: ReturnType<typeof vi.fn>;
      setSessionName: ReturnType<typeof vi.fn>;
      pi: { complete: any };
    };

    // Import the mocked module and link it to mockPi.pi.complete
    const { complete } = await import("@oh-my-pi/pi-ai");
    vi.mocked(complete).mockImplementation((...args: unknown[]) => mockPi.pi.complete(...args as Parameters<typeof mockPi.pi.complete>));
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  const createMockContext = (overrides?: Partial<ExtensionContext>): Partial<ExtensionContext> => ({
    cwd: process.cwd(),
    sessionManager: {
      getSessionId: vi.fn().mockReturnValue("test-session-id"),
    } as unknown as ExtensionContext["sessionManager"],
    model: {
      id: "test-model",
      provider: "test-provider",
      name: "Test Model",
      api: "openai-completions" as never,
      baseUrl: "https://api.test.com",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 4096,
      maxTokens: 1024,
      headers: { "X-Test-Header": "test-value" },
    } as NonNullable<ExtensionContext["model"]>,
    modelRegistry: {
      getApiKey: vi.fn().mockResolvedValue("test-api-key"),
    } as unknown as ExtensionContext["modelRegistry"],
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

      vi.mocked(mockPi.pi.complete).mockResolvedValue({
        content: [{ type: "text", text: "Test Title" }],
      } as unknown as Awaited<ReturnType<typeof mockPi.pi.complete>>);

      const ctx = createMockContext();

      sessionTitleExtension(mockPi as ExtensionAPI);

      const inputHandler = mockPi._handlers!["input"] as InputHandler;

      await inputHandler({ text: "Hello world", source: "user" }, ctx);

      expect(mockPi.pi.complete).toHaveBeenCalled();
      const callArgs = vi.mocked(mockPi.pi.complete).mock.calls[0];
      const messages = callArgs[1].messages as Array<{ content: Array<{ text: string }> }>;
      expect(messages[0].content[0].text).toContain("Hello world");
    });

    it("should resolve API key with session id and pass model headers", async () => {
      const fsMock = fs as unknown as {
        promises: {
          access: ReturnType<typeof vi.fn>;
          readFile: ReturnType<typeof vi.fn>;
        };
      };
      fsMock.promises.access.mockRejectedValue(new Error("File not found"));

      vi.mocked(mockPi.pi.complete).mockResolvedValue({
        content: [{ type: "text", text: "Header Title" }],
      } as unknown as Awaited<ReturnType<typeof mockPi.pi.complete>>);

      const ctx = createMockContext({
        model: {
          ...createMockContext().model!,
          headers: { "X-Test-Header": "test-value" },
        } as NonNullable<ExtensionContext["model"]>,
      });

      sessionTitleExtension(mockPi as ExtensionAPI);

      const inputHandler = mockPi._handlers!["input"] as InputHandler;
      await inputHandler({ text: "Header test", source: "user" }, ctx);

      const getApiKey = (ctx.modelRegistry as unknown as { getApiKey: ReturnType<typeof vi.fn> }).getApiKey;
      expect(getApiKey).toHaveBeenCalledWith(ctx.model, "test-session-id");
      const completeOptions = vi.mocked(mockPi.pi.complete).mock.calls[0][2] as {
        apiKey: string;
        headers?: Record<string, string>;
      };
      expect(completeOptions).toMatchObject({
        apiKey: "test-api-key",
        headers: { "X-Test-Header": "test-value" },
      });
    });

    it("should replace {{cwd}} in template", async () => {
      const fsMock = fs as unknown as {
        promises: {
          access: ReturnType<typeof vi.fn>;
          readFile: ReturnType<typeof vi.fn>;
        };
      };
      fsMock.promises.access.mockRejectedValue(new Error("File not found"));

      vi.mocked(mockPi.pi.complete).mockResolvedValue({
        content: [{ type: "text", text: "Test Title" }],
      } as unknown as Awaited<ReturnType<typeof mockPi.pi.complete>>);

      const ctx = createMockContext();

      sessionTitleExtension(mockPi as ExtensionAPI);

      const inputHandler = mockPi._handlers!["input"] as InputHandler;

      await inputHandler({ text: "Test", source: "user" }, ctx);

      const callArgs = vi.mocked(mockPi.pi.complete).mock.calls[0];
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

      vi.mocked(mockPi.pi.complete).mockResolvedValue({
        content: [{ type: "text", text: "Test Title" }],
      } as unknown as Awaited<ReturnType<typeof mockPi.pi.complete>>);

      process.env.PI_TITLE_TEMPLATE = "./custom.md";

      const ctx = createMockContext();

      sessionTitleExtension(mockPi as ExtensionAPI);

      const inputHandler = mockPi._handlers!["input"] as InputHandler;

      await inputHandler({ text: "Test", source: "user" }, ctx);

      const callArgs = vi.mocked(mockPi.pi.complete).mock.calls[0];
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

      vi.mocked(mockPi.pi.complete).mockResolvedValue({
        content: [{ type: "text", text: '"Quoted Title"' }],
      } as unknown as Awaited<ReturnType<typeof mockPi.pi.complete>>);

      const ctx = createMockContext();

      sessionTitleExtension(mockPi as ExtensionAPI);

      const inputHandler = mockPi._handlers!["input"] as InputHandler;

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
      vi.mocked(mockPi.pi.complete).mockResolvedValue({
        content: [{ type: "text", text: longTitle }],
      } as unknown as Awaited<ReturnType<typeof mockPi.pi.complete>>);

      const ctx = createMockContext();

      sessionTitleExtension(mockPi as ExtensionAPI);

      const inputHandler = mockPi._handlers!["input"] as InputHandler;

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

      vi.mocked(mockPi.pi.complete).mockResolvedValue({
        content: [{ type: "text", text: "Line1\nLine2\n\nLine3" }],
      } as unknown as Awaited<ReturnType<typeof mockPi.pi.complete>>);

      const ctx = createMockContext();

      sessionTitleExtension(mockPi as ExtensionAPI);

      const inputHandler = mockPi._handlers!["input"] as InputHandler;

      await inputHandler({ text: "Test", source: "user" }, ctx);

      expect(mockPi.setSessionName).toHaveBeenCalledWith("Line1 Line2 Line3");
    });
  });

  describe("Error handling", () => {
    it("should skip when disabled via environment", async () => {
      process.env.PI_TITLE_ENABLED = "false";

      const ctx = createMockContext();

      sessionTitleExtension(mockPi as ExtensionAPI);

      const inputHandler = mockPi._handlers!["input"] as InputHandler;

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

      const inputHandler = mockPi._handlers!["input"] as InputHandler;

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

      vi.mocked(mockPi.pi.complete).mockRejectedValue(new Error("Model error"));

      const ctx = createMockContext();

      sessionTitleExtension(mockPi as ExtensionAPI);

      const inputHandler = mockPi._handlers!["input"] as InputHandler;

      await inputHandler({ text: "Test", source: "user" }, ctx);

      // Should not crash, should silently skip
      expect(mockPi.setSessionName).not.toHaveBeenCalled();
    });

    it("should skip if session already has a name", async () => {
      const fsMock = fs as unknown as {
        promises: {
          access: ReturnType<typeof vi.fn>;
          readFile: ReturnType<typeof vi.fn>;
        };
      };
      fsMock.promises.access.mockResolvedValueOnce(undefined);
      fsMock.promises.readFile.mockResolvedValueOnce("Custom template: {{firstMessage}}");

      vi.mocked(mockPi.pi.complete).mockResolvedValue({
        content: [{ type: "text", text: "My existing title" }],
      } as unknown as Awaited<ReturnType<typeof mockPi.pi.complete>>);

      // Mock session already has a name
      mockPi.getSessionName.mockReturnValue("Existing Session");

      process.env.PI_TITLE_TEMPLATE = "./custom.md";

      const ctx = createMockContext();

      sessionTitleExtension(mockPi as ExtensionAPI);

      const inputHandler = mockPi._handlers!["input"] as InputHandler;

      await inputHandler({ text: "Test", source: "user" }, ctx);

      // readFile should not have been called since session already has a name
      expect(fsMock.promises.readFile).not.toHaveBeenCalled();
      expect(mockPi.pi.complete).not.toHaveBeenCalled();
      expect(mockPi.setSessionName).not.toHaveBeenCalled();
    });
  });

  describe("Input handling edge cases", () => {
    it("should skip empty input", async () => {
      const fsMock = fs as unknown as {
        promises: {
          access: ReturnType<typeof vi.fn>;
          readFile: ReturnType<typeof vi.fn>;
        };
      };
      fsMock.promises.access.mockRejectedValue(new Error("File not found"));

      vi.mocked(mockPi.pi.complete).mockResolvedValue({
        content: [{ type: "text", text: "Test Title" }],
      } as unknown as Awaited<ReturnType<typeof mockPi.pi.complete>>);

      const ctx = createMockContext();

      sessionTitleExtension(mockPi as ExtensionAPI);

      const inputHandler = mockPi._handlers!["input"] as InputHandler;

      await inputHandler({ text: "   ", source: "user" }, ctx);

      expect(mockPi.setSessionName).not.toHaveBeenCalled();
    });

    it("should skip slash commands", async () => {
      const ctx = createMockContext();

      sessionTitleExtension(mockPi as ExtensionAPI);

      const inputHandler = mockPi._handlers!["input"] as InputHandler;

      await inputHandler({ text: "/help", source: "interactive" }, ctx);

      expect(mockPi.pi.complete).not.toHaveBeenCalled();
      expect(mockPi.setSessionName).not.toHaveBeenCalled();
    });

    it("should skip bash commands", async () => {
      const ctx = createMockContext();

      sessionTitleExtension(mockPi as ExtensionAPI);

      const inputHandler = mockPi._handlers!["input"] as InputHandler;

      await inputHandler({ text: "!ls -la", source: "interactive" }, ctx);

      expect(mockPi.pi.complete).not.toHaveBeenCalled();
      expect(mockPi.setSessionName).not.toHaveBeenCalled();
    });

    it("should stop immediately when session name API is unavailable", async () => {
      const ctx = createMockContext();
      const handlers: Record<string, MockHandler> = {};
      const piWithoutSessionNaming = {
        on: vi.fn((event: string, handler: MockHandler) => {
          handlers[event] = handler;
        }),
      } as unknown as ExtensionAPI;

      sessionTitleExtension(piWithoutSessionNaming);

      const inputHandler = handlers["input"] as InputHandler;

      await inputHandler({ text: "Real prompt", source: "interactive" }, ctx);

      expect(mockPi.pi.complete).not.toHaveBeenCalled();
    });

    it("should not regenerate title if already generated", async () => {
      const fsMock = fs as unknown as {
        promises: {
          access: ReturnType<typeof vi.fn>;
          readFile: ReturnType<typeof vi.fn>;
        };
      };
      fsMock.promises.access.mockRejectedValue(new Error("File not found"));

      vi.mocked(mockPi.pi.complete).mockResolvedValue({
        content: [{ type: "text", text: "First Title" }],
      } as unknown as Awaited<ReturnType<typeof mockPi.pi.complete>>);

      const ctx = createMockContext();

      sessionTitleExtension(mockPi as ExtensionAPI);

      const inputHandler = mockPi._handlers!["input"] as InputHandler;

      await inputHandler({ text: "First message", source: "user" }, ctx);
      expect(mockPi.setSessionName).toHaveBeenCalledWith("First Title");

      vi.mocked(mockPi.pi.complete).mockClear();

      // Second input should NOT generate another title
      await inputHandler({ text: "Second message", source: "user" }, ctx);
      expect(mockPi.pi.complete).not.toHaveBeenCalled();
    });
  });

  describe("Template discovery", () => {
    it("should use custom template from environment variable", async () => {
      const fsMock = fs as unknown as {
        promises: {
          access: ReturnType<typeof vi.fn>;
          readFile: ReturnType<typeof vi.fn>;
        };
      };
      fsMock.promises.access.mockResolvedValueOnce(undefined);
      fsMock.promises.readFile.mockResolvedValueOnce("Custom template: {{firstMessage}}");

      vi.mocked(mockPi.pi.complete).mockResolvedValue({
        content: [{ type: "text", text: "Title" }],
      } as unknown as Awaited<ReturnType<typeof mockPi.pi.complete>>);

      process.env.PI_TITLE_TEMPLATE = "./custom.md";

      const ctx = createMockContext();

      sessionTitleExtension(mockPi as ExtensionAPI);

      const inputHandler = mockPi._handlers!["input"] as InputHandler;

      await inputHandler({ text: "Hello world", source: "user" }, ctx);

      expect(fsMock.promises.readFile).toHaveBeenCalledWith(
        expect.stringContaining("custom.md"),
        "utf-8",
      );

      delete process.env.PI_TITLE_TEMPLATE;
    });

    it("should use default template when no custom template found", async () => {
      const fsMock = fs as unknown as {
        promises: {
          access: ReturnType<typeof vi.fn>;
          readFile: ReturnType<typeof vi.fn>;
        };
      };
      fsMock.promises.access.mockRejectedValue(new Error("File not found"));

      vi.mocked(mockPi.pi.complete).mockResolvedValue({
        content: [{ type: "text", text: "Title" }],
      } as unknown as Awaited<ReturnType<typeof mockPi.pi.complete>>);

      const ctx = createMockContext();

      sessionTitleExtension(mockPi as ExtensionAPI);

      const inputHandler = mockPi._handlers!["input"] as InputHandler;

      await inputHandler({ text: "Hello world", source: "user" }, ctx);

      const callArgs = vi.mocked(mockPi.pi.complete).mock.calls[0];
      const messages = callArgs[1].messages as Array<{ content: Array<{ text: string }> }>;
      expect(messages[0].content[0].text).toContain("Generate a concise title");
      expect(messages[0].content[0].text).toContain("Hello world");
    });

    it("should find project template in .omp directory", async () => {
      const fsMock = fs as unknown as {
        promises: {
          access: ReturnType<typeof vi.fn>;
          readFile: ReturnType<typeof vi.fn>;
        };
      };
      fsMock.promises.access
        .mockRejectedValueOnce(new Error("Not found"))                  // .pi/prompts/title.md in cwd - not found
        .mockResolvedValueOnce(undefined);                // .omp/prompts/title.md in cwd - found!
      fsMock.promises.readFile.mockResolvedValueOnce("Project template");

      vi.mocked(mockPi.pi.complete).mockResolvedValue({
        content: [{ type: "text", text: "Title" }],
      } as unknown as Awaited<ReturnType<typeof mockPi.pi.complete>>);

      const ctx = createMockContext();

      sessionTitleExtension(mockPi as ExtensionAPI);

      const inputHandler = mockPi._handlers!["input"] as InputHandler;

      await inputHandler({ text: "Hello world", source: "user" }, ctx);

      expect(fsMock.promises.readFile).toHaveBeenCalledWith(
        expect.stringContaining(".omp/prompts/title.md"),
        "utf-8",
      );
    });
  });

  describe("Input truncation", () => {
    it("should truncate long first messages to configured length", async () => {
      const fsMock = fs as unknown as {
        promises: {
          access: ReturnType<typeof vi.fn>;
          readFile: ReturnType<typeof vi.fn>;
        };
      };
      fsMock.promises.access.mockRejectedValue(new Error("File not found"));

      const longMessage = "A".repeat(3000);
      let capturedPrompt = "";

      vi.mocked(mockPi.pi.complete).mockImplementation(async (_model: any, context: any) => {
        const ctx = context as { messages: Array<{ content: Array<{ text: string }> }> };
        capturedPrompt = ctx.messages[0].content[0].text;
        return {
          content: [{ type: "text", text: "Test Title" }],
          usage: { inputTokens: 0, outputTokens: 0 },
          model: "test-model",
          timestamp: Date.now(),
          duration: 0,
        } as unknown as Awaited<ReturnType<typeof mockPi.pi.complete>>;
      });
      process.env.PI_TITLE_MAX_INPUT = "100";

      const ctx = createMockContext();

      sessionTitleExtension(mockPi as ExtensionAPI);

      const inputHandler = mockPi._handlers!["input"] as InputHandler;

      await inputHandler({ text: longMessage, source: "user" }, ctx);

      // The firstMessage placeholder should be truncated
      expect(capturedPrompt.length).toBeLessThan(longMessage.length);
      expect(capturedPrompt).toContain("A".repeat(100));
      expect(capturedPrompt).not.toContain("A".repeat(101));

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

      vi.mocked(mockPi.pi.complete).mockResolvedValue({
        content: [{ type: "text", text: "Test Title" }],
      } as unknown as Awaited<ReturnType<typeof mockPi.pi.complete>>);

      const ctx = createMockContext();

      sessionTitleExtension(mockPi as ExtensionAPI);

      const inputHandler = mockPi._handlers!["input"] as InputHandler;
      const sessionStartHandler = mockPi._handlers!["session_start"] as SessionStartHandler;

      // First session: generate a title
      await inputHandler({ text: "First session message", source: "user" }, ctx);
      expect(mockPi.setSessionName).toHaveBeenCalledWith("Test Title");

      // Simulate session end and new session start
      await sessionStartHandler({ type: "session_start", reason: "new" }, ctx);

      vi.mocked(mockPi.pi.complete).mockClear();
      vi.mocked(mockPi.setSessionName).mockClear();

      // Second session: should generate a new title
      await inputHandler({ text: "Second session message", source: "user" }, ctx);
      expect(mockPi.pi.complete).toHaveBeenCalled();
    });

    it("should not apply stale title when in-flight generation resolves after session reset", async () => {
      const fsMock = fs as unknown as {
        promises: {
          access: ReturnType<typeof vi.fn>;
          readFile: ReturnType<typeof vi.fn>;
        };
      };
      fsMock.promises.access.mockRejectedValue(new Error("File not found"));

      // Create a deferred promise we can resolve later
      let resolveComplete: (value: unknown) => void;
      const completePromise = new Promise((resolve) => {
        resolveComplete = resolve;
      });
      vi.mocked(mockPi.pi.complete).mockReturnValue(completePromise as Promise<unknown>);

      const ctx = createMockContext();

      sessionTitleExtension(mockPi as ExtensionAPI);

      const inputHandler = mockPi._handlers!["input"] as InputHandler;
      const sessionStartHandler = mockPi._handlers!["session_start"] as SessionStartHandler;

      // Trigger title generation but don't await it
      const inputPromise = inputHandler({ text: "First session", source: "user" }, ctx);

      // Immediately trigger session reset before completion resolves
      await sessionStartHandler({ type: "session_start", reason: "new" }, ctx);

      // Now resolve the in-flight completion
      resolveComplete!({
        content: [{ type: "text", text: "Stale Title" }],
      });

      // Await the original input handler promise
      await inputPromise;

      // setSessionName should NOT have been called with the stale title
      expect(mockPi.setSessionName).not.toHaveBeenCalled();
    });
  });

  describe("Non-interactive fallback", () => {
    it("should generate a title from before_agent_start when input never fires", async () => {
      const fsMock = fs as unknown as {
        promises: {
          access: ReturnType<typeof vi.fn>;
          readFile: ReturnType<typeof vi.fn>;
        };
      };
      fsMock.promises.access.mockRejectedValue(new Error("File not found"));

      vi.mocked(mockPi.pi.complete).mockResolvedValue({
        content: [{ type: "text", text: "Print Title" }],
      } as unknown as Awaited<ReturnType<typeof mockPi.pi.complete>>);

      const ctx = createMockContext();

      sessionTitleExtension(mockPi as ExtensionAPI);

      const beforeAgentStartHandler = mockPi._handlers!["before_agent_start"] as BeforeAgentStartHandler;

      await beforeAgentStartHandler(
        { type: "before_agent_start", prompt: "Print mode prompt", systemPrompt: "", images: undefined },
        ctx,
      );

      expect(mockPi.pi.complete).toHaveBeenCalled();
      expect(mockPi.setSessionName).toHaveBeenCalledWith("Print Title");
    });

    it("should ignore before_agent_start after interactive input already ran", async () => {
      const fsMock = fs as unknown as {
        promises: {
          access: ReturnType<typeof vi.fn>;
          readFile: ReturnType<typeof vi.fn>;
        };
      };
      fsMock.promises.access.mockRejectedValue(new Error("File not found"));

      vi.mocked(mockPi.pi.complete).mockResolvedValue({
        content: [{ type: "text", text: "Interactive Title" }],
      } as unknown as Awaited<ReturnType<typeof mockPi.pi.complete>>);

      const ctx = createMockContext();

      sessionTitleExtension(mockPi as ExtensionAPI);

      const inputHandler = mockPi._handlers!["input"] as InputHandler;
      const beforeAgentStartHandler = mockPi._handlers!["before_agent_start"] as BeforeAgentStartHandler;

      await inputHandler({ text: "Interactive prompt", source: "interactive" }, ctx);
      expect(mockPi.setSessionName).toHaveBeenCalledWith("Interactive Title");

      vi.mocked(mockPi.pi.complete).mockClear();

      await beforeAgentStartHandler(
        { type: "before_agent_start", prompt: "Interactive prompt", systemPrompt: "", images: undefined },
        ctx,
      );

      expect(mockPi.pi.complete).not.toHaveBeenCalled();
    });
  });

  describe("Thinking content fallback", () => {
    it("should extract title from thinking content when no text content", async () => {
      const fsMock = fs as unknown as {
        promises: {
          access: ReturnType<typeof vi.fn>;
          readFile: ReturnType<typeof vi.fn>;
        };
      };
      fsMock.promises.access.mockRejectedValue(new Error("File not found"));

      vi.mocked(mockPi.pi.complete).mockResolvedValue({
        content: [{ type: "thinking", thinking: "  \nLet me analyze this\nFix the bug" }],
      } as unknown as Awaited<ReturnType<typeof mockPi.pi.complete>>);

      const ctx = createMockContext();

      sessionTitleExtension(mockPi as ExtensionAPI);

      const inputHandler = mockPi._handlers!["input"] as InputHandler;
      await inputHandler({ text: "Hello world", source: "user" }, ctx);

      expect(mockPi.setSessionName).toHaveBeenCalledWith("Fix the bug");
    });

    it("should filter out heuristic phrases from thinking content", async () => {
      const fsMock = fs as unknown as {
        promises: {
          access: ReturnType<typeof vi.fn>;
          readFile: ReturnType<typeof vi.fn>;
        };
      };
      fsMock.promises.access.mockRejectedValue(new Error("File not found"));

      vi.mocked(mockPi.pi.complete).mockResolvedValue({
        content: [{ type: "thinking", thinking: "We are processing the request\nAccording to my analysis\nThe actual title" }],
      } as unknown as Awaited<ReturnType<typeof mockPi.pi.complete>>);

      const ctx = createMockContext();

      sessionTitleExtension(mockPi as ExtensionAPI);

      const inputHandler = mockPi._handlers!["input"] as InputHandler;
      await inputHandler({ text: "Test", source: "user" }, ctx);

      expect(mockPi.setSessionName).toHaveBeenCalledWith("The actual title");
    });

    it("should truncate thinking content to 72 characters", async () => {
      const fsMock = fs as unknown as {
        promises: {
          access: ReturnType<typeof vi.fn>;
          readFile: ReturnType<typeof vi.fn>;
        };
      };
      fsMock.promises.access.mockRejectedValue(new Error("File not found"));

      const longLine = "A".repeat(100);
      vi.mocked(mockPi.pi.complete).mockResolvedValue({
        content: [{ type: "thinking", thinking: longLine }],
      } as unknown as Awaited<ReturnType<typeof mockPi.pi.complete>>);

      const ctx = createMockContext();

      sessionTitleExtension(mockPi as ExtensionAPI);

      const inputHandler = mockPi._handlers!["input"] as InputHandler;
      await inputHandler({ text: "Test", source: "user" }, ctx);

      expect(mockPi.setSessionName).toHaveBeenCalledWith("A".repeat(72));
    });

    it("should return empty string if no valid content found", async () => {
      const fsMock = fs as unknown as {
        promises: {
          access: ReturnType<typeof vi.fn>;
          readFile: ReturnType<typeof vi.fn>;
        };
      };
      fsMock.promises.access.mockRejectedValue(new Error("File not found"));

      vi.mocked(mockPi.pi.complete).mockResolvedValue({
        content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "" } }],
      } as unknown as Awaited<ReturnType<typeof mockPi.pi.complete>>);

      const ctx = createMockContext();

      sessionTitleExtension(mockPi as ExtensionAPI);

      const inputHandler = mockPi._handlers!["input"] as InputHandler;
      await inputHandler({ text: "Test", source: "user" }, ctx);

      // Title should not be set since no valid content was found
      expect(mockPi.setSessionName).not.toHaveBeenCalled();
    });
  });

  describe("Extension input edge cases", () => {
    it("should still generate title via before_agent_start if first input is from extension", async () => {
      const fsMock = fs as unknown as {
        promises: {
          access: ReturnType<typeof vi.fn>;
          readFile: ReturnType<typeof vi.fn>;
        };
      };
      fsMock.promises.access.mockRejectedValue(new Error("File not found"));

      vi.mocked(mockPi.pi.complete).mockResolvedValue({
        content: [{ type: "text", text: "Fallback Title" }],
      } as unknown as Awaited<ReturnType<typeof mockPi.pi.complete>>);

      const ctx = createMockContext();

      sessionTitleExtension(mockPi as ExtensionAPI);

      const inputHandler = mockPi._handlers!["input"] as InputHandler;
      const beforeAgentStartHandler = mockPi._handlers!["before_agent_start"] as BeforeAgentStartHandler;

      // First input is from extension source - should NOT set sawInteractiveInput
      await inputHandler({ text: "Extension message", source: "extension" }, ctx);
      expect(mockPi.setSessionName).not.toHaveBeenCalled();

      // before_agent_start should still work as fallback
      await beforeAgentStartHandler(
        { type: "before_agent_start", prompt: "Print mode prompt", systemPrompt: "", images: undefined },
        ctx,
      );

      expect(mockPi.pi.complete).toHaveBeenCalled();
      expect(mockPi.setSessionName).toHaveBeenCalledWith("Fallback Title");
    });

    it("should skip title generation if getApiKey is not available on modelRegistry", async () => {
      const fsMock = fs as unknown as {
        promises: {
          access: ReturnType<typeof vi.fn>;
          readFile: ReturnType<typeof vi.fn>;
        };
      };
      fsMock.promises.access.mockRejectedValue(new Error("File not found"));

      const ctx = createMockContext({
        modelRegistry: {
          // No getApiKey method - should gracefully skip
        } as unknown as ExtensionContext["modelRegistry"],
      });

      sessionTitleExtension(mockPi as ExtensionAPI);

      const inputHandler = mockPi._handlers!["input"] as InputHandler;
      await inputHandler({ text: "Hello world", source: "user" }, ctx);

      // Should not crash and should not call complete
      expect(mockPi.pi.complete).not.toHaveBeenCalled();
      expect(mockPi.setSessionName).not.toHaveBeenCalled();
    });
  });
});