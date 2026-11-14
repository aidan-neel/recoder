import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The files under `directory` (the data folder, its database and journal included) whose bytes hold `text`. A secret
 * that is saved properly appears in none of them.
 */
export function filesHolding(directory: string, text: string): string[] {
	const needle = Buffer.from(text);

	return readdirSync(directory, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => join(entry.parentPath, entry.name))
		.filter((file) => readFileSync(file).includes(needle));
}
