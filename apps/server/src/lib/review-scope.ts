import type { FileDiff } from '@recoder/shared';

/**
 * Classify changed files for inventory and coverage.
 *
 * Generated, vendored, binary, explicitly excluded, and oversized content
 * stay in the coverage ledger with a reason — they are never silently
 * dropped. Hand-written declaration files, text SVGs, and lockfiles are
 * reviewable evidence (lockfiles may be summarized rather than fully read).
 */

export type FileClassification =
	| 'source'
	| 'test'
	| 'docs'
	| 'config'
	| 'lockfile'
	| 'generated'
	| 'binary'
	| 'other';

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

const LOCKFILE_BASENAMES = new Set([
	'package-lock.json',
	'yarn.lock',
	'pnpm-lock.yaml',
	'bun.lock',
	'bun.lockb',
	'gemfile.lock',
	'poetry.lock',
	'cargo.lock',
	'composer.lock',
	'podfile.lock'
]);

const BINARY_EXTENSIONS = [
	'.min.js',
	'.min.css',
	'.map',
	'.png',
	'.jpg',
	'.jpeg',
	'.gif',
	'.webp',
	'.avif',
	'.ico',
	'.bmp',
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

const SOURCE_EXTENSIONS = new Set([
	'.ts',
	'.tsx',
	'.js',
	'.jsx',
	'.mjs',
	'.cjs',
	'.mts',
	'.cts',
	'.d.ts',
	'.d.mts',
	'.d.cts',
	'.svelte',
	'.vue',
	'.py',
	'.go',
	'.rs',
	'.java',
	'.kt',
	'.rb',
	'.php',
	'.cs',
	'.cpp',
	'.cc',
	'.cxx',
	'.c',
	'.h',
	'.hpp',
	'.swift',
	'.scala',
	'.clj',
	'.ex',
	'.exs',
	'.erl',
	'.hs',
	'.lua',
	'.r',
	'.sql',
	'.sh',
	'.bash',
	'.zsh',
	'.ps1'
]);

const DOC_EXTENSIONS = new Set(['.md', '.mdx', '.rst', '.txt', '.adoc', '.html']);
const CONFIG_BASENAMES = new Set([
	'package.json',
	'tsconfig.json',
	'jsconfig.json',
	'pyproject.toml',
	'cargo.toml',
	'go.mod',
	'go.sum',
	'dockerfile',
	'makefile',
	'.editorconfig',
	'.gitignore',
	'.prettierrc',
	'.eslintrc',
	'eslint.config.js',
	'eslint.config.ts',
	'biome.json',
	'.clang-format'
]);

export interface SkippedFile {
	path: string;
	reason: string;
}

export interface FileClass {
	classification: FileClassification;
	excludeReason?: string;
	summarize?: boolean;
	language: string | null;
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

function extOf(basename: string): string {
	const lower = basename.toLowerCase();
	if (lower.endsWith('.d.ts')) return '.d.ts';
	if (lower.endsWith('.d.mts')) return '.d.mts';
	if (lower.endsWith('.d.cts')) return '.d.cts';
	const dot = lower.lastIndexOf('.');
	return dot >= 0 ? lower.slice(dot) : '';
}

function looksLikeTest(path: string, basename: string): boolean {
	const lower = path.toLowerCase();
	if (/(^|\/)(tests?|__tests__|spec)(\/|$)/.test(lower)) return true;
	return /\.(test|spec)\.[^.]+$/.test(basename.toLowerCase());
}

export function classifyPath(path: string, extra: string[] = []): FileClass {
	if (path === '' || path === 'unknown') {
		return { classification: 'other', excludeReason: 'unresolvable path', language: null };
	}
	const lower = path.toLowerCase();
	for (const pattern of extra) {
		if (pattern !== '' && lower.includes(pattern)) {
			return {
				classification: 'other',
				excludeReason: `matches RECODER_REVIEW_EXCLUDE "${pattern}"`,
				language: null
			};
		}
	}
	const segments = lower.split('/').filter(Boolean);
	const basename = segments[segments.length - 1] ?? '';
	if (segments.some((s) => SKIP_SEGMENTS.has(s) || s.endsWith('.egg-info'))) {
		return { classification: 'generated', excludeReason: 'generated/build output', language: null };
	}
	if (LOCKFILE_BASENAMES.has(basename) || (basename.endsWith('.lock') && basename !== '.lock')) {
		return { classification: 'lockfile', summarize: true, language: null };
	}
	if (BINARY_EXTENSIONS.some((ext) => basename.endsWith(ext))) {
		return { classification: 'binary', excludeReason: 'binary or minified asset', language: null };
	}
	const ext = extOf(basename);
	const language = ext ? ext.slice(1) : null;
	if (looksLikeTest(path, basename)) {
		return { classification: 'test', language };
	}
	if (DOC_EXTENSIONS.has(ext) || basename === 'license' || basename === 'copying') {
		return { classification: 'docs', language };
	}
	if (CONFIG_BASENAMES.has(basename) || basename.startsWith('.') || ext === '.toml' || ext === '.yml' || ext === '.yaml' || ext === '.json') {
		return { classification: 'config', language };
	}
	if (SOURCE_EXTENSIONS.has(ext) || ext === '.svg') {
		return { classification: 'source', language: ext === '.svg' ? 'svg' : language };
	}
	return { classification: 'other', language };
}

export function packageBoundary(path: string): string | null {
	const parts = path.split('/').filter(Boolean);
	if (parts[0] === 'apps' || parts[0] === 'packages' || parts[0] === 'services') {
		return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0];
	}
	if (parts[0] === 'src' || parts[0] === 'lib') return parts[0];
	return parts[0] ?? null;
}

/** Split changed files into reviewable context vs. skipped noise. */
export function scopeReviewFiles(files: FileDiff[], extra: string[] = []): ReviewScope {
	const included: FileDiff[] = [];
	const skipped: SkippedFile[] = [];
	for (const file of files) {
		const classified = classifyPath(file.path, extra);
		if (classified.excludeReason) {
			skipped.push({ path: file.path === '' ? '(empty path)' : file.path, reason: classified.excludeReason });
		} else {
			included.push(file);
		}
	}
	return { included, skipped };
}
