import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;
	const minutes = Math.floor(ms / 60_000);
	const seconds = ((ms % 60_000) / 1000).toFixed(1);
	return `${minutes}m ${seconds}s`;
}

export default function (pi: ExtensionAPI) {
	let startedAt = 0;
	let queryCount = 0;
	let lastDurationMs: number | null = null;

	function setIdleStatus(ctx: ExtensionContext) {
		if (!ctx.hasUI) return;
		const theme = ctx.ui.theme;
		const count = theme.fg("accent", `#${queryCount}`);
		const label = lastDurationMs === null
			? theme.fg("dim", " query time: —")
			: theme.fg("dim", ` query time: ${formatDuration(lastDurationMs)}`);
		ctx.ui.setStatus("query-time-footer", count + label);
	}

	pi.on("session_start", (_event, ctx) => {
		setIdleStatus(ctx);
	});

	pi.on("agent_start", (_event, ctx) => {
		startedAt = Date.now();
		queryCount += 1;
		if (!ctx.hasUI) return;
		const theme = ctx.ui.theme;
		const spinner = theme.fg("accent", "●");
		const text = theme.fg("dim", ` query #${queryCount} running...`);
		ctx.ui.setStatus("query-time-footer", spinner + text);
	});

	pi.on("agent_end", (_event, ctx) => {
		if (startedAt > 0) lastDurationMs = Date.now() - startedAt;
		startedAt = 0;
		setIdleStatus(ctx);
	});

	pi.registerCommand("query-time", {
		description: "Show the last measured query duration in a notification",
		handler: async (_args, ctx) => {
			const message = lastDurationMs === null
				? "No query has completed yet"
				: `Last query took ${formatDuration(lastDurationMs)}`;
			ctx.ui.notify(message, "info");
		},
	});
}
