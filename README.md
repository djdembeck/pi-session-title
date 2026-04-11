# pi-session-title

Sophisticated session title generation extension for [pi](https://github.com/marioechr/pi) with templates and dedicated model support.

**Why?** Session titles should be meaningful and contextual. This extension generates concise, relevant titles from the first user message using customizable templates and dedicated models.

## Installation

```bash
pi install pi-session-title
```

<details>
<summary>Manual installation</summary>

```bash
git clone https://github.com/djdembeck/pi-session-title.git ~/.pi/agent/extensions/pi-session-title
cd ~/.pi/agent/extensions/pi-session-title
npm install
npm run build
```

</details>

## How It Works

The extension hooks into the `session_before_auto_name` event. When a new session starts:

1. Loads custom template from `.pi/prompts/title.md` or uses built-in default
2. Resolves model (configured `modelId` or current session model)
3. Generates a concise title from the first user message
4. Sanitizes and returns the title to pi core

**Supported variables in templates:**
- `{{firstMessage}}` — First user message (truncated to `maxInputLength`)
- `{{cwd}}` — Current working directory
- `{{timestamp}}` — ISO timestamp

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
| `modelId` | string | — | Specific model ID for title generation (uses current model if not set) |
| `templatePath` | string | — | Custom template path (relative or absolute) |
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

### Example Template

Create `.pi/prompts/title.md` in your project:

```markdown
Generate a short title (max 6 words) for a coding session.

User's request: {{firstMessage}}
Project: {{cwd}}

Respond with ONLY the title.
```

## Commands

### `/regenerate-title` — Regenerate session title

Manually trigger title regeneration from the first user message:

```bash
/regenerate-title
```

## API

The extension exports a default function compatible with pi's extension API:

```typescript
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import sessionTitleExtension from "pi-session-title";

// pi core loads and calls:
sessionTitleExtension(ctx);
```

### Required Peer Dependencies

- `@mariozechner/pi-coding-agent` — Type definitions for pi extension API

## Development

```bash
# Build
npm run build

# Watch mode
npm run dev

# Clean
npm run clean
```

## Related

- [pi](https://github.com/marioechr/pi) — The agent this extension works with

## License

MIT
