import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const COMMAND_NAME = "auto-compact";
const CONFIG_BASENAME = "pi-auto-compact.json";
const SESSION_CONFIG_CUSTOM_TYPE = "pi-auto-compact-config";
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
type ConfigScope = "session" | "project" | "global";
type ThresholdSource = ConfigScope | "default";
type EnabledSource = Exclude<ThresholdSource, "session">;

interface AutoCompactConfigFile {
	enabled?: boolean;
	thresholdPercent?: number;
}

interface ResolvedAutoCompactConfig {
	configPath: string;
	projectConfigPath: string;
	globalConfigPath: string;
	projectConfigExists: boolean;
	globalConfigExists: boolean;
	enabled: boolean;
	enabledSource: EnabledSource;
	thresholdPercent: number;
	thresholdSource: ThresholdSource;
	sessionThresholdPercent?: number;
	projectThresholdPercent?: number;
	globalThresholdPercent?: number;
}

interface UsageSnapshot {
	tokens: number | null;
	contextWindow: number;
	limit: number;
	percent: number | null;
	thresholdPercent: number;
	thresholdSource: ThresholdSource;
}

interface ScopedThresholdArgs {
	scope: ConfigScope;
	thresholdPercent?: number;
	unexpected?: string;
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

function parseScopeToken(value: string | undefined): ConfigScope | undefined {
	const normalized = value?.trim().replace(/^--/, "");
	if (normalized === "session" || normalized === "project" || normalized === "global") return normalized;
	return undefined;
}

function parseScopedThresholdArgs(args: string[], defaultScope: ConfigScope = "session"): ScopedThresholdArgs {
	let scope = defaultScope;
	let thresholdToken: string | undefined;
	let unexpected: string | undefined;

	for (const arg of args) {
		const parsedScope = parseScopeToken(arg);
		if (parsedScope) {
			scope = parsedScope;
			continue;
		}

		if (thresholdToken === undefined) {
			thresholdToken = arg;
			continue;
		}

		unexpected = arg;
		break;
	}

	return { scope, thresholdPercent: parseThresholdPercent(thresholdToken), unexpected };
}

function parseScopedResetArgs(args: string[], defaultScope: ConfigScope = "session"): ConfigScope | undefined {
	let scope = defaultScope;
	for (const arg of args) {
		const parsedScope = parseScopeToken(arg);
		if (!parsedScope) return undefined;
		scope = parsedScope;
	}
	return scope;
}

function formatPercent(percent: number): string {
	return Number.isInteger(percent) ? `${percent}%` : `${percent.toFixed(1)}%`;
}

function formatOptionalPercent(percent: number | undefined): string {
	return percent === undefined ? "not set" : formatPercent(percent);
}

function formatScope(scope: ThresholdSource): string {
	return scope;
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

function resolveAutoCompactConfig(
	cwd: string,
	sessionThresholdPercentOrHomeDir?: number | string,
	maybeHomeDir: string = homedir(),
): ResolvedAutoCompactConfig {
	let sessionThresholdPercent: number | undefined;
	let homeDir = maybeHomeDir;
	if (typeof sessionThresholdPercentOrHomeDir === "string") {
		homeDir = sessionThresholdPercentOrHomeDir;
	} else {
		sessionThresholdPercent = sessionThresholdPercentOrHomeDir;
	}

	const { projectConfigPath, globalConfigPath } = getConfigPaths(cwd, homeDir);
	const projectConfigExists = existsSync(projectConfigPath);
	const globalConfigExists = existsSync(globalConfigPath);
	const globalConfig = readConfigFile(globalConfigPath) ?? {};
	const projectConfig = readConfigFile(projectConfigPath) ?? {};
	const selectedConfigPath = projectConfigExists ? projectConfigPath : globalConfigPath;

	let thresholdPercent = DEFAULT_CONFIG.thresholdPercent;
	let thresholdSource: ThresholdSource = "default";
	const globalThresholdPercent = globalConfig.thresholdPercent;
	const projectThresholdPercent = projectConfig.thresholdPercent;
	if (globalThresholdPercent !== undefined) {
		thresholdPercent = globalThresholdPercent;
		thresholdSource = "global";
	}
	if (projectThresholdPercent !== undefined) {
		thresholdPercent = projectThresholdPercent;
		thresholdSource = "project";
	}
	if (sessionThresholdPercent !== undefined) {
		thresholdPercent = sessionThresholdPercent;
		thresholdSource = "session";
	}

	let enabled = DEFAULT_CONFIG.enabled;
	let enabledSource: EnabledSource = "default";
	if (globalConfig.enabled !== undefined) {
		enabled = globalConfig.enabled;
		enabledSource = "global";
	}
	if (projectConfig.enabled !== undefined) {
		enabled = projectConfig.enabled;
		enabledSource = "project";
	}

	return {
		configPath: selectedConfigPath,
		projectConfigPath,
		globalConfigPath,
		projectConfigExists,
		globalConfigExists,
		enabled,
		enabledSource,
		thresholdPercent,
		thresholdSource,
		sessionThresholdPercent,
		projectThresholdPercent,
		globalThresholdPercent,
	};
}

function readSessionThresholdPercent(ctx: ExtensionContext): number | undefined {
	const entries = ctx.sessionManager.getEntries();
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type !== "custom" || entry.customType !== SESSION_CONFIG_CUSTOM_TYPE) continue;
		const data = entry.data;
		if (!isRecord(data) || !("thresholdPercent" in data)) continue;
		if (data.thresholdPercent === null) return undefined;
		return normalizeThresholdPercent(data.thresholdPercent);
	}
	return undefined;
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
	let thresholdArmed = true;
	let cachedContextWindow = DEFAULT_CONTEXT_WINDOW;
	let cachedConfig: ResolvedAutoCompactConfig | undefined;
	let cachedLimit = computeLimit(DEFAULT_CONTEXT_WINDOW, DEFAULT_CONFIG.thresholdPercent);
	let triggerCount = 0;
	let lastTrigger: string | null = null;

