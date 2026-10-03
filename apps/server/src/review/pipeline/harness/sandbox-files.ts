import { lstat, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/** Safely read a sandbox file (stays inside the checkout, capped length). */
export async function readSandboxFile(sandboxPath: string, file: string, maxChars: number): Promise<string | null> {
	const root = resolve(sandboxPath);
	const resolved = resolve(join(sandboxPath, file));

	if (resolved !== root && !resolved.startsWith(root + '/')) return null;

	try {
		const info = await lstat(resolved);

		if (info.isSymbolicLink() || !info.isFile()) return null;

		const text = await readFile(resolved, 'utf8');

		return text.length > maxChars ? text.slice(0, maxChars) + '\n…[truncated]' : text;
	} catch {
		return null;
	}
}

/** Numbered line window around `center` (1-based), for discussion context. */
export async function readExcerpt(
	sandboxPath: string,
	file: string,
	center: number,
	radius = 40,
	maxChars = 8000
): Promise<string | null> {
	const text = await readSandboxFile(sandboxPath, file, maxChars * 4);

	if (text === null) return null;

	const lines = text.split('\n');
	const start = Math.max(0, center - radius - 1);
	const excerpt = lines.slice(start, center + radius).join('\n');

	const numbered = excerpt
		.split('\n')
		.map((content, i) => `${start + i + 1}: ${content}`)
		.join('\n');

	return numbered.length > maxChars ? numbered.slice(0, maxChars) + '\n…[truncated]' : numbered;
}
