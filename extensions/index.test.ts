import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
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

describe("sessionTitleExtension", () => {
  const originalEnv = { ...process.env };
  type Handler = (event: { firstUserMessage: string }) => Promise<{ name?: string; cancel?: boolean }>;
  type MockPi = ExtensionAPI & { _handlers?: Record<string, Handler> };
  let mockPi: MockPi;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = { ...originalEnv };

    mockPi = {
      on: vi.fn((event: string, handler: Handler) => {
        if (!mockPi._handlers) {
          mockPi._handlers = {};
        }
        mockPi._handlers[event] = handler;
      }),
      _handlers: {} as Record<string, Handler>,
    } as unknown as MockPi;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
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

      const mockModel = {
        completeSimple: vi.fn().mockResolvedValue("Test Title"),
      };

      (mockPi as unknown as { model: typeof mockModel; config: { enabled: boolean } }).model = mockModel;
      (mockPi as unknown as { config: { enabled: boolean } }).config = { enabled: true };

      sessionTitleExtension(mockPi as ExtensionAPI);
      const handler = mockPi._handlers!['session_start']!;

      await handler({ firstUserMessage: "Hello world" });

      const callArgs = mockModel.completeSimple.mock.calls[0];
      expect(callArgs[0]).toContain("Hello world");
    });

    it("should replace {{cwd}} in template", async () => {
      const fsMock = fs as unknown as {
        promises: {
          access: ReturnType<typeof vi.fn>;
          readFile: ReturnType<typeof vi.fn>;
        };
      };
      fsMock.promises.access.mockRejectedValue(new Error("File not found"));

      const mockModel = {
        completeSimple: vi.fn().mockResolvedValue("Test Title"),
      };

      (mockPi as unknown as { model: typeof mockModel; config: { enabled: boolean } }).model = mockModel;
      (mockPi as unknown as { config: { enabled: boolean } }).config = { enabled: true };

      sessionTitleExtension(mockPi as ExtensionAPI);
      const handler = mockPi._handlers!['session_start']!;

      await handler({ firstUserMessage: "Test" });

      const callArgs = mockModel.completeSimple.mock.calls[0];
      expect(callArgs[0]).toContain(process.cwd());
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

      const mockModel = {
        completeSimple: vi.fn().mockResolvedValue("Test Title"),
      };

      (mockPi as unknown as { model: typeof mockModel; config: { enabled: boolean; templatePath: string } }).model = mockModel;
      (mockPi as unknown as { config: { enabled: boolean; templatePath: string } }).config = {
        enabled: true,
        templatePath: "./custom.md",
      };

      sessionTitleExtension(mockPi as ExtensionAPI);
      const handler = mockPi._handlers!['session_start']!;

      await handler({ firstUserMessage: "Test" });

      const callArgs = mockModel.completeSimple.mock.calls[0];
      expect(callArgs[0]).toMatch(/\d{4}-\d{2}-\d{2}T/);
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

      const mockModel = {
        completeSimple: vi.fn().mockResolvedValue('"Quoted Title"'),
      };

      (mockPi as unknown as { model: typeof mockModel; config: { enabled: boolean } }).model = mockModel;
      (mockPi as unknown as { config: { enabled: boolean } }).config = { enabled: true };

      sessionTitleExtension(mockPi as ExtensionAPI);
      const handler = mockPi._handlers!['session_start']!;

      const result = await handler({ firstUserMessage: "Test" });

      expect(result).toEqual({ name: "Quoted Title" });
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
      const mockModel = {
        completeSimple: vi.fn().mockResolvedValue(longTitle),
      };

      (mockPi as unknown as { model: typeof mockModel; config: { enabled: boolean } }).model = mockModel;
      (mockPi as unknown as { config: { enabled: boolean } }).config = { enabled: true };

      sessionTitleExtension(mockPi as ExtensionAPI);
      const handler = mockPi._handlers!['session_start']!;

      const result = await handler({ firstUserMessage: "Test" });

      expect(result).toEqual({ name: "A".repeat(72) });
    });

    it("should replace newlines with spaces", async () => {
      const fsMock = fs as unknown as {
        promises: {
          access: ReturnType<typeof vi.fn>;
          readFile: ReturnType<typeof vi.fn>;
        };
      };
      fsMock.promises.access.mockRejectedValue(new Error("File not found"));

      const mockModel = {
        completeSimple: vi.fn().mockResolvedValue("Line1\nLine2\n\nLine3"),
      };

      (mockPi as unknown as { model: typeof mockModel; config: { enabled: boolean } }).model = mockModel;
      (mockPi as unknown as { config: { enabled: boolean } }).config = { enabled: true };

      sessionTitleExtension(mockPi as ExtensionAPI);
      const handler = mockPi._handlers!['session_start']!;

      const result = await handler({ firstUserMessage: "Test" });

      expect(result).toEqual({ name: "Line1 Line2 Line3" });
    });
  });

  describe("Error handling", () => {
    it("should return cancel: true when config.enabled is false", async () => {
      (mockPi as unknown as { config: { enabled: boolean } }).config = { enabled: false };

      sessionTitleExtension(mockPi as ExtensionAPI);
      const handler = mockPi._handlers!['session_start']!;

      const result = await handler({ firstUserMessage: "Test" });

      expect(result).toEqual({ cancel: true });
    });

    it("should return cancel: true when model is not available", async () => {
      (mockPi as unknown as { model: undefined; config: { enabled: boolean } }).model = undefined;
      (mockPi as unknown as { config: { enabled: boolean } }).config = { enabled: true };

      sessionTitleExtension(mockPi as ExtensionAPI);
      const handler = mockPi._handlers!['session_start']!;

      const result = await handler({ firstUserMessage: "Test" });

      expect(result).toEqual({ cancel: true });
    });

    it("should return cancel: true on error", async () => {
      const fsMock = fs as unknown as {
        promises: {
          access: ReturnType<typeof vi.fn>;
          readFile: ReturnType<typeof vi.fn>;
        };
      };
      fsMock.promises.access.mockRejectedValue(new Error("Disk error"));

      const mockModel = {
        completeSimple: vi.fn().mockRejectedValue(new Error("Model error")),
      };

      (mockPi as unknown as { model: typeof mockModel; config: { enabled: boolean } }).model = mockModel;
      (mockPi as unknown as { config: { enabled: boolean } }).config = { enabled: true };

      sessionTitleExtension(mockPi as ExtensionAPI);
      const handler = mockPi._handlers!['session_start']!;

      const result = await handler({ firstUserMessage: "Test" });

      expect(result).toEqual({ cancel: true });
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

      const mockModel = {
        completeSimple: vi.fn().mockResolvedValue("Title"),
      };

      (mockPi as unknown as { model: typeof mockModel; config: { enabled: boolean; templatePath: string } }).model = mockModel;
      (mockPi as unknown as { config: { enabled: boolean; templatePath: string } }).config = {
        enabled: true,
        templatePath: "./custom.md",
      };

      sessionTitleExtension(mockPi as ExtensionAPI);
      const handler = mockPi._handlers!['session_start']!;

      await handler({ firstUserMessage: "Hello" });

      expect(fsMock.promises.readFile).toHaveBeenCalledWith(
        expect.stringContaining("custom.md"),
        "utf-8"
      );
    });

    it("should fall back to default when no templates found", async () => {
      const fsMock = fs as unknown as {
        promises: {
          access: ReturnType<typeof vi.fn>;
          readFile: ReturnType<typeof vi.fn>;
        };
      };
      fsMock.promises.access.mockRejectedValue(new Error("Not found"));

      const mockModel = {
        completeSimple: vi.fn().mockResolvedValue("Title"),
      };

      (mockPi as unknown as { model: typeof mockModel; config: { enabled: boolean } }).model = mockModel;
      (mockPi as unknown as { config: { enabled: boolean } }).config = { enabled: true };

      sessionTitleExtension(mockPi as ExtensionAPI);
      const handler = mockPi._handlers!['session_start']!;

      await handler({ firstUserMessage: "Hello world" });

      const callArgs = mockModel.completeSimple.mock.calls[0];
      expect(callArgs[0]).toContain("Generate a concise title");
      expect(callArgs[0]).toContain("Hello world");
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

      const mockModel = {
        completeSimple: vi.fn().mockResolvedValue("Title"),
      };

      (mockPi as unknown as { model: typeof mockModel; config: { enabled: boolean } }).model = mockModel;
      (mockPi as unknown as { config: { enabled: boolean } }).config = { enabled: true };

      sessionTitleExtension(mockPi as ExtensionAPI);
      const handler = mockPi._handlers!['session_start']!;

      await handler({ firstUserMessage: "Test" });

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
      const mockModel = {
        completeSimple: vi.fn().mockImplementation((prompt: string) => {
          capturedPrompt = prompt;
          return Promise.resolve("Title");
        }),
      };

      (mockPi as unknown as { model: typeof mockModel; config: { enabled: boolean; maxInputLength: number } }).model = mockModel;
      (mockPi as unknown as { config: { enabled: boolean; maxInputLength: number } }).config = {
        enabled: true,
        maxInputLength: 100,
      };

      sessionTitleExtension(mockPi as ExtensionAPI);
      const handler = mockPi._handlers!['session_start']!;

      await handler({ firstUserMessage: longMessage });

      const firstMessageMatch = capturedPrompt.match(/First message: ([\s\S]+?)(?:\n|$)/);
      expect(firstMessageMatch).toBeTruthy();
      if (firstMessageMatch) {
        expect(firstMessageMatch[1].trim().length).toBeLessThanOrEqual(100);
      }
    });
  });
});
