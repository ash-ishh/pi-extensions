import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import autoCompact, { _test } from "../extensions/auto-compact.js";
import {
	asExtensionAPI,
	createMockContext,
	createMockPi,
	createTempWorkspace,
	flushImmediate,
	getRegisteredCommand,
	getRegisteredHandler,
} from "../../test/helpers/pi-extension-harness.js";

function assistantToolUseMessage(): unknown {
	return {
		role: "assistant",
		content: [
			{
				type: "tool_use",
				name: "read",
				input: {},
			},
		],
	};
}

describe("auto-compact helpers", () => {
	it("parses and formats thresholds and usage values", () => {
		expect(_test.parseThresholdPercent("60")).toBe(60);
		expect(_test.parseThresholdPercent("60.55%")).toBe(60.6);
		expect(_test.parseThresholdPercent("0")).toBeUndefined();
		expect(_test.parseThresholdPercent("96")).toBeUndefined();
		expect(_test.parseThresholdPercent("abc")).toBeUndefined();
		expect(_test.formatPercent(60)).toBe("60%");
		expect(_test.formatPercent(60.5)).toBe("60.5%");
		expect(_test.formatTokens(null)).toBe("unknown");
		expect(_test.formatTokens(999)).toBe("999");
		expect(_test.formatTokens(1_200)).toBe("1K");
		expect(_test.formatTokens(1_250_000)).toBe("1.25M");
	});

	it("detects assistant tool-use messages", () => {
		expect(_test.hasToolCalls(assistantToolUseMessage())).toBe(true);
		expect(_test.hasToolCalls({ role: "assistant", content: [{ type: "text", text: "done" }] })).toBe(false);
		expect(_test.hasToolCalls({ role: "user", content: [{ type: "tool_use" }] })).toBe(false);
		expect(_test.hasToolCalls(undefined)).toBe(false);
	});

	it("writes a default config and resolves project overrides", () => {
		const { cwd, homeDir, cleanup } = createTempWorkspace("pi-auto-compact-");
		try {
			const defaultConfig = _test.resolveAutoCompactConfig(cwd, homeDir);
			expect(defaultConfig).toMatchObject({
				enabled: true,
				enabledSource: "default",
				thresholdPercent: 60,
				thresholdSource: "default",
				globalConfigExists: false,
				projectConfigExists: false,
			});

			const { projectConfigPath, globalConfigPath } = _test.getConfigPaths(cwd, homeDir);
			expect(_test.readConfigFile(globalConfigPath)).toBeNull();

			mkdirSync(dirname(projectConfigPath), { recursive: true });
			writeFileSync(projectConfigPath, `${JSON.stringify({ enabled: false, thresholdPercent: 75 }, null, 2)}\n`);

			const overriddenConfig = _test.resolveAutoCompactConfig(cwd, homeDir);
			expect(overriddenConfig).toMatchObject({
				configPath: projectConfigPath,
				enabled: false,
				thresholdPercent: 75,
			});
		} finally {
			cleanup();
		}
	});
});

