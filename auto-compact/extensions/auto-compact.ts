import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const COMMAND_NAME = "auto-compact";
const CONFIG_BASENAME = "pi-auto-compact.json";
const DEFAULT_THRESHOLD_PERCENT = 60;
const MIN_THRESHOLD_PERCENT = 1;
const MAX_THRESHOLD_PERCENT = 95;
const DEFAULT_CONTEXT_WINDOW = 200_000;
const DEFAULT_COMPACT_INSTRUCTIONS =
	"Auto-compaction triggered because context usage crossed the configured threshold. Preserve the current task, recent work, key decisions, active files, blockers, and next steps.";

const FOLLOW_UP_BY_PHASE = {
	"pre-turn": "Auto-compact ran before this turn. Continue with the current user request.",
	"mid-turn": "Auto-compact ran mid-turn. Continue executing the remaining work.",
	"session-start": "Auto-compact ran after loading this session. Continue with the active task.",
} as const;

type AutoCompactPhase = keyof typeof FOLLOW_UP_BY_PHASE;

interface AutoCompactConfigFile {
	enabled?: boolean;
	thresholdPercent?: number;
}

interface ResolvedAutoCompactConfig {
	configPath: string;
	enabled: boolean;
	thresholdPercent: number;
}

interface UsageSnapshot {
	tokens: number | null;
	contextWindow: number;
	limit: number;
	percent: number | null;
	thresholdPercent: number;
}

