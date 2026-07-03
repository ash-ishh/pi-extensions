import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { asExtensionAPI, createMockPi } from "../test/helpers/pi-extension-harness.js";

type PackageJson = {
	name?: string;
	pi?: {
		extensions?: string[];
	};
};

function readPackageJson(filePath: string): PackageJson {
	return JSON.parse(readFileSync(filePath, "utf-8")) as PackageJson;
}

function getExtensionPaths(packagePath: string): string[] {
	const packageJson = readPackageJson(packagePath);
	return packageJson.pi?.extensions?.map((extensionPath) => resolve(dirname(packagePath), extensionPath)) ?? [];
}

describe("package manifests", () => {
	it("points every root extension entry at an existing file that can be imported", async () => {
		const extensionPaths = getExtensionPaths(resolve("package.json"));
		expect(extensionPaths.length).toBeGreaterThan(0);

		for (const extensionPath of extensionPaths) {
			expect(existsSync(extensionPath), extensionPath).toBe(true);
			const module = await import(pathToFileURL(extensionPath).href);
			expect(typeof module.default, extensionPath).toBe("function");
		}
	});

	it("keeps subpackage extension entries valid", () => {
		const packagePaths = readdirSync(resolve("."), { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => join(entry.name, "package.json"))
			.filter((packagePath) => existsSync(packagePath));

		expect(packagePaths.length).toBeGreaterThan(0);
		for (const packagePath of packagePaths) {
			const extensionPaths = getExtensionPaths(resolve(packagePath));
			expect(extensionPaths.length, packagePath).toBeGreaterThan(0);
			for (const extensionPath of extensionPaths) {
				expect(existsSync(extensionPath), `${packagePath}: ${extensionPath}`).toBe(true);
			}
		}
	});

	it("does not register duplicate command or flag names across extensions", async () => {
		const extensionPaths = getExtensionPaths(resolve("package.json"));
		const commandOwners = new Map<string, string>();
		const flagOwners = new Map<string, string>();

		for (const extensionPath of extensionPaths) {
			const module = await import(pathToFileURL(extensionPath).href);
			const mockPi = createMockPi();
			module.default(asExtensionAPI(mockPi));

			for (const name of mockPi.commands.keys()) {
				expect(commandOwners.has(name), `${name} registered by ${extensionPath} and ${commandOwners.get(name)}`).toBe(false);
				commandOwners.set(name, extensionPath);
			}
			for (const name of mockPi.flags.keys()) {
				expect(flagOwners.has(name), `${name} registered by ${extensionPath} and ${flagOwners.get(name)}`).toBe(false);
				flagOwners.set(name, extensionPath);
			}
		}

		expect([...commandOwners.keys()].sort()).toEqual(["auto-compact", "context-shortcuts", "fast", "query-time"]);
		expect([...flagOwners.keys()]).toEqual(["fast"]);
	});
});
