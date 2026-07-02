# context-shortcuts

Pi extension for short global `@...` aliases that inject configured file contents into model context on demand.

## Install

Install the whole `pi-extensions` package from GitHub:

```bash
pi install git:github.com/ash-ishh/pi-extensions
```

Then restart Pi or run `/reload` in an existing Pi session.

To enable only this extension, edit `~/.pi/agent/settings.json` and use a filtered package entry:

```json
{
  "packages": [
    {
      "source": "git:github.com/ash-ishh/pi-extensions",
      "extensions": ["context-shortcuts/extensions/context-shortcuts.ts"]
    }
  ]
}
```

For local development:

```bash
pi -e /Users/ashish/Projects/pi-extensions/context-shortcuts
```

## Usage

Define a shortcut, then type it in any prompt:

```text
@project_context write a launch announcement for the new dashboard
```

The extension loads the configured file(s) into hidden context before the model runs, while your visible prompt stays short. It also adds autocomplete suggestions for configured aliases when you type `@`.

Run `/context-shortcuts` in Pi to list loaded shortcuts and config paths.

## Config

Config is loaded from:

- Global: `~/.pi/agent/extensions/context-shortcuts.json`
- Project: `<cwd>/.pi/extensions/context-shortcuts.json` (overrides global)

On first run, the extension creates a disabled starter config:

```json
{
  "shortcuts": {
    "project_context": {
      "enabled": false,
      "path": "~/context/project-context.md",
      "description": "Example project context file. Set enabled to true and update this path."
    }
  }
}
```

Enable it by setting `enabled` to `true` and pointing `path` at your file:

```json
{
  "shortcuts": {
    "project_context": {
      "enabled": true,
      "path": "~/context/project-context.md",
      "description": "Product, audience, and positioning notes"
    }
  }
}
```

Values can be strings, or objects with `path`, `paths`, `description`, and `enabled`:

```json
{
  "shortcuts": {
    "brand_voice": "~/context/brand-voice.md",
    "launch_context": {
      "paths": [
        "~/context/company.md",
        "~/context/product.md",
        "~/context/launch-plan.md"
      ],
      "description": "Company + product + launch plan"
    },
    "old_context": false
  }
}
```

Shortcut names may contain letters, numbers, `_`, and `-`, and must start with a letter or number.