describe("auto-compact extension", () => {
	it("registers handlers and the auto-compact command", () => {
		const mockPi = createMockPi();
		autoCompact(asExtensionAPI(mockPi));

		expect(mockPi.commands.has("auto-compact")).toBe(true);
		expect(mockPi.handlers.has("session_start")).toBe(true);
		expect(mockPi.handlers.has("model_select")).toBe(true);
		expect(mockPi.handlers.has("session_compact")).toBe(true);
		expect(mockPi.handlers.has("turn_start")).toBe(true);
		expect(mockPi.handlers.has("turn_end")).toBe(true);
	});

	it("compacts on a pre-turn threshold crossing and re-arms only after usage drops below the threshold", async () => {
		const { cwd, homeDir, cleanup } = createTempWorkspace("pi-auto-compact-");
		try {
			vi.stubEnv("HOME", homeDir);
			let usage = { tokens: 130, contextWindow: 200, percent: 65 };
			const mockPi = createMockPi();
			autoCompact(asExtensionAPI(mockPi));

			const sessionStart = getRegisteredHandler(mockPi, "session_start");
			const turnStart = getRegisteredHandler(mockPi, "turn_start");
			const { ctx, ui, compact } = createMockContext({
				cwd,
				contextUsage: () => usage,
				model: { provider: "openai", id: "gpt-5.5", contextWindow: 200 } as ExtensionContext["model"],
			});

			sessionStart({ type: "session_start", reason: "new" }, ctx);
			turnStart({ type: "turn_start" }, ctx);

			expect(compact).toHaveBeenCalledTimes(1);
			expect(compact.mock.calls[0][0]).toMatchObject({
				customInstructions: _test.DEFAULT_COMPACT_INSTRUCTIONS,
			});
			expect(ui.notify).toHaveBeenCalledWith(
				"Auto-compact started (pre-turn; 130 / 200 tokens, threshold 60% (default)).",
				"info",
			);

			compact.mock.calls[0][0].onComplete();
			await flushImmediate();
			expect(ui.notify).toHaveBeenCalledWith("Auto-compact completed.", "info");
			expect(mockPi.sendUserMessage).toHaveBeenCalledWith(
				"Auto-compact ran before this turn. Continue with the current user request.",
			);

			turnStart({ type: "turn_start" }, ctx);
			expect(compact).toHaveBeenCalledTimes(1);

			usage = { tokens: 100, contextWindow: 200, percent: 50 };
			turnStart({ type: "turn_start" }, ctx);
			expect(compact).toHaveBeenCalledTimes(1);

			usage = { tokens: 121, contextWindow: 200, percent: 60.5 };
			turnStart({ type: "turn_start" }, ctx);
			expect(compact).toHaveBeenCalledTimes(2);
		} finally {
			cleanup();
		}
	});

	it("triggers mid-turn only when the assistant just requested tools", () => {
		const { cwd, homeDir, cleanup } = createTempWorkspace("pi-auto-compact-");
		try {
			vi.stubEnv("HOME", homeDir);
			const mockPi = createMockPi();
			autoCompact(asExtensionAPI(mockPi));

			const sessionStart = getRegisteredHandler(mockPi, "session_start");
			const turnEnd = getRegisteredHandler(mockPi, "turn_end");
			const { ctx, compact } = createMockContext({
				cwd,
				contextUsage: { tokens: 130, contextWindow: 200, percent: 65 },
			});

			sessionStart({ type: "session_start", reason: "new" }, ctx);
			turnEnd({ type: "turn_end", message: { role: "assistant", content: [{ type: "text", text: "done" }] } }, ctx);
			expect(compact).not.toHaveBeenCalled();

			turnEnd({ type: "turn_end", message: assistantToolUseMessage() }, ctx);
			expect(compact).toHaveBeenCalledTimes(1);
			expect(compact.mock.calls[0][0]).toMatchObject({
				customInstructions: _test.DEFAULT_COMPACT_INSTRUCTIONS,
			});
		} finally {
			cleanup();
		}
	});

	it("does not compact when disabled or when token usage is unknown", async () => {
		const { cwd, homeDir, cleanup } = createTempWorkspace("pi-auto-compact-");
		try {
			vi.stubEnv("HOME", homeDir);
			const { globalConfigPath } = _test.getConfigPaths(cwd, homeDir);
			mkdirSync(dirname(globalConfigPath), { recursive: true });
			writeFileSync(globalConfigPath, `${JSON.stringify({ enabled: false, thresholdPercent: 60 }, null, 2)}\n`);

			const mockPi = createMockPi();
			autoCompact(asExtensionAPI(mockPi));
			const sessionStart = getRegisteredHandler(mockPi, "session_start");
			const turnStart = getRegisteredHandler(mockPi, "turn_start");
			const command = getRegisteredCommand(mockPi, "auto-compact");
			let usage: unknown = { tokens: 130, contextWindow: 200, percent: 65 };
			const { ctx, compact } = createMockContext({ cwd, contextUsage: () => usage });

			sessionStart({ type: "session_start", reason: "new" }, ctx);
			turnStart({ type: "turn_start" }, ctx);
			expect(compact).not.toHaveBeenCalled();

			await command.handler("on", ctx);
			usage = { tokens: undefined, contextWindow: 200, percent: undefined };
			turnStart({ type: "turn_start" }, ctx);
			expect(compact).not.toHaveBeenCalled();
		} finally {
			cleanup();
		}
	});

	it("supports command-driven config changes and status output", async () => {
		const { cwd, homeDir, cleanup } = createTempWorkspace("pi-auto-compact-");
		try {
			vi.stubEnv("HOME", homeDir);
			const mockPi = createMockPi();
			autoCompact(asExtensionAPI(mockPi));
			const sessionStart = getRegisteredHandler(mockPi, "session_start");
			const modelSelect = getRegisteredHandler(mockPi, "model_select");
			const command = getRegisteredCommand(mockPi, "auto-compact");
			const { ctx, ui } = createMockContext({
				cwd,
				contextUsage: { tokens: 70, contextWindow: 200, percent: 35 },
			});

			sessionStart({ type: "session_start", reason: "new" }, ctx);
			modelSelect({ type: "model_select", model: { contextWindow: 200 } }, ctx);
			const { globalConfigPath } = _test.getConfigPaths(cwd, homeDir);

			await command.handler("off", ctx);
			expect(_test.readConfigFile(globalConfigPath)?.enabled).toBe(false);
			expect(ui.notify).toHaveBeenLastCalledWith("Auto-compact is now disabled.", "info");

			await command.handler("threshold --global 75%", ctx);
			expect(_test.readConfigFile(globalConfigPath)?.thresholdPercent).toBe(75);
			expect(ui.notify).toHaveBeenLastCalledWith(
				"global auto-compact threshold set to 75% (150 tokens for current model).",
				"info",
			);

			await command.handler("threshold nope", ctx);
			expect(ui.notify).toHaveBeenLastCalledWith(
				"Usage: /auto-compact threshold [--session|--project|--global] <1-95>",
				"warning",
			);

			await command.handler("status", ctx);
			expect(ui.notify.mock.calls.at(-1)?.[0]).toContain("Auto Compact Status:");
			expect(ui.notify.mock.calls.at(-1)?.[0]).toContain("Effective threshold: 75% (global)");

			await command.handler("reset --global", ctx);
			expect(JSON.parse(readFileSync(globalConfigPath, "utf-8"))).toEqual(_test.DEFAULT_CONFIG);
			expect(ui.notify).toHaveBeenLastCalledWith(
				"global auto-compact config reset to enabled at 60%.",
				"info",
			);
		} finally {
			cleanup();
		}
	});
});
