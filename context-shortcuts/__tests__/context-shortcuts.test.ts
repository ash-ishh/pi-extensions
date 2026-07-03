import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import contextShortcuts, { _test } from "../extensions/context-shortcuts.js";
import {
	asExtensionAPI,
	createMockContext,
	createMockPi,
	createTempWorkspace,
	getRegisteredCommand,
	getRegisteredHandler,
} from "../../test/helpers/pi-extension-harness.js";

describe("context-shortcuts helpers", () => {
	it("detects shortcut tokens without treating paths or emails as shortcuts", () => {
		expect(_test.extractShortcutToken("use @proj")).toBe("proj");
		expect(_test.extractShortcutToken("use @")).toBe("");
		expect(_test.extractShortcutToken("src/@proj")).toBeUndefined();
		expect(_test.hasShortcutToken("use @project_context please")).toBe(true);
		expect(_test.hasShortcutToken("email me at a@example.com")).toBe(false);
		expect(_test.hasShortcutToken("open src/@generated/file.ts")).toBe(false);
	});

	it("normalizes configured shortcuts and resolves configured paths", () => {
		const baseDir = resolve("/tmp/context-shortcuts-base");
		expect(_test.resolveConfiguredPath("~/notes.md", baseDir, "/home/tester")).toBe("/home/tester/notes.md");
		expect(_test.resolveConfiguredPath("docs/notes.md", baseDir, "/home/tester")).toBe(
			join(baseDir, "docs/notes.md"),
		);

		expect(_test.normalizeShortcut("bad.name", "notes.md", baseDir, "project")).toBeNull();
		expect(_test.normalizeShortcut("disabled", false, baseDir, "project")).toBe("disabled");
		expect(_test.normalizeShortcut("empty", { path: "   " }, baseDir, "project")).toBeNull();
		expect(
			_test.normalizeShortcut(
				"docs",
				{ path: "a.md", paths: ["b.md", 42], description: "Docs" },
				baseDir,
				"project",
			),
		).toEqual({
			name: "docs",
			paths: [join(baseDir, "a.md"), join(baseDir, "b.md")],
			description: "Docs",
			source: "project",
		});
	});

	it("finds referenced shortcuts once and ignores unknown names", () => {
		const first = { name: "first", paths: ["/first.md"], source: "project" as const };
		const second = { name: "second", paths: ["/second.md"], source: "global" as const };
		const shortcuts = new Map([
			["first", first],
			["second", second],
		]);

		expect(_test.findReferencedShortcuts("@first @missing @first and @second", shortcuts)).toEqual([
			first,
			second,
		]);
		expect(_test.escapeAttribute('<tag name="x">&')).toBe("&lt;tag name=&quot;x&quot;&gt;&amp;");
	});
});

