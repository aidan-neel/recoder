import { afterEach } from 'bun:test';

/** Puts each of `keys` back as it was before the calling file's tests, after each one. */
export function restoreEnvAfterEach(keys: string[]): void {
	const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

	afterEach(() => {
		for (const key of keys) {
			if (original[key] === undefined) delete process.env[key];
			else process.env[key] = original[key];
		}
	});
}
