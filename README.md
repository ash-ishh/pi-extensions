# pi-query-time-footer

A tiny Pi package that shows the latest query duration in Pi's footer.

## What it does

- shows `query #N running...` while a prompt is active
- replaces it with the last completed duration when the prompt finishes
- adds a `/query-time` command to show the latest duration as a notification

## Install

### Try locally

```bash
pi -e ./pi-query-time-footer
```

### Install globally

```bash
pi install ./pi-query-time-footer
```

### Install from npm

```bash
pi install npm:pi-query-time-footer
```

## Publish

```bash
cd pi-query-time-footer
npm publish --access public
```

## Files

- `extensions/query-time-footer.ts` - the extension
- `package.json` - Pi package manifest
