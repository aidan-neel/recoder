/**
 * The contract for the file panel's repository browsing routes. A repository
 * chat reads the repo's default branch; a review's chat reads the commit the
 * review ran on, so the client passes the review's `headSha` as `ref`.
 *
 * `GET /api/repos/:id/tree?ref=<ref>&path=<dir>` lists one directory at a ref,
 * `GET /api/repos/:id/file?ref=<ref>&path=<path>` reads one file at a ref. An
 * omitted `ref` means the repo's default branch — what a repository chat works
 * on. The repo's pull-request checkouts hold review head commits, so a
 * `headSha` resolves without naming the pull request. Answers 404 for an
 * untracked repo, a ref git cannot resolve, a path missing at that ref, and a
 * repo with no git copy on this server yet; 400 for a malformed ref or path.
 */

/** The most text `/api/repos/:id/file` returns; a larger file is cut here with `truncated`. */
export const REPO_FILE_TEXT_BYTES = 512 * 1024;

/** What one directory entry is. `submodule` is a gitlink; it and `symlink` are never followed. */
export type RepoTreeEntryKind = 'file' | 'dir' | 'symlink' | 'submodule';

/** One entry of `RepoTree`. */
export interface RepoTreeEntry {
	/** The entry's own name, the last segment of `path`. */
	name: string;
	/** The path from the repository root. */
	path: string;
	kind: RepoTreeEntryKind;
	/** Byte size of the blob; set only on files. */
	size?: number;
	/** Where a symlink points, exactly as stored; it is never followed. */
	target?: string;
}

/** The answer of `GET /api/repos/:id/tree`: one directory's entries, directories first then by name. */
export interface RepoTree {
	/** The directory that was listed; the empty string is the repository root. */
	path: string;
	/** The commit-ish that was read: the `ref` query, or the repo's default branch. */
	ref: string;
	/** The commit `ref` resolved to. */
	commit: string;
	entries: RepoTreeEntry[];
}

/** The answer of `GET /api/repos/:id/file`: one file at a ref. */
export interface RepoFile {
	/** The path from the repository root. */
	path: string;
	/** The commit-ish that was read: the `ref` query, or the repo's default branch. */
	ref: string;
	/** The commit `ref` resolved to. */
	commit: string;
	/** The blob's SHA. The same content has the same one at every commit, so it keys caches. */
	sha: string;
	/** The blob's full byte size, even when `text` is truncated. */
	size: number;
	/** A language id for highlighting (VS Code vocabulary), or null when the extension names none. */
	language: string | null;
	/** True when the blob holds binary bytes; `text` is then absent. */
	binary: boolean;
	/** True when `text` was cut at `REPO_FILE_TEXT_BYTES`. */
	truncated: boolean;
	/** The file's text, absent on binary files and cut at `REPO_FILE_TEXT_BYTES` on long ones. */
	text?: string;
}

/** Language ids by lowercase extension, in VS Code vocabulary where one exists. */
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
	ts: 'typescript',
	mts: 'typescript',
	cts: 'typescript',
	tsx: 'typescriptreact',
	js: 'javascript',
	mjs: 'javascript',
	cjs: 'javascript',
	jsx: 'javascriptreact',
	json: 'json',
	jsonc: 'jsonc',
	md: 'markdown',
	mdx: 'markdown',
	css: 'css',
	scss: 'scss',
	less: 'less',
	html: 'html',
	svg: 'xml',
	vue: 'vue',
	svelte: 'svelte',
	py: 'python',
	go: 'go',
	rs: 'rust',
	rb: 'ruby',
	java: 'java',
	kt: 'kotlin',
	kts: 'kotlin',
	swift: 'swift',
	c: 'c',
	h: 'c',
	cpp: 'cpp',
	cc: 'cpp',
	cxx: 'cpp',
	hpp: 'cpp',
	cs: 'csharp',
	php: 'php',
	sh: 'shellscript',
	bash: 'shellscript',
	zsh: 'shellscript',
	ps1: 'powershell',
	sql: 'sql',
	xml: 'xml',
	yml: 'yaml',
	yaml: 'yaml',
	toml: 'toml',
	ini: 'ini',
	r: 'r',
	lua: 'lua',
	dart: 'dart',
	ex: 'elixir',
	exs: 'elixir',
	erl: 'erlang',
	hs: 'haskell',
	clj: 'clojure',
	scala: 'scala',
	jl: 'julia',
	tf: 'terraform',
	hcl: 'hcl',
	proto: 'protobuf',
	graphql: 'graphql',
	diff: 'diff'
};

/** Language ids by lowercase basename, for files whose name carries no extension. */
const LANGUAGE_BY_BASENAME: Record<string, string> = {
	dockerfile: 'dockerfile',
	makefile: 'makefile',
	gemfile: 'ruby',
	rakefile: 'ruby',
	podfile: 'ruby',
	vagrantfile: 'ruby',
	'cmakelists.txt': 'cmake'
};

/** The language a file's name suggests, or null when neither its basename nor its extension names one. */
export function languageForPath(path: string): string | null {
	const basename = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
	const byName = LANGUAGE_BY_BASENAME[basename];

	if (byName) return byName;

	const dot = basename.lastIndexOf('.');

	if (dot <= 0) return null;

	return LANGUAGE_BY_EXTENSION[basename.slice(dot + 1)] ?? null;
}
