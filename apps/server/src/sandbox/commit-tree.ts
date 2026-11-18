import { packageManifests, type GitText } from './install-inputs.js';

/** The head commit's tracked files, read from git; nothing in the checkout runs. */
export interface CommitTree {
	/** Every tracked file's path and size in bytes. */
	sizes: Map<string, number>;
	/** A tracked file's content, or null when it cannot be read. */
	read(path: string): Promise<string | null>;
}

/** The tracked files of `sha` and their sizes, with a reader for their content. */
export async function readCommitTree(git: GitText, sha: string): Promise<CommitTree> {
	const listed = await git(['ls-tree', '-r', '-l', '-z', sha]);
	const sizes = new Map<string, number>();

	for (const entry of listed.stdout.split('\0')) {
		const match = /^\S+ blob \S+\s+(\d+)\t(.+)$/s.exec(entry);

		if (match) sizes.set(match[2]!, Number(match[1]));
	}

	const read = async (path: string) => {
		const shown = await git(['show', `${sha}:${path}`]);

		return shown.code === 0 ? shown.stdout : null;
	};

	return { sizes, read };
}

/** `package.json` scripts across the repo at `sha` (skipping vendored dirs), as `dir: name → command` lines. */
export async function packageScripts(git: GitText, sha: string, limit: number): Promise<string[]> {
	const listed = await git(['ls-tree', '-r', '--name-only', sha]);
	const manifests = packageManifests(listed.stdout.split('\n'));

	const lines: string[] = [];

	for (const path of manifests) {
		const shown = await git(['show', `${sha}:${path}`]);
		let scripts: unknown;

		try {
			scripts = (JSON.parse(shown.stdout) as { scripts?: unknown }).scripts;
		} catch {
			continue;
		}

		if (!scripts || typeof scripts !== 'object') continue;

		const dir = path === 'package.json' ? '.' : path.slice(0, -'/package.json'.length);

		for (const [name, command] of Object.entries(scripts as Record<string, unknown>)) {
			if (typeof command !== 'string') continue;
			lines.push(`${dir}: ${name} → ${command.slice(0, 160)}`);
			if (lines.length >= limit) return lines;
		}
	}

	return lines;
}