	function recomputeCachedLimit(): void {
		cachedLimit = computeLimit(cachedContextWindow, cachedConfig?.thresholdPercent ?? DEFAULT_CONFIG.thresholdPercent);
	}

	function refreshConfig(ctx: ExtensionContext): ResolvedAutoCompactConfig {
		cachedConfig = resolveAutoCompactConfig(getConfigCwd(ctx), readSessionThresholdPercent(ctx));
		recomputeCachedLimit();
		return cachedConfig;
	}

	function getConfig(ctx: ExtensionContext): ResolvedAutoCompactConfig {
		return cachedConfig ?? refreshConfig(ctx);
	}

	function notify(ctx: ExtensionContext, message: string, level: "info" | "warning" | "error" = "info"): void {
		if (ctx.hasUI) {
			ctx.ui.notify(message, level);
		}
	}

	function setEnabled(ctx: ExtensionContext, enabled: boolean): void {
		const config = refreshConfig(ctx);
		const nextConfig = { ...(readConfigFile(config.configPath) ?? {}), enabled };
		writeConfigFile(config.configPath, nextConfig);
		refreshConfig(ctx);
		if (enabled) thresholdArmed = true;
		notify(ctx, `Auto-compact is now ${enabled ? "enabled" : "disabled"}.`, "info");
	}

	function getScopedConfigPath(ctx: ExtensionContext, scope: Exclude<ConfigScope, "session">): string {
		const paths = getConfigPaths(getConfigCwd(ctx));
		return scope === "project" ? paths.projectConfigPath : paths.globalConfigPath;
	}

	function setThresholdPercent(ctx: ExtensionContext, thresholdPercent: number, scope: ConfigScope): void {
		if (scope === "session") {
			pi.appendEntry(SESSION_CONFIG_CUSTOM_TYPE, { version: 1, thresholdPercent });
		} else {
			const configPath = getScopedConfigPath(ctx, scope);
			const nextConfig = { ...(readConfigFile(configPath) ?? {}), thresholdPercent };
			writeConfigFile(configPath, nextConfig);
		}

		const config = refreshConfig(ctx);
		thresholdArmed = true;
		const targetLimit = computeLimit(cachedContextWindow, thresholdPercent);
		let message = `${formatScope(scope)} auto-compact threshold set to ${formatPercent(thresholdPercent)} (${formatTokens(targetLimit)} tokens for current model).`;
		if (config.thresholdSource !== scope || config.thresholdPercent !== thresholdPercent) {
			message += ` Effective threshold is ${formatPercent(config.thresholdPercent)} (${formatScope(config.thresholdSource)}, ${formatTokens(cachedLimit)} tokens for current model).`;
		}
		notify(ctx, message, "info");
	}

	function resetConfig(ctx: ExtensionContext, scope: ConfigScope): void {
		if (scope === "session") {
			pi.appendEntry(SESSION_CONFIG_CUSTOM_TYPE, { version: 1, thresholdPercent: null });
			const config = refreshConfig(ctx);
			thresholdArmed = true;
			notify(
				ctx,
				`Session auto-compact threshold override cleared. Effective threshold is ${formatPercent(config.thresholdPercent)} (${formatScope(config.thresholdSource)}).`,
				"info",
			);
			return;
		}

		const configPath = getScopedConfigPath(ctx, scope);
		writeConfigFile(configPath, DEFAULT_CONFIG);
		const config = refreshConfig(ctx);
		thresholdArmed = true;
		let message = `${formatScope(scope)} auto-compact config reset to enabled at ${formatPercent(DEFAULT_CONFIG.thresholdPercent)}.`;
		if (config.thresholdSource !== scope || config.thresholdPercent !== DEFAULT_CONFIG.thresholdPercent) {
			message += ` Effective threshold is ${formatPercent(config.thresholdPercent)} (${formatScope(config.thresholdSource)}).`;
		}
		notify(ctx, message, "info");
	}

	function updateLimits(contextWindow: number | undefined): void {
		if (!contextWindow || contextWindow <= 0 || contextWindow === cachedContextWindow) return;
		cachedContextWindow = contextWindow;
		recomputeCachedLimit();
	}

	function getUsage(ctx: ExtensionContext): UsageSnapshot {
		const usage = ctx.getContextUsage();
		updateLimits(usage?.contextWindow ?? ctx.model?.contextWindow ?? DEFAULT_CONTEXT_WINDOW);

		// Respect Pi's explicit unknown state after compaction. Reusing stale
		// pre-compaction tokens here causes repeated "Already compacted" attempts.
		const tokens = usage?.tokens ?? null;
		const thresholdPercent = cachedConfig?.thresholdPercent ?? DEFAULT_CONFIG.thresholdPercent;
		const thresholdSource = cachedConfig?.thresholdSource ?? "default";
		const percent = usage?.percent ?? (tokens === null ? null : (tokens / cachedContextWindow) * 100);
		return {
			tokens,
			contextWindow: cachedContextWindow,
			limit: cachedLimit,
			percent,
			thresholdPercent,
			thresholdSource,
		};
	}

	function autoContinueIfIdle(ctx: ExtensionContext, phase: AutoCompactPhase): void {
		setImmediate(() => {
			if (ctx.isIdle()) {
				pi.sendUserMessage(FOLLOW_UP_BY_PHASE[phase]);
			}
		});
	}

	function triggerCompaction(ctx: ExtensionContext, phase: AutoCompactPhase, usage: UsageSnapshot): boolean {
		if (pendingCompaction) return false;

		pendingCompaction = true;
		thresholdArmed = false;
		triggerCount += 1;
		lastTrigger = phase;
		notify(
			ctx,
			`Auto-compact started (${phase}; ${formatTokens(usage.tokens)} / ${formatTokens(usage.contextWindow)} tokens, threshold ${formatPercent(usage.thresholdPercent)} (${formatScope(usage.thresholdSource)})).`,
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
				if (/already compacted/i.test(message)) {
					notify(
						ctx,
						"Auto-compact skipped: session is already compacted. Will retry after usage drops below the threshold and crosses it again.",
						"warning",
					);
					if (phase === "pre-turn" || phase === "mid-turn") {
						autoContinueIfIdle(ctx, phase);
					}
					return;
				}
				notify(ctx, `Auto-compact failed: ${message}`, "error");
			},
		});

		return true;
	}

	function maybeTrigger(ctx: ExtensionContext, phase: AutoCompactPhase): boolean {
		if (pendingCompaction || !getConfig(ctx).enabled) return false;
		const usage = getUsage(ctx);
		if (usage.tokens === null) return false;
		if (usage.tokens < usage.limit) {
			thresholdArmed = true;
			return false;
		}
		if (!thresholdArmed) return false;
		return triggerCompaction(ctx, phase, usage);
	}

	pi.on("session_start", (event, ctx) => {
		pendingCompaction = false;
		thresholdArmed = true;
		refreshConfig(ctx);

		// If pi starts or resumes into an already-large session, compact before the
		// next user turn. Skip brand-new sessions because they have no useful history.
		if (event.reason !== "new") {
			maybeTrigger(ctx, "session-start");
		}
	});

	pi.on("model_select", (event) => {
		updateLimits(event.model?.contextWindow ?? DEFAULT_CONTEXT_WINDOW);
		thresholdArmed = true;
	});

	pi.on("session_compact", () => {
		pendingCompaction = false;
		thresholdArmed = false;
	});

	pi.on("turn_start", (_event, ctx) => {
		maybeTrigger(ctx, "pre-turn");
	});

	pi.on("turn_end", (event, ctx) => {
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
				const parsed = parseScopedThresholdArgs(rest);
				if (parsed.unexpected || parsed.thresholdPercent === undefined) {
					ctx.ui.notify(
						`Usage: /${COMMAND_NAME} threshold [--session|--project|--global] <${MIN_THRESHOLD_PERCENT}-${MAX_THRESHOLD_PERCENT}>`,
						"warning",
					);
					return;
				}
				setThresholdPercent(ctx, parsed.thresholdPercent, parsed.scope);
				return;
			}

			if (command === "reset") {
				const scope = parseScopedResetArgs(rest);
				if (!scope) {
					ctx.ui.notify(`Usage: /${COMMAND_NAME} reset [--session|--project|--global]`, "warning");
					return;
				}
				resetConfig(ctx, scope);
				return;
			}

			if (command === "status") {
				const config = refreshConfig(ctx);
				const usage = getUsage(ctx);
				const percent = usage.percent === null ? "unknown" : `${usage.percent.toFixed(1)}%`;
				ctx.ui.notify(
					`Auto Compact Status:\n` +
						`  Enabled: ${config.enabled ? "yes" : "no"} (${formatScope(config.enabledSource)})\n` +
						`  Effective threshold: ${formatPercent(config.thresholdPercent)} (${formatScope(config.thresholdSource)})\n` +
						`  Session threshold: ${formatOptionalPercent(config.sessionThresholdPercent)}\n` +
						`  Project threshold: ${formatOptionalPercent(config.projectThresholdPercent)}\n` +
						`  Global threshold: ${formatOptionalPercent(config.globalThresholdPercent)}\n` +
						`  Current tokens: ${formatTokens(usage.tokens)}\n` +
						`  Context window: ${formatTokens(usage.contextWindow)}\n` +
						`  Trigger at: ${formatTokens(usage.limit)} tokens\n` +
						`  Usage: ${percent}\n` +
						`  Pending: ${pendingCompaction}\n` +
						`  Armed: ${thresholdArmed}\n` +
						`  Trigger count: ${triggerCount}\n` +
						`  Last trigger: ${lastTrigger ?? "never"}\n` +
						`  Project config: ${config.projectConfigPath}${config.projectConfigExists ? "" : " (missing)"}\n` +
						`  Global config: ${config.globalConfigPath}${config.globalConfigExists ? "" : " (missing)"}\n` +
						`  Config for on/off: ${config.configPath}`,
					"info",
				);
				return;
			}

			ctx.ui.notify(
				`Usage: /${COMMAND_NAME} [on|off|status|threshold [--session|--project|--global] <percent>|reset [--session|--project|--global]]`,
				"warning",
			);
		},
	});
}

export const _test = {
	COMMAND_NAME,
	CONFIG_BASENAME,
	SESSION_CONFIG_CUSTOM_TYPE,
	DEFAULT_THRESHOLD_PERCENT,
	MIN_THRESHOLD_PERCENT,
	MAX_THRESHOLD_PERCENT,
	DEFAULT_CONTEXT_WINDOW,
	DEFAULT_CONFIG,
	DEFAULT_COMPACT_INSTRUCTIONS,
	getConfigPaths,
	readConfigFile,
	resolveAutoCompactConfig,
	readSessionThresholdPercent,
	parseThresholdPercent,
	parseScopeToken,
	parseScopedThresholdArgs,
	parseScopedResetArgs,
	formatPercent,
	formatTokens,
	hasToolCalls,
};
