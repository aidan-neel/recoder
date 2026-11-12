import { afterAll, beforeAll } from 'bun:test';

/** Runs the file's tests with `name` set to `value`, restoring whatever it held before the file ran. */
export function envFlag(name: string, value: string): void {
	const original = process.env[name];

	beforeAll(() => {
		process.env[name] = value;
	});

	afterAll(() => {
		if (original === undefined) delete process.env[name];
		else process.env[name] = original;
	});
}
