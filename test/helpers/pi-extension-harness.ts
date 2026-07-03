import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	RegisteredCommand,
} from "@earendil-works/pi-coding-agent";
import { vi } from "vitest";

type RegisteredFlag = {
	description?: string;
	type: "boolean" | "string";
	default?: boolean | string;
};

type RegisteredHandlers = Map<string, (event: unknown, ctx: ExtensionContext) => unknown>;

export type MockPi = {
	commands: Map<string, Omit<RegisteredCommand, "name">>;
	flags: Map<string, RegisteredFlag>;
	handlers: RegisteredHandlers;
	appendEntry: ReturnType<typeof vi.fn>;
	getFlag: ReturnType<typeof vi.fn>;
	registerCommand: ReturnType<typeof vi.fn>;
	registerFlag: ReturnType<typeof vi.fn>;
	on: ReturnType<typeof vi.fn>;
	sendUserMessage: ReturnType<typeof vi.fn>;
};

export type MockUi = {
	notify: ReturnType<typeof vi.fn>;
	setStatus: ReturnType<typeof vi.fn>;
	addAutocompleteProvider: ReturnType<typeof vi.fn>;
	theme: {
		fg: (color: string, text: string) => string;
	};
};

export type MockContextOptions = {
	cwd?: string;
	hasUI?: boolean;
	model?: ExtensionContext["model"];
	branch?: unknown[];
	contextUsage?: unknown | (() => unknown);
	isIdle?: boolean | (() => boolean);
};

export function createMockPi(flags: Record<string, unknown> = {}): MockPi {
	const commands = new Map<string, Omit<RegisteredCommand, "name">>();
	const registeredFlags = new Map<string, RegisteredFlag>();
	const handlers: RegisteredHandlers = new Map();

	return {
		commands,
		flags: registeredFlags,
		handlers,
		appendEntry: vi.fn(),
		getFlag: vi.fn((name: string) => flags[name]),
		registerCommand: vi.fn((name: string, options: Omit<RegisteredCommand, "name">) => {
			commands.set(name, options);
		}),
		registerFlag: vi.fn((name: string, options: RegisteredFlag) => {
			registeredFlags.set(name, options);
		}),
		on: vi.fn((eventName: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) => {
			handlers.set(eventName, handler);
		}),
		sendUserMessage: vi.fn(),
	};
}

export function createMockContext(options: MockContextOptions = {}): {
	ctx: ExtensionCommandContext;
	ui: MockUi;
	compact: ReturnType<typeof vi.fn>;
	getContextUsage: ReturnType<typeof vi.fn>;
	isIdle: ReturnType<typeof vi.fn>;
} {
	const ui: MockUi = {
		notify: vi.fn(),
		setStatus: vi.fn(),
		addAutocompleteProvider: vi.fn(),
		theme: {
			fg: (color, text) => `${color}:${text}`,
		},
	};

	const getContextUsage = vi.fn(() => {
		if (typeof options.contextUsage === "function") {
			return options.contextUsage();
		}
		return options.contextUsage;
	});
	const isIdle = vi.fn(() => {
		if (typeof options.isIdle === "function") {
			return options.isIdle();
		}
		return options.isIdle ?? true;
	});
	const compact = vi.fn();

	const ctx = {
		hasUI: options.hasUI ?? true,
		cwd: options.cwd ?? process.cwd(),
		model: options.model,
		ui,
		sessionManager: {
			getBranch: vi.fn(() => options.branch ?? []),
			getEntries: vi.fn(() => options.branch ?? []),
		},
		modelRegistry: {},
		isIdle,
		abort: vi.fn(),
		hasPendingMessages: vi.fn(() => false),
		shutdown: vi.fn(),
		getContextUsage,
		compact,
		getSystemPrompt: vi.fn(() => ""),
		waitForIdle: vi.fn(async () => undefined),
		newSession: vi.fn(async () => ({ cancelled: false })),
		fork: vi.fn(async () => ({ cancelled: false })),
		navigateTree: vi.fn(async () => ({ cancelled: false })),
		switchSession: vi.fn(async () => ({ cancelled: false })),
		reload: vi.fn(async () => undefined),
	} as unknown as ExtensionCommandContext;

	return { ctx, ui, compact, getContextUsage, isIdle };
}

export function getRegisteredCommand(mockPi: MockPi, name: string): Omit<RegisteredCommand, "name"> {
	const command = mockPi.commands.get(name);
	if (!command) {
		throw new Error(`Missing command: ${name}`);
	}
	return command;
}

export function getRegisteredHandler(
	mockPi: MockPi,
	eventName: string,
): (event: unknown, ctx: ExtensionContext) => unknown {
	const handler = mockPi.handlers.get(eventName);
	if (!handler) {
		throw new Error(`Missing handler: ${eventName}`);
	}
	return handler;
}

export function createTempWorkspace(prefix = "pi-extension-"): {
	root: string;
	cwd: string;
	homeDir: string;
	cleanup: () => void;
} {
	const root = mkdtempSync(join(tmpdir(), prefix));
	const cwd = join(root, "workspace");
	const homeDir = join(root, "home");
	mkdirSync(cwd, { recursive: true });
	mkdirSync(homeDir, { recursive: true });

	return {
		root,
		cwd,
		homeDir,
		cleanup: () => {
			vi.unstubAllEnvs();
			rmSync(root, { recursive: true, force: true });
		},
	};
}

export function flushImmediate(): Promise<void> {
	return new Promise((resolve) => {
		setImmediate(resolve);
	});
}

export function asExtensionAPI(mockPi: MockPi): ExtensionAPI {
	return mockPi as unknown as ExtensionAPI;
}
