import { describe, expect, it, vi } from "vitest";
import queryTimeFooter from "../extensions/query-time-footer.js";
import {
	asExtensionAPI,
	createMockContext,
	createMockPi,
	getRegisteredCommand,
	getRegisteredHandler,
} from "../../test/helpers/pi-extension-harness.js";

describe("query-time-footer", () => {
	it("registers lifecycle handlers and the query-time command", () => {
		const mockPi = createMockPi();
		queryTimeFooter(asExtensionAPI(mockPi));

		expect(mockPi.commands.has("query-time")).toBe(true);
		expect(mockPi.handlers.has("session_start")).toBe(true);
		expect(mockPi.handlers.has("agent_start")).toBe(true);
		expect(mockPi.handlers.has("agent_end")).toBe(true);
	});

	it("updates the footer from idle to running to completed duration", async () => {
		vi.useFakeTimers();
		try {
			const mockPi = createMockPi();
			queryTimeFooter(asExtensionAPI(mockPi));

			const sessionStart = getRegisteredHandler(mockPi, "session_start");
			const agentStart = getRegisteredHandler(mockPi, "agent_start");
			const agentEnd = getRegisteredHandler(mockPi, "agent_end");
			const command = getRegisteredCommand(mockPi, "query-time");
			const { ctx, ui } = createMockContext();

			sessionStart({ type: "session_start" }, ctx);
			expect(ui.setStatus).toHaveBeenLastCalledWith("query-time-footer", "accent:#0dim: query time: —");

			vi.setSystemTime(1_000);
			agentStart({ type: "agent_start" }, ctx);
			expect(ui.setStatus).toHaveBeenLastCalledWith(
				"query-time-footer",
				"accent:●dim: query #1 running...",
			);

			vi.setSystemTime(2_500);
			agentEnd({ type: "agent_end" }, ctx);
			expect(ui.setStatus).toHaveBeenLastCalledWith("query-time-footer", "accent:#1dim: query time: 1.50s");

			await command.handler("", ctx);
			expect(ui.notify).toHaveBeenCalledWith("Last query took 1.50s", "info");
		} finally {
			vi.useRealTimers();
		}
	});

	it("reports when no query has completed", async () => {
		const mockPi = createMockPi();
		queryTimeFooter(asExtensionAPI(mockPi));

		const command = getRegisteredCommand(mockPi, "query-time");
		const { ctx, ui } = createMockContext();

		await command.handler("", ctx);
		expect(ui.notify).toHaveBeenCalledWith("No query has completed yet", "info");
	});

	it("tolerates headless lifecycle events", () => {
		const mockPi = createMockPi();
		queryTimeFooter(asExtensionAPI(mockPi));

		const sessionStart = getRegisteredHandler(mockPi, "session_start");
		const agentStart = getRegisteredHandler(mockPi, "agent_start");
		const agentEnd = getRegisteredHandler(mockPi, "agent_end");
		const { ctx, ui } = createMockContext({ hasUI: false });

		sessionStart({ type: "session_start" }, ctx);
		agentStart({ type: "agent_start" }, ctx);
		agentEnd({ type: "agent_end" }, ctx);
		expect(ui.setStatus).not.toHaveBeenCalled();
	});
});
