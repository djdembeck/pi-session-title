# PI Session Title Extension

Sophisticated session title generation extension for [pi](https://github.com/mariozechner/pi) with templates and dedicated model support.

## Features

- **Template-based prompts**: Customize title generation via `.pi/prompts/title.md`
- **Dedicated model**: Configure a fast, cheap model for title generation
- **Auto-disable core**: Automatically disables pi's built-in auto-naming
- **Manual regeneration**: `/regenerate-title` command to update title anytime
- **Cross-compatible**: Works with pi-mono and oh-my-pi template paths

## Installation

### From npm

```bash
npm install pi-session-title
```

### From source

```bash
cd pi-session-title
npm install
npm run build
```

Then add to your pi extensions directory or configure in settings.

## Configuration

Add to your pi settings:

```json
{
  "extensions": {
    "session-title": {
      "enabled": true,
      "modelId": "claude-3-haiku",
      "templatePath": null,
      "maxInputLength": 2000,
      "maxOutputTokens": 30
    }
  }
}
```

### Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable title generation |
| `modelId` | string | - | Specific model ID for title generation (uses current model if not set) |
| `templatePath` | string | - | Custom template path (relative or absolute) |
| `maxInputLength` | number | `2000` | Max chars from first message |
| `maxOutputTokens` | number | `30` | Max tokens in generated title |

## Template Discovery

The extension looks for templates in this order:

1. Custom `templatePath` from config
2. `.pi/prompts/title.md` (project)
3. `.omp/prompts/title.md` (project, oh-my-pi compatibility)
4. `~/.pi/agent/prompts/title.md` (global)
5. `~/.omp/agent/prompts/title.md` (global, oh-my-pi compatibility)
6. Built-in default prompt

## Template Variables

Templates support simple `{{variable}}` substitution:

- `{{firstMessage}}` - First user message (truncated to `maxInputLength`)
- `{{cwd}}` - Current working directory
- `{{timestamp}}` - ISO timestamp

### Example Template

```markdown
Generate a short title (max 6 words) for a coding session.

User's request: {{firstMessage}}
Project: {{cwd}}

Respond with ONLY the title.
```

## Commands

### `/regenerate-title`

Regenerate the session title from the first user message.

```bash
/regenerate-title
```

## How It Works

1. Hook into `session_before_auto_name` event
2. Load custom template or use default
3. Resolve model (configured `modelId` or current session model)
4. Generate title with truncated first message
5. Sanitize title (remove quotes, trim to 72 chars)
6. Return to pi core to apply

## API

The extension exports a default function compatible with pi's extension API:

```typescript
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import sessionTitleExtension from "pi-session-title";

// pi core loads and calls:
sessionTitleExtension(ctx);
```

### Required Peer Dependencies

- `@mariozechner/pi-coding-agent` - Type definitions for pi extension API

## Development

```bash
# Build
npm run build

# Watch mode
npm run dev

# Clean
npm run clean
```

## License

MIT
