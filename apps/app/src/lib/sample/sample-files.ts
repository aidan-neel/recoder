import { languageForPath, type DiffLine, type RepoFile, type RepoTree, type RepoTreeEntry } from '@recoder/shared';

import { ApiError } from '../api/http';
import { SAMPLE_DIFFS } from './sample-diff';

/** What a sample file holds: text, or bytes that are not text; `slow` makes the first read time out. */
interface SampleFile {
	text?: string;
	binary?: true;
	slow?: true;
}

const SAMPLE_REPO_ID = 'sample-api';

const SAMPLE_REF = 'main';

const SAMPLE_COMMIT = '4f9c2e81b7d3a05c6e1f8d42a9b0c3e57f6a1d28';

/** How long the sample takes to answer, so the panel's loading state shows as it does against a server. */
const LATENCY_MS = 260;

const BINARY_SIZE = 2048;

const README = `# api

The HTTP API behind the dashboard.

\`\`\`sh
bun install
bun run dev
\`\`\`

Rate limits are described in docs/rate-limits.md.`;

const PACKAGE_JSON = `{
	"name": "api",
	"private": true,
	"scripts": {
		"dev": "bun --watch src/server.ts",
		"test": "bun test"
	},
	"dependencies": {
		"hono": "4.6.3",
		"zod": "3.23.8"
	}
}`;

/** The lines of a file as the pull request leaves it: the context and the additions. */
function newSide(lines: DiffLine[]): string {
	return lines
		.filter((line) => line.type !== 'del')
		.map((line) => line.text)
		.join('\n');
}

/** The sample repository's files: those the pull request touches, plus a few others to browse. */
function sampleFiles(): Map<string, SampleFile> {
	const files = new Map<string, SampleFile>();

	for (const diff of SAMPLE_DIFFS) {
		if (diff.path !== 'bun.lock') files.set(diff.path, { text: newSide(diff.hunks.flatMap((hunk) => hunk.lines)) });
	}

	files.set('README.md', { text: README });
	files.set('package.json', { text: PACKAGE_JSON });
	files.set('public/logo.png', { binary: true });
	files.set('scripts/sync.sh', { text: 'echo "synced"', slow: true });

	return files;
}

/** The entries directly under `directory`: folders for deeper paths, then files, each by name. */
function entriesUnder(paths: Iterable<string>, directory: string): RepoTreeEntry[] {
	const prefix = directory ? `${directory}/` : '';
	const folders = new Set<string>();
	const files = new Set<string>();

	for (const path of paths) {
		if (!path.startsWith(prefix)) continue;

		const [name, ...deeper] = path.slice(prefix.length).split('/');

		(deeper.length > 0 ? folders : files).add(name);
	}

	const entry = (name: string, kind: 'dir' | 'file'): RepoTreeEntry => ({ name, path: `${prefix}${name}`, kind });

	return [
		...[...folders].sort((a, b) => a.localeCompare(b)).map((name) => entry(name, 'dir')),
		...[...files].sort((a, b) => a.localeCompare(b)).map((name) => entry(name, 'file'))
	];
}

/**
 * The sample's repository browsing: the sample API repository's files at any ref, after a short wait. Reading
 * `scripts/sync.sh` times out the first time and works the second, the way a slow git read does.
 */
export function createSampleFiles() {
	const files = sampleFiles();
	const timedOut = new Set<string>();

	/** Waits like a server, then checks the repository has a copy to read. */
	async function arrive(repoId: string): Promise<void> {
		await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));

		if (repoId !== SAMPLE_REPO_ID) throw new ApiError('This repository has no copy on the server yet.', 404);
	}

	return {
		async repoTree(repoId: string, path: string, ref?: string): Promise<RepoTree> {
			await arrive(repoId);

			const entries = entriesUnder(files.keys(), path);

			if (path && entries.length === 0) throw new ApiError(`No folder ${path} at ${ref ?? SAMPLE_REF}.`, 404);

			return { path, ref: ref ?? SAMPLE_REF, commit: SAMPLE_COMMIT, entries };
		},

		async repoFile(repoId: string, path: string, ref?: string): Promise<RepoFile> {
			await arrive(repoId);

			const content = files.get(path);

			if (!content) throw new ApiError(`No file ${path} at ${ref ?? SAMPLE_REF}.`, 404);

			if (content.slow && !timedOut.has(path)) {
				timedOut.add(path);

				throw new ApiError('The server took too long to read this file.', 504);
			}

			const { text, binary = false } = content;

			return {
				path,
				ref: ref ?? SAMPLE_REF,
				commit: SAMPLE_COMMIT,
				sha: `sample-blob-${path}`,
				size: text?.length ?? BINARY_SIZE,
				language: languageForPath(path),
				binary,
				truncated: false,
				text
			};
		}
	};
}
