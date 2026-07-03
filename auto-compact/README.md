# pi-auto-compact

Pi extension that proactively runs Pi's **default `/compact` behavior** when context usage reaches a configurable percentage of the selected model's context window.

Auto-compaction is enabled by default. The default threshold is **60%** and can be changed with `/auto-compact threshold <percent>`.

## Behavior

Checks context usage at:

- `session_start` — compact an already-large resumed/forked/startup session
- `turn_start` — before the next model request
- `turn_end` — after an assistant tool-call turn, before the follow-up model request

When compaction interrupts an active turn (`turn_start` or mid-tool `turn_end`), the extension sends a short follow-up user message after compaction so Pi continues the interrupted task. Session-start compaction does not auto-start a new agent turn.

## What strategy does it use?

No custom pruning strategy. It delegates to Pi's built-in compaction via:

```ts
ctx.compact({ customInstructions })
```

That is the same mechanism behind `/compact`: Pi summarizes older context into a compaction entry and keeps recent messages according to Pi's configured compaction settings.

## Command

```text
/auto-compact                 # status
/auto-compact status          # status
/auto-compact on              # enable automatic compaction
/auto-compact off             # disable automatic compaction
/auto-compact threshold 60    # set trigger threshold, 1-95
/auto-compact threshold 75%   # percent sign is optional
/auto-compact reset           # reset to enabled at 60%
```

For manual compaction, use Pi's built-in `/compact` command.

## Config

The toggle is persisted to `pi-auto-compact.json`.

Config lookup uses project override first, then global:

1. `<project>/.pi/extensions/pi-auto-compact.json`
2. `~/.pi/agent/extensions/pi-auto-compact.json`

Default:

```json
{
  "enabled": true,
  "thresholdPercent": 60
}
```

## Install

From this monorepo package:

```bash
pi install git:github.com/ash-ishh/pi-extensions
```

Or filter to only this extension:

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
