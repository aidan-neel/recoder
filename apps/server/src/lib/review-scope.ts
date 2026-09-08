import type { FileDiff } from '@recoder/shared';

/**
 * Which changed files the reviewers actually look at.
 *
 * Build output, vendored code, lockfiles, generated declarations, and
 * binaries carry no review signal and drown the scouts in noise
 * (`.svelte-kit/__package__`, `dist`, `*.d.ts` …). They stay visible in the
 * diff view — they just never enter model context.
 */

/** Path segments that mark a file as generated, built, or vendored. */
const SKIP_SEGMENTS = new Set([
	'node_modules',
	'dist',
	'build',
	'out',
	'target',
	'vendor',
	'coverage',
	'.nyc_output',
	'.turbo',
	'.svelte-kit',
	'.next',
	'.nuxt',
	'.vercel',
	'.netlify',
	'.output',
	'.docusaurus',
	'.vuepress',
	'storybook-static',
	'__pycache__',
	'.venv',
	'venv',
	'.tox',
	'.pytest_cache',
	'.mypy_cache',
	'.ruff_cache',
	'.gradle',
	'.git',
	'pods',
	'site-packages'
]);

/** Basenames never worth reviewing (lockfiles, OS junk). */
const SKIP_BASENAMES = new Set([
	'package-lock.json',
	'yarn.lock',
	'pnpm-lock.yaml',
	'bun.lock',
	'bun.lockb',
	'gemfile.lock',
	'poetry.lock',
	'cargo.lock',
	'composer.lock',
	'podfile.lock',
	'.ds_store'
]);

/** Extensions with no review signal: generated, minified, maps, binaries. */
const SKIP_EXTENSIONS = [
	'.min.js',
	'.min.css',
	'.map',
	'.d.ts',
	'.d.mts',
	'.d.cts',
	'.png',
	'.jpg',
	'.jpeg',
	'.gif',
	'.webp',
	'.avif',
	'.ico',
	'.bmp',
	'.svg',
	'.woff',
	'.woff2',
	'.ttf',
	'.otf',
	'.eot',
	'.pdf',
	'.zip',
	'.tar',
	'.gz',
	'.tgz',
	'.br',
	'.wasm',
	'.mp4',
	'.webm',
	'.mp3',
	'.ogg',
	'.mov',
	'.bin',
	'.exe',
	'.dll',
	'.so',
	'.dylib',
	'.class',
	'.pyc',
	'.pyo',
	'.o',
	'.a'
];

export interface SkippedFile {
	path: string;
	reason: string;
}

export interface ReviewScope {
	included: FileDiff[];
	skipped: SkippedFile[];
}

/** Extra comma-separated substring patterns from RECODER_REVIEW_EXCLUDE. */
export function extraExcludes(): string[] {
	return (process.env.RECODER_REVIEW_EXCLUDE ?? '')
		.split(',')
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean);
}

function skipReason(path: string, extra: string[]): string | null {
	if (path === '' || path === 'unknown') return 'unresolvable path';
	const lower = path.toLowerCase();
	for (const pattern of extra) {
		if (pattern !== '' && lower.includes(pattern)) return `matches RECODER_REVIEW_EXCLUDE "${pattern}"`;
	}
	const segments = lower.split('/').filter(Boolean);
	const basename = segments[segments.length - 1] ?? '';
	if (SKIP_BASENAMES.has(basename) || basename.endsWith('.lock')) return 'lockfile';
	if (segments.some((s) => SKIP_SEGMENTS.has(s) || s.endsWith('.egg-info'))) {
		return 'generated/build output';
	}
	if (SKIP_EXTENSIONS.some((ext) => basename.endsWith(ext))) {
		return basename.endsWith('.d.ts') || basename.endsWith('.d.mts') || basename.endsWith('.d.cts')
			? 'generated declarations'
			: 'binary or minified asset';
	}
	return null;
}

/** Split changed files into reviewable context vs. skipped noise. */
export function scopeReviewFiles(files: FileDiff[], extra: string[] = []): ReviewScope {
	const included: FileDiff[] = [];
	const skipped: SkippedFile[] = [];
	for (const file of files) {
		const reason = skipReason(file.path, extra);
		if (reason) skipped.push({ path: file.path === '' ? '(empty path)' : file.path, reason });
		else included.push(file);
	}
	return { included, skipped };
}
