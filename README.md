# pi-extensions

Personal extensions for the [Pi coding agent](https://github.com/badlogic/pi-mono).

## Extensions

| Extension | Description |
|-----------|-------------|
| [query-time-footer](query-time-footer/) | Show the active query number and latest query duration in Pi's footer. Adds `/query-time`. |
| [pi-openai-fast](pi-openai-fast/) | `/fast` toggle for OpenAI priority service tier on configured models. Copied/forked from [`@benvargas/pi-openai-fast`](https://github.com/ben-vargas/pi-packages/tree/main/packages/pi-openai-fast) by Ben Vargas. |

## Install (pi package manager)

```bash
pi install git:github.com/ash-ishh/pi-extensions
```

To enable only a subset, replace the package entry in `~/.pi/agent/settings.json` with a filtered one:

```json
{
  "packages": [
    {
      "source": "git:github.com/ash-ishh/pi-extensions",
      "extensions": ["query-time-footer/extensions/query-time-footer.ts"]
    }
  ]
}
```

For OpenAI fast only:

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

## Quick Setup

If you keep a local clone, add extensions to your `~/.pi/agent/settings.json`:

```json
{
  "extensions": [
    "~/pi-extensions/query-time-footer/extensions/query-time-footer.ts",
    "~/pi-extensions/pi-openai-fast/extensions/index.ts"
  ]
}
```

See each extension's README for details.

## Credits

`pi-openai-fast` is copied/forked from [`@benvargas/pi-openai-fast`](https://github.com/ben-vargas/pi-packages/tree/main/packages/pi-openai-fast) by Ben Vargas. The original MIT license is preserved in [`pi-openai-fast/LICENSE`](pi-openai-fast/LICENSE).
