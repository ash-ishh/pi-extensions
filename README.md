# pi-extensions

Personal extensions for the [Pi coding agent](https://github.com/badlogic/pi-mono).

## Extensions

| Extension | Description |
|-----------|-------------|
| [query-time-footer](query-time-footer/) | Show the active query number and latest query duration in Pi's footer. Adds `/query-time`. |
| [pi-openai-fast](pi-openai-fast/) | `/fast` toggle for OpenAI priority service tier on configured models. Copied/forked from [`@benvargas/pi-openai-fast`](https://github.com/ben-vargas/pi-packages/tree/main/packages/pi-openai-fast) by Ben Vargas. |
| [auto-compact](auto-compact/) | Run Pi's default compaction automatically at a configurable context threshold (session override by default, fallback 60%). Adds `/auto-compact on|off|status|threshold|reset`. |
| [context-shortcuts](context-shortcuts/) | Expand global `@...` aliases like `@project_context` into hidden context files. Adds `/context-shortcuts`. |

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

For auto-compact only:

```json
{
  "packages": [
    {
      "source": "git:github.com/ash-ishh/pi-extensions",
      "extensions": ["auto-compact/extensions/auto-compact.ts"]
    }
  ]
}
```

For context shortcuts only:

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

## Quick Setup

If you keep a local clone, add extensions to your `~/.pi/agent/settings.json`:

```json
{
  "extensions": [
    "~/pi-extensions/query-time-footer/extensions/query-time-footer.ts",
    "~/pi-extensions/pi-openai-fast/extensions/index.ts",
    "~/pi-extensions/auto-compact/extensions/auto-compact.ts",
    "~/pi-extensions/context-shortcuts/extensions/context-shortcuts.ts"
  ]
}
```

See each extension's README for details.

## Testing

Install development dependencies once with `npm install`, then run all extension tests with:

```bash
npm test
```

During development, use `npm run test:watch` or target one extension with a path filter, for example `npm test -- auto-compact`.

Run the tests before committing or pushing extension changes, before publishing/installing a new package version, and after Pi API/model/provider upgrades that could affect extension behavior. CI also runs them on every push and pull request.

## Credits

`pi-openai-fast` is copied/forked from [`@benvargas/pi-openai-fast`](https://github.com/ben-vargas/pi-packages/tree/main/packages/pi-openai-fast) by Ben Vargas. The original MIT license is preserved in [`pi-openai-fast/LICENSE`](pi-openai-fast/LICENSE).
