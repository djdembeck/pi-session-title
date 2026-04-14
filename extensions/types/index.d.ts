// Module augmentation for @oh-my-pi/pi-ai types
// See pi-ai.d.ts for the full type definitions
/// <reference path="./pi-ai.d.ts" />

// Re-export types from @oh-my-pi/pi-ai
export type {
  Model,
  Api,
  KnownApi,
  Provider,
  KnownProvider,
  Context,
  Message,
  Content,
  TextContent,
  ThinkingContent,
  ImageContent,
  ToolCall,
  Tool,
  StreamOptions,
  SimpleStreamOptions,
  Usage,
  StopReason,
  AssistantMessage,
  ThinkingConfig,
  Effort,
  ThinkingControlMode,
  OpenAICompat,
  ApiSpecificOptions,
  ApiOptionsMap,
  AnthropicOptions,
  CursorExecHandlers,
  ToolChoice,
  ServiceTier,
} from "@oh-my-pi/pi-ai";


// Extension function type
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

/**
 * Main extension function type for sessionTitleExtension.
 * Takes an ExtensionAPI and returns void or a Promise<void>.
 */
export type SessionTitleExtensionFn = (
  pi: ExtensionAPI
) => void | Promise<void>;

declare const sessionTitleExtension: SessionTitleExtensionFn;
export default sessionTitleExtension;