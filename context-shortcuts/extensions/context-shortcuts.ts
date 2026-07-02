import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const COMMAND_NAME = "context-shortcuts";
const CONFIG_BASENAME = "context-shortcuts.json";
const MAX_CONTEXT_FILE_BYTES = 500 * 1024;

const DEFAULT_SHORTCUTS = {
	project_context: {
		enabled: false,
		path: "~/context/project-context.md",
		description: "Example project context file. Set enabled to true and update this path.",
	},
} as const;

type ShortcutSource = "default" | "global" | "project";

type ShortcutConfigValue =
	| string
	| null
	| false
	| {
		path?: unknown;
		paths?: unknown;
		description?: unknown;
		enabled?: unknown;
	};

interface ShortcutConfigFile {
	shortcuts?: Record<string, ShortcutConfigValue>;
}

interface ResolvedShortcut {
	name: string;
	paths: string[];
	description?: string;
	source: ShortcutSource;
}

interface ShortcutExpansion {
	content: string;
	names: string[];
	files: string[];
	errors: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidShortcutName(name: string): boolean {
	return /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name);
}

function getConfigCwd(ctx: ExtensionContext): string {
	return ctx.cwd || process.cwd();
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

function expandHomePath(filePath: string, homeDir: string = homedir()): string {
	if (filePath === "~") return homeDir;
	if (filePath.startsWith("~/")) return join(homeDir, filePath.slice(2));
	return filePath;
}

function resolveConfiguredPath(filePath: string, baseDir: string, homeDir: string = homedir()): string {
	const expanded = expandHomePath(filePath, homeDir);
	return isAbsolute(expanded) ? expanded : resolve(baseDir, expanded);
}

function readConfigFile(filePath: string): ShortcutConfigFile | null {
	if (!existsSync(filePath)) return null;
	try {
		const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
		if (!isRecord(parsed)) return {};
		if (!isRecord(parsed.shortcuts)) return {};
		return { shortcuts: parsed.shortcuts as Record<string, ShortcutConfigValue> };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.warn(`[context-shortcuts] Failed to read ${filePath}: ${message}`);
		return null;
	}
}

function normalizeShortcut(
	name: string,
	value: ShortcutConfigValue,
	baseDir: string,
	source: ShortcutSource,
): ResolvedShortcut | null | "disabled" {
	if (!isValidShortcutName(name)) return null;
	if (value === null || value === false) return "disabled";

	let rawPaths: string[] = [];
	let description: string | undefined;

	if (typeof value === "string") {
		rawPaths = [value];
	} else if (isRecord(value)) {
		if (value.enabled === false) return "disabled";
		if (typeof value.description === "string") description = value.description;
		if (typeof value.path === "string") rawPaths.push(value.path);
		if (Array.isArray(value.paths)) {
			rawPaths.push(...value.paths.filter((entry): entry is string => typeof entry === "string"));
		}
	}

	const paths = rawPaths
		.map((path) => path.trim())
		.filter(Boolean)
		.map((path) => resolveConfiguredPath(path, baseDir));

	if (paths.length === 0) return null;
	return { name, paths, description, source };
}

function mergeConfigShortcuts(
	shortcuts: Map<string, ResolvedShortcut>,
	config: ShortcutConfigFile | null,
	baseDir: string,
	source: ShortcutSource,
): void {
	if (!config?.shortcuts) return;
	for (const [name, value] of Object.entries(config.shortcuts)) {
		const normalized = normalizeShortcut(name, value, baseDir, source);
		if (normalized === "disabled") {
			shortcuts.delete(name);
			continue;
		}
		if (normalized) shortcuts.set(name, normalized);
	}
}

function loadShortcuts(ctx: ExtensionContext): {
	shortcuts: Map<string, ResolvedShortcut>;
	projectConfigPath: string;
	globalConfigPath: string;
} {
	const cwd = getConfigCwd(ctx);
	const { projectConfigPath, globalConfigPath } = getConfigPaths(cwd);
	const shortcuts = new Map<string, ResolvedShortcut>();

	mergeConfigShortcuts(shortcuts, { shortcuts: DEFAULT_SHORTCUTS }, dirname(globalConfigPath), "default");
	mergeConfigShortcuts(shortcuts, readConfigFile(globalConfigPath), dirname(globalConfigPath), "global");
	mergeConfigShortcuts(shortcuts, readConfigFile(projectConfigPath), dirname(projectConfigPath), "project");

	return { shortcuts, projectConfigPath, globalConfigPath };
}

function ensureDefaultConfigFile(ctx: ExtensionContext): void {
	const { globalConfigPath } = getConfigPaths(getConfigCwd(ctx));
	if (existsSync(globalConfigPath)) return;
	try {
		mkdirSync(dirname(globalConfigPath), { recursive: true });
		writeFileSync(
			globalConfigPath,
			`${JSON.stringify({ shortcuts: DEFAULT_SHORTCUTS }, null, 2)}\n`,
			"utf-8",
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.warn(`[context-shortcuts] Failed to write ${globalConfigPath}: ${message}`);
	}
}

function extractShortcutToken(textBeforeCursor: string): string | undefined {
	const match = textBeforeCursor.match(/(?:^|[^\w./~-])@([A-Za-z0-9_-]*)$/);
	return match?.[1];
}

function findReferencedShortcuts(text: string, shortcuts: Map<string, ResolvedShortcut>): ResolvedShortcut[] {
	const found = new Map<string, ResolvedShortcut>();
	const tokenRegex = /(^|[^\w./~-])@([A-Za-z0-9][A-Za-z0-9_-]*)(?![\w./-])/g;
	let match: RegExpExecArray | null;
	while ((match = tokenRegex.exec(text)) !== null) {
		const name = match[2];
		const shortcut = shortcuts.get(name);
		if (shortcut) found.set(name, shortcut);
	}
	return [...found.values()];
}

function escapeAttribute(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll('"', "&quot;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

function readShortcutFile(shortcut: ResolvedShortcut, filePath: string): {
	text: string;
	file?: string;
	error?: string;
} {
	try {
		const stats = statSync(filePath);
		if (stats.isDirectory()) {
			return { text: `<file name="${escapeAttribute(filePath)}" error="is a directory"></file>`, error: `${shortcut.name}: ${filePath} is a directory` };
		}

		const buffer = readFileSync(filePath);
		const truncated = buffer.byteLength > MAX_CONTEXT_FILE_BYTES;
		const content = buffer.subarray(0, MAX_CONTEXT_FILE_BYTES).toString("utf-8");
		const note = truncated
			? `\n\n[context-shortcuts: truncated ${filePath} at ${MAX_CONTEXT_FILE_BYTES} bytes]`
			: "";
		return {
			text: `<file name="${escapeAttribute(filePath)}">\n${content}${note}\n</file>`,
			file: filePath,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			text: `<file name="${escapeAttribute(filePath)}" error="${escapeAttribute(message)}"></file>`,
			error: `${shortcut.name}: ${filePath}: ${message}`,
		};
	}
}

function buildShortcutExpansion(references: ResolvedShortcut[]): ShortcutExpansion | undefined {
	if (references.length === 0) return undefined;

	const lines: string[] = ["<context-shortcuts>"];
	const names: string[] = [];
	const files: string[] = [];
	const errors: string[] = [];

	for (const shortcut of references) {
		names.push(shortcut.name);
		lines.push(`<shortcut name="@${escapeAttribute(shortcut.name)}" source="${shortcut.source}">`);
		if (shortcut.description) {
			lines.push(`<description>${shortcut.description}</description>`);
		}
		for (const filePath of shortcut.paths) {
			const result = readShortcutFile(shortcut, filePath);
			lines.push(result.text);
			if (result.file) files.push(result.file);
			if (result.error) errors.push(result.error);
		}
		lines.push("</shortcut>");
	}

	lines.push("</context-shortcuts>");
	return { content: lines.join("\n"), names, files, errors };
}

function expandShortcutsForText(text: string, ctx: ExtensionContext): ShortcutExpansion | undefined {
	const { shortcuts } = loadShortcuts(ctx);
	const references = findReferencedShortcuts(text, shortcuts);
	return buildShortcutExpansion(references);
}

function notifyExpansion(ctx: ExtensionContext, expansion: ShortcutExpansion): void {
	if (!ctx.hasUI) return;
	if (expansion.files.length > 0) {
		ctx.ui.notify(
			`Loaded context shortcut${expansion.names.length === 1 ? "" : "s"}: ${expansion.names.map((name) => `@${name}`).join(", ")}`,
			"info",
		);
	}
	for (const error of expansion.errors) {
		ctx.ui.notify(`Context shortcut warning: ${error}`, "warning");
	}
}

function formatShortcutList(ctx: ExtensionContext): string {
	const { shortcuts, globalConfigPath, projectConfigPath } = loadShortcuts(ctx);
	const rows = [...shortcuts.values()]
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((shortcut) => {
			const description = shortcut.description ? ` — ${shortcut.description}` : "";
			return `@${shortcut.name} (${shortcut.source})${description}\n  ${shortcut.paths.join("\n  ")}`;
		});

	return [
		"Context shortcuts:",
		...(rows.length > 0 ? rows : ["(none)"]),
		"",
		"Config files:",
		`global:  ${globalConfigPath}`,
		`project: ${projectConfigPath}`,
		"",
		"Use @shortcut_name in any prompt. Values are loaded into hidden context before the model runs.",
	].join("\n");
}

function createAliasItems(shortcuts: Map<string, ResolvedShortcut>, query: string) {
	const normalizedQuery = query.toLowerCase();
	return [...shortcuts.values()]
		.filter((shortcut) => {
			if (!normalizedQuery) return true;
			return shortcut.name.toLowerCase().includes(normalizedQuery)
				|| shortcut.description?.toLowerCase().includes(normalizedQuery);
		})
		.sort((a, b) => a.name.localeCompare(b.name))
		.slice(0, 20)
		.map((shortcut) => ({
			value: `@${shortcut.name}`,
			label: `@${shortcut.name}`,
			description: shortcut.description ?? shortcut.paths.join(", "),
		}));
}

export default function contextShortcuts(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		ensureDefaultConfigFile(ctx);
		ctx.ui.addAutocompleteProvider((current) => ({
			async getSuggestions(lines, cursorLine, cursorCol, options) {
				const currentLine = lines[cursorLine] ?? "";
				const textBeforeCursor = currentLine.slice(0, cursorCol);
				const token = extractShortcutToken(textBeforeCursor);
				if (token === undefined) {
					return current.getSuggestions(lines, cursorLine, cursorCol, options);
				}

				const { shortcuts } = loadShortcuts(ctx);
				const items = createAliasItems(shortcuts, token);
				if (items.length === 0) {
					return current.getSuggestions(lines, cursorLine, cursorCol, options);
				}

				return { prefix: `@${token}`, items };
			},

			applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
				return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
			},

			shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
				return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
			},
		}));
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const expansion = expandShortcutsForText(event.prompt, ctx);
		if (!expansion) return undefined;
		notifyExpansion(ctx, expansion);
		return {
			message: {
				customType: "context-shortcuts",
				content: expansion.content,
				display: false,
				details: {
					shortcuts: expansion.names,
					files: expansion.files,
					errors: expansion.errors,
				},
			},
		};
	});

	pi.registerCommand(COMMAND_NAME, {
		description: "List configured @context shortcuts",
		getArgumentCompletions: (prefix) => {
			const commands = ["list"];
			const items = commands.filter((value) => value.startsWith(prefix)).map((value) => ({ value }));
			return items.length > 0 ? items : null;
		},
		handler: async (_args, ctx) => {
			ensureDefaultConfigFile(ctx);
			ctx.ui.notify(formatShortcutList(ctx), "info");
		},
	});
}

export const _test = {
	CONFIG_BASENAME,
	DEFAULT_SHORTCUTS,
	MAX_CONTEXT_FILE_BYTES,
	escapeAttribute,
	extractShortcutToken,
	findReferencedShortcuts,
	getConfigPaths,
	normalizeShortcut,
	resolveConfiguredPath,
};
