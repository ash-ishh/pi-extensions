# query-time-footer

A tiny Pi extension that shows the latest query duration in Pi's footer.

Part of: https://github.com/ash-ishh/pi-extensions

## What it does

- Shows `query #N running...` while a prompt is active.
- Replaces it with the last completed duration when the prompt finishes.
- Adds a `/query-time` command to show the latest duration as a notification.

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
      "extensions": ["query-time-footer/extensions/query-time-footer.ts"]
    }
  ]
}
```

## Usage

Once installed or loaded with `-e`, the footer automatically shows query timing.

Inside Pi, run:

```text
/query-time
```

to see the last measured query duration.

## Files

- `extensions/query-time-footer.ts` - the Pi extension.
- `package.json` - standalone Pi package manifest for this extension folder.

## License

MIT
