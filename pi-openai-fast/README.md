# @ash-ishh/pi-openai-fast

> **Copied from / forked from:** `@benvargas/pi-openai-fast` by **Ben Vargas**  
> Original repo: https://github.com/ben-vargas/pi-packages/tree/main/packages/pi-openai-fast

`/fast` toggle for [Pi](https://github.com/badlogic/pi-mono) that enables OpenAI priority service tier on configured models.

This extension does not change the model, thinking level, tools, or prompts. It only adds `service_tier=priority` to provider requests when fast mode is active and the current model matches the configured supported-model list.

Requires Pi `0.57.0` or newer.

Part of: https://github.com/ash-ishh/pi-extensions

## Credits

This package is copied/forked from `@benvargas/pi-openai-fast` by Ben Vargas.

Original project:

- npm: `@benvargas/pi-openai-fast`
- GitHub: https://github.com/ben-vargas/pi-packages/tree/main/packages/pi-openai-fast

The original project is licensed under the MIT License. The original `LICENSE` file is preserved in this package.

## Install

Install the full extension repo:

```bash
pi install git:github.com/ash-ishh/pi-extensions
```

Or try locally:

```bash
pi -e /Users/ashish/Projects/pi-extensions
```

## Use only this extension

If you want only this extension from the repo, use Pi package filtering in `~/.pi/agent/settings.json`:

```json
{
  "packages": [
    {
      "source": "git:github.com/ash-ishh/pi-extensions",
      "extensions": ["pi-openai-fast/extensions/index.ts"]
    }
  ]
}
```

## Usage

- `/fast` toggles fast mode on or off.
- `/fast on` explicitly enables fast mode.
- `/fast off` explicitly disables fast mode.
- `/fast status` reports the current fast-mode state.
- `--fast` starts the session with fast mode enabled.
- By default, fast mode persists across new Pi sessions via a JSON config file.
- Startup state comes from the selected config file, not from resumed session/thread history.

Example:

```bash
pi -e /Users/ashish/Projects/pi-extensions --fast
```

## Config

Config files follow the project-over-global pattern:

- Project: `<repo>/.pi/extensions/pi-openai-fast.json`
- Global: `~/.pi/agent/extensions/pi-openai-fast.json`

If neither exists, the extension writes a default global config on first run.

Default config:

```json
{
  "persistState": true,
  "active": false,
  "supportedModels": [
    "openai/gpt-5.4",
    "openai/gpt-5.5",
    "openai-codex/gpt-5.4",
    "openai-codex/gpt-5.5"
  ]
}
```

Settings:

- `persistState`: when `true`, `/fast` writes the current on/off state to config so it resumes in new Pi sessions. Default: `true`.
- `active`: persisted fast-mode state used on startup when `persistState` is enabled.
- `supportedModels`: list of `provider/model-id` strings that should receive `service_tier=priority`.

Project config overrides global config. `/fast on` and `/fast off` write to the selected config file, so if a project config exists the remembered state is project-specific.

## License

MIT