const DEFAULT_CONFIG: Required<AutoCompactConfigFile> = {
	enabled: true,
	thresholdPercent: DEFAULT_THRESHOLD_PERCENT,
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeThresholdPercent(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	if (value < MIN_THRESHOLD_PERCENT || value > MAX_THRESHOLD_PERCENT) return undefined;
	return Math.round(value * 10) / 10;
}

function parseThresholdPercent(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const parsed = Number(value.trim().replace(/%$/, ""));
	return normalizeThresholdPercent(parsed);
}

function formatPercent(percent: number): string {
	return Number.isInteger(percent) ? `${percent}%` : `${percent.toFixed(1)}%`;
}

function computeLimit(contextWindow: number, thresholdPercent: number): number {
	return Math.floor(contextWindow * thresholdPercent / 100);
}

function getConfigPaths(
	cwd: string,
	homeDir: string = homedir(),
): {
	projectConfigPath: string;
	globalConfigPath: string;
} {
	return {
		projectConfigPath: join(cwd, ".pi", "extensions", CONFIG_BASENAME),
		globalConfigPath: join(homeDir, ".pi", "agent", "extensions", CONFIG_BASENAME),
	};
}

function readConfigFile(filePath: string): AutoCompactConfigFile | null {
	if (!existsSync(filePath)) return null;
	try {
		const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
		if (!isRecord(parsed)) return {};
		const config: AutoCompactConfigFile = {};
		if (typeof parsed.enabled === "boolean") config.enabled = parsed.enabled;
		const thresholdPercent = normalizeThresholdPercent(parsed.thresholdPercent);
		if (thresholdPercent !== undefined) config.thresholdPercent = thresholdPercent;
		return config;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.warn(`[pi-auto-compact] Failed to read ${filePath}: ${message}`);
		return null;
	}
}

function writeConfigFile(filePath: string, config: AutoCompactConfigFile): void {
	try {
		mkdirSync(dirname(filePath), { recursive: true });
		writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.warn(`[pi-auto-compact] Failed to write ${filePath}: ${message}`);
	}
}

function ensureDefaultConfigFile(projectConfigPath: string, globalConfigPath: string): void {
	if (existsSync(projectConfigPath) || existsSync(globalConfigPath)) return;
	writeConfigFile(globalConfigPath, DEFAULT_CONFIG);
}

function resolveAutoCompactConfig(cwd: string, homeDir: string = homedir()): ResolvedAutoCompactConfig {
	const { projectConfigPath, globalConfigPath } = getConfigPaths(cwd, homeDir);
	ensureDefaultConfigFile(projectConfigPath, globalConfigPath);

	const globalConfig = readConfigFile(globalConfigPath) ?? {};
	const projectConfig = readConfigFile(projectConfigPath) ?? {};
	const selectedConfigPath = existsSync(projectConfigPath) ? projectConfigPath : globalConfigPath;
	const merged = { ...globalConfig, ...projectConfig };

	return {
		configPath: selectedConfigPath,
		enabled: merged.enabled ?? DEFAULT_CONFIG.enabled,
		thresholdPercent: merged.thresholdPercent ?? DEFAULT_CONFIG.thresholdPercent,
	};
}

function formatTokens(tokens: number | null): string {
	if (tokens === null) return "unknown";
	if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`;
	if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
	return `${tokens}`;
}

function hasToolCalls(message: unknown): boolean {
	if (!message || typeof message !== "object") return false;
	const maybeMessage = message as { role?: unknown; content?: unknown };
	if (maybeMessage.role !== "assistant" || !Array.isArray(maybeMessage.content)) return false;
	return maybeMessage.content.some((block) => {
		return Boolean(block && typeof block === "object" && (block as { type?: unknown }).type === "tool_use");
	});
}

function getConfigCwd(ctx: ExtensionContext): string {
	return ctx.cwd || process.cwd();
}

export default function autoCompact(pi: ExtensionAPI): void {
	let pendingCompaction = false;
	let lastKnownTokens: number | null = null;
	let cachedContextWindow = DEFAULT_CONTEXT_WINDOW;
	let cachedConfig: ResolvedAutoCompactConfig | undefined;
	let cachedLimit = computeLimit(DEFAULT_CONTEXT_WINDOW, DEFAULT_CONFIG.thresholdPercent);
	let triggerCount = 0;
	let lastTrigger: string | null = null;

	function recomputeCachedLimit(): void {
		cachedLimit = computeLimit(cachedContextWindow, cachedConfig?.thresholdPercent ?? DEFAULT_CONFIG.thresholdPercent);
	}

	function refreshConfig(ctx: ExtensionContext): ResolvedAutoCompactConfig {
		cachedConfig = resolveAutoCompactConfig(getConfigCwd(ctx));
		recomputeCachedLimit();
		return cachedConfig;
	}

	function getConfig(ctx: ExtensionContext): ResolvedAutoCompactConfig {
		return cachedConfig ?? refreshConfig(ctx);
	}

	function setEnabled(ctx: ExtensionContext, enabled: boolean): void {
		const config = refreshConfig(ctx);
		const nextConfig = { ...(readConfigFile(config.configPath) ?? {}), enabled };
		writeConfigFile(config.configPath, nextConfig);
		cachedConfig = { ...config, enabled };
		notify(ctx, `Auto-compact is now ${enabled ? "enabled" : "disabled"}.`, "info");
	}

	function setThresholdPercent(ctx: ExtensionContext, thresholdPercent: number): void {
		const config = refreshConfig(ctx);
		const nextConfig = { ...(readConfigFile(config.configPath) ?? {}), thresholdPercent };
		writeConfigFile(config.configPath, nextConfig);
		cachedConfig = { ...config, thresholdPercent };
		recomputeCachedLimit();
		notify(
			ctx,
			`Auto-compact threshold set to ${formatPercent(thresholdPercent)} (${formatTokens(cachedLimit)} tokens for current model).`,
			"info",
		);
	}

	function resetConfig(ctx: ExtensionContext): void {
		const config = refreshConfig(ctx);
		writeConfigFile(config.configPath, DEFAULT_CONFIG);
		cachedConfig = { configPath: config.configPath, ...DEFAULT_CONFIG };
		recomputeCachedLimit();
		notify(ctx, `Auto-compact reset to enabled at ${formatPercent(DEFAULT_CONFIG.thresholdPercent)}.`, "info");
	}

	function updateLimits(contextWindow: number | undefined): void {
		if (!contextWindow || contextWindow <= 0 || contextWindow === cachedContextWindow) return;
		cachedContextWindow = contextWindow;
		recomputeCachedLimit();
	}

	function getUsage(ctx: ExtensionContext): UsageSnapshot {
		const usage = ctx.getContextUsage();
		updateLimits(usage?.contextWindow ?? ctx.model?.contextWindow ?? DEFAULT_CONTEXT_WINDOW);

		if (usage?.tokens !== null && usage?.tokens !== undefined) {
			lastKnownTokens = usage.tokens;
		}

		const tokens = usage?.tokens ?? lastKnownTokens;
		const thresholdPercent = cachedConfig?.thresholdPercent ?? DEFAULT_CONFIG.thresholdPercent;
		const percent = usage?.percent ?? (tokens === null ? null : (tokens / cachedContextWindow) * 100);
		return {
			tokens,
			contextWindow: cachedContextWindow,
			limit: cachedLimit,
			percent,
			thresholdPercent,
		};
	}

	function notify(ctx: ExtensionContext, message: string, level: "info" | "warning" | "error" = "info"): void {
		if (ctx.hasUI) {
			ctx.ui.notify(message, level);
		}
	}

	function autoContinueIfIdle(ctx: ExtensionContext, phase: AutoCompactPhase): void {
		setImmediate(() => {
			if (ctx.isIdle()) {
				pi.sendUserMessage(FOLLOW_UP_BY_PHASE[phase]);
			}
		});
	}

	function triggerCompaction(ctx: ExtensionContext, phase: AutoCompactPhase): boolean {
		if (pendingCompaction) return false;

		pendingCompaction = true;
		triggerCount += 1;
		lastTrigger = phase;
		const usage = getUsage(ctx);
		notify(
			ctx,
			`Auto-compact started (${phase}; ${formatTokens(usage.tokens)} / ${formatTokens(usage.contextWindow)} tokens, threshold ${formatPercent(usage.thresholdPercent)}).`,
			"info",
		);

		ctx.compact({
			customInstructions: DEFAULT_COMPACT_INSTRUCTIONS,
			onComplete: () => {
				pendingCompaction = false;
				notify(ctx, "Auto-compact completed.", "info");
				if (phase === "pre-turn" || phase === "mid-turn") {
					autoContinueIfIdle(ctx, phase);
				}
			},
			onError: (error) => {
				pendingCompaction = false;
				const message = error instanceof Error ? error.message : String(error);
				notify(ctx, `Auto-compact failed: ${message}`, "error");
			},
		});

		return true;
	}

	function maybeTrigger(ctx: ExtensionContext, phase: AutoCompactPhase): boolean {
		if (!getConfig(ctx).enabled) return false;
		const usage = getUsage(ctx);
		if (usage.tokens === null || usage.tokens < usage.limit || pendingCompaction) return false;
		return triggerCompaction(ctx, phase);
	}

	pi.on("session_start", async (event, ctx) => {
		pendingCompaction = false;
		lastKnownTokens = null;
		refreshConfig(ctx);
		getUsage(ctx);

		// If pi starts or resumes into an already-large session, compact before the
		// next user turn. Skip brand-new sessions because they have no useful history.
		if (event.reason !== "new") {
			maybeTrigger(ctx, "session-start");
		}
	});

	pi.on("model_select", async (event) => {
		updateLimits(event.model?.contextWindow ?? DEFAULT_CONTEXT_WINDOW);
	});

	pi.on("turn_start", async (_event, ctx) => {
		maybeTrigger(ctx, "pre-turn");
	});

	pi.on("turn_end", async (event, ctx) => {
		// Only compact mid-turn when the assistant just requested tools. If this is
		// the final assistant answer, the next user turn's pre-turn check can compact
		// without adding an unnecessary follow-up prompt.
		if (!hasToolCalls(event.message)) return;
		maybeTrigger(ctx, "mid-turn");
	});

	pi.registerCommand(COMMAND_NAME, {
		description: "Configure auto-compaction or show status",
		getArgumentCompletions: (prefix) => {
			const commands = ["on", "off", "status", "threshold", "reset"];
			const items = commands.filter((value) => value.startsWith(prefix)).map((value) => ({ value, label: value }));
			return items.length > 0 ? items : null;
		},
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			const [command = "status", ...rest] = trimmed.split(/\s+/).filter(Boolean);

			if (command === "on") {
				setEnabled(ctx, true);
				return;
			}

			if (command === "off") {
				setEnabled(ctx, false);
				return;
			}

			if (command === "threshold") {
				const thresholdPercent = parseThresholdPercent(rest[0]);
				if (thresholdPercent === undefined) {
					ctx.ui.notify(
						`Usage: /${COMMAND_NAME} threshold <${MIN_THRESHOLD_PERCENT}-${MAX_THRESHOLD_PERCENT}>`,
						"warning",
					);
					return;
				}
				setThresholdPercent(ctx, thresholdPercent);
				return;
			}

			if (command === "reset") {
				resetConfig(ctx);
				return;
			}

			if (command === "status") {
				const config = refreshConfig(ctx);
				const usage = getUsage(ctx);
				const percent = usage.percent === null ? "unknown" : `${usage.percent.toFixed(1)}%`;
				ctx.ui.notify(
					`Auto Compact Status:\n` +
						`  Enabled: ${config.enabled ? "yes" : "no"}\n` +
						`  Threshold: ${formatPercent(config.thresholdPercent)}\n` +
						`  Current tokens: ${formatTokens(usage.tokens)}\n` +
						`  Context window: ${formatTokens(usage.contextWindow)}\n` +
						`  Trigger at: ${formatTokens(usage.limit)} tokens\n` +
						`  Usage: ${percent}\n` +
						`  Pending: ${pendingCompaction}\n` +
						`  Trigger count: ${triggerCount}\n` +
						`  Last trigger: ${lastTrigger ?? "never"}\n` +
						`  Config: ${config.configPath}`,
					"info",
				);
				return;
			}

			ctx.ui.notify(`Usage: /${COMMAND_NAME} [on|off|status|threshold <percent>|reset]`, "warning");
		},
	});
}

export const _test = {
	COMMAND_NAME,
	CONFIG_BASENAME,
	DEFAULT_THRESHOLD_PERCENT,
	MIN_THRESHOLD_PERCENT,
	MAX_THRESHOLD_PERCENT,
	DEFAULT_CONTEXT_WINDOW,
	DEFAULT_CONFIG,
	DEFAULT_COMPACT_INSTRUCTIONS,
	getConfigPaths,
	readConfigFile,
	resolveAutoCompactConfig,
	parseThresholdPercent,
	formatPercent,
	formatTokens,
	hasToolCalls,
};
