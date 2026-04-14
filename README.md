# pi-session-title

Session-title extension for pi-compatible runtimes, including oh-my-pi.

It generates a concise session title from the first real prompt and persists it through the host extension API.

## Installation

### npm (recommended)

```bash
npm install pi-session-title
```

### Manual

```bash
git clone https://github.com/djdembeck/pi-session-title.git ~/.omp/agent/extensions/pi-session-title
cd ~/.omp/agent/extensions/pi-session-title
npm install
npm run build
```

## How it works

The extension registers two event handlers:
- `input` — fires in interactive sessions for user-originated input
- `before_agent_start` — fires for all prompts before the agent loop. The extension only uses it as a fallback when `input` never fires (e.g., non-interactive/print mode).

For the first prompt-like input in a session it will:

1. Skip extension-originated input and command-style input (`/`, `!`, `$`)
2. Skip work when the session already has a name
3. Load a prompt template if present
4. Use the current session model to generate a title from the first prompt
5. Call `setSessionName(title, "auto")` — auto-generated titles yield to user-renames (`/rename`)

In oh-my-pi interactive mode, this timing matters: `input` handlers run before the built-in first-message auto-title check, so setting the name there prevents omp from generating a competing default title.

## Configuration

The extension is configured with environment variables.

| Variable | Default | Description |
|---|---|---|
| `PI_TITLE_ENABLED` | `true` | Enable or disable title generation |
| `PI_TITLE_TEMPLATE` | unset | Custom template path, relative to cwd or absolute |
| `PI_TITLE_MAX_INPUT` | `2000` | Maximum characters from the first prompt sent to the model |
| `PI_TITLE_MAX_TOKENS` | `30` | Maximum tokens requested for the generated title |

Example:

```bash
export PI_TITLE_ENABLED=true
export PI_TITLE_MAX_INPUT=1000
export PI_TITLE_MAX_TOKENS=20
```

## Template variables

Available template variables:

- `{{firstMessage}}`
- `{{cwd}}`
- `{{timestamp}}`

## Template discovery

Templates are resolved in this order:

1. `PI_TITLE_TEMPLATE`
2. `.pi/prompts/title.md`
3. `.omp/prompts/title.md`
4. `~/.pi/agent/prompts/title.md`
5. `~/.omp/agent/prompts/title.md`
6. Built-in default template

Example project template:

```md
Generate a short title (max 6 words) for a coding session.

User request: {{firstMessage}}
Project: {{cwd}}

Respond with ONLY the title.
```

## Compatibility

This package is typed against `@mariozechner/pi-coding-agent`. At runtime it needs a host that exposes `getSessionName()` / `setSessionName()` on the extension API. For title generation via the model, the function attempts to load `@oh-my-pi/pi-ai` first and falls back to `@mariozechner/pi-ai` if that import is unavailable. Title generation is only skipped (without error) when neither module is resolvable.
The extension resolves API keys and request headers through both `getApiKeyAndHeaders` (pi-mono) and `getApiKey` (oh-my-pi) on the model registry, so it works across both runtime variants.

## Development

```bash
npm install
npm run typecheck
npm run build
npm test
```

## License

MIT