describe("context-shortcuts extension", () => {
	it("registers handlers and the context-shortcuts command", () => {
		const mockPi = createMockPi();
		contextShortcuts(asExtensionAPI(mockPi));

		expect(mockPi.commands.has("context-shortcuts")).toBe(true);
		expect(mockPi.handlers.has("session_start")).toBe(true);
		expect(mockPi.handlers.has("before_agent_start")).toBe(true);
	});

	it("expands referenced shortcuts into a hidden context message", () => {
		const { cwd, homeDir, cleanup } = createTempWorkspace("pi-context-shortcuts-");
		try {
			vi.stubEnv("HOME", homeDir);
			const contextFile = join(cwd, "project-context.md");
			const missingFile = join(cwd, "missing-context.md");
			writeFileSync(contextFile, "Project facts\n- use TypeScript\n", "utf-8");

			const { projectConfigPath } = _test.getConfigPaths(cwd, homeDir);
			mkdirSync(dirname(projectConfigPath), { recursive: true });
			writeFileSync(
				projectConfigPath,
				`${JSON.stringify(
					{
						shortcuts: {
							project_context: {
								path: contextFile,
								description: "Project context",
							},
							missing_context: missingFile,
						},
					},
					null,
					2,
				)}\n`,
				"utf-8",
			);

			const mockPi = createMockPi();
			contextShortcuts(asExtensionAPI(mockPi));
			const sessionStart = getRegisteredHandler(mockPi, "session_start");
			const beforeAgentStart = getRegisteredHandler(mockPi, "before_agent_start");
			const { ctx, ui } = createMockContext({ cwd });

			sessionStart({ type: "session_start" }, ctx);
			const result = beforeAgentStart(
				{ type: "before_agent_start", prompt: "Use @project_context and @missing_context now" },
				ctx,
			) as { message: { customType: string; content: string; display: boolean; details: Record<string, unknown> } };

			expect(result.message.customType).toBe("context-shortcuts");
			expect(result.message.display).toBe(false);
			expect(result.message.content).toContain('<shortcut name="@project_context" source="project">');
			expect(result.message.content).toContain("Project facts\n- use TypeScript");
			expect(result.message.content).toContain('<shortcut name="@missing_context" source="project">');
			expect(result.message.content).toContain('error="ENOENT');
			expect(result.message.details).toMatchObject({
				shortcuts: ["project_context", "missing_context"],
				files: [contextFile],
			});
			expect(ui.notify).toHaveBeenCalledWith(
				"Loaded context shortcuts: @project_context, @missing_context",
				"info",
			);
			expect(ui.notify.mock.calls.some(([message, level]) => {
				return level === "warning" && String(message).includes("missing_context");
			})).toBe(true);
		} finally {
			cleanup();
		}
	});

	it("lists merged shortcuts and lets project config disable global shortcuts", async () => {
		const { cwd, homeDir, cleanup } = createTempWorkspace("pi-context-shortcuts-");
		try {
			vi.stubEnv("HOME", homeDir);
			const { globalConfigPath, projectConfigPath } = _test.getConfigPaths(cwd, homeDir);
			mkdirSync(dirname(globalConfigPath), { recursive: true });
			mkdirSync(dirname(projectConfigPath), { recursive: true });
			writeFileSync(
				globalConfigPath,
				`${JSON.stringify(
					{
						shortcuts: {
							shared: "/global/shared.md",
							global_only: "/global/only.md",
						},
					},
					null,
					2,
				)}\n`,
				"utf-8",
			);
			writeFileSync(
				projectConfigPath,
				`${JSON.stringify(
					{
						shortcuts: {
							shared: false,
							project_only: "/project/only.md",
						},
					},
					null,
					2,
				)}\n`,
				"utf-8",
			);

			const mockPi = createMockPi();
			contextShortcuts(asExtensionAPI(mockPi));
			const command = getRegisteredCommand(mockPi, "context-shortcuts");
			const { ctx, ui } = createMockContext({ cwd });

			await command.handler("list", ctx);
			const message = String(ui.notify.mock.calls.at(-1)?.[0]);
			expect(message).toContain("@global_only (global)");
			expect(message).toContain("@project_only (project)");
			expect(message).not.toContain("@shared");
			expect(message).toContain(`global:  ${globalConfigPath}`);
			expect(message).toContain(`project: ${projectConfigPath}`);
		} finally {
			cleanup();
		}
	});

	it("adds autocomplete suggestions for configured shortcuts", async () => {
		const { cwd, homeDir, cleanup } = createTempWorkspace("pi-context-shortcuts-");
		try {
			vi.stubEnv("HOME", homeDir);
			const { projectConfigPath } = _test.getConfigPaths(cwd, homeDir);
			mkdirSync(dirname(projectConfigPath), { recursive: true });
			writeFileSync(
				projectConfigPath,
				`${JSON.stringify(
					{
						shortcuts: {
							project_context: {
								path: "/project/context.md",
								description: "Project context",
							},
						},
					},
					null,
					2,
				)}\n`,
				"utf-8",
			);

			const mockPi = createMockPi();
			contextShortcuts(asExtensionAPI(mockPi));
			const sessionStart = getRegisteredHandler(mockPi, "session_start");
			const { ctx, ui } = createMockContext({ cwd });

			sessionStart({ type: "session_start" }, ctx);
			expect(ui.addAutocompleteProvider).toHaveBeenCalledTimes(1);

			const wrapProvider = ui.addAutocompleteProvider.mock.calls[0][0];
			const fallback = {
				getSuggestions: vi.fn(async () => ({ prefix: "", items: [] })),
				applyCompletion: vi.fn(),
				shouldTriggerFileCompletion: vi.fn(() => true),
			};
			const provider = wrapProvider(fallback);
			const suggestions = await provider.getSuggestions(["Use @proj"], 0, "Use @proj".length, {});

			expect(suggestions).toEqual({
				prefix: "@proj",
				items: [
					{
						value: "@project_context",
						label: "@project_context",
						description: "Project context",
					},
				],
			});
			expect(fallback.getSuggestions).not.toHaveBeenCalled();
		} finally {
			cleanup();
		}
	});
});
