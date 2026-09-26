import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { FixEdit } from '@recoder/shared';
import { z } from 'zod';
import { runCommand } from '../commands/runner.js';
import { resolveDiscussRole } from './discuss.js';
import { readExcerpt } from './harness.js';
import { chatCompletion, LlmError } from './llm.js';
import { configForRole } from './models.js';

/**
 * On-demand fix suggestions for a single finding. The model returns
 * find-and-replace edits, never a diff: hand-written hunks get line counts
 * and context wrong. The server applies the edits to the real file and
 * builds the patch, again at apply time, so earlier fixes don't break it.
 */

const SYSTEM_PROMPT = `You write minimal code fixes for a single review finding. You cannot run commands or see anything outside the provided finding, file excerpt, and diff.
Fix only the reported finding. Keep the change minimal: no refactors, no unrelated changes, no new files.
Output STRICT JSON: {"summary": string, "edits": [{"file": string, "find": string, "replace": string}]}.
- "summary" is one short sentence describing the change.
- "file" is the repo-relative path.
- "find" is text copied verbatim from the current file (without the "12: " line-number prefixes), including indentation, with enough whole lines to match exactly once.
- "replace" is the full text that takes the place of "find".
No prose outside the JSON object.`;

const editSchema = z.object({
	file: z.string().min(1).max(500),
	find: z.string().min(1).max(20000),
	replace: z.string().max(20000)
});
const fixOutputSchema = z.object({
	summary: z.string().min(1).max(500),
	edits: z.array(editSchema).min(1).max(12)
});
export const fixEditsSchema = z.array(editSchema).min(1).max(12);

export interface SuggestFixInput {
	agent: string;
	file: string;
	line: number;
	endLine: number;
	severity: string;
	message: string;
	diff: string;
	sandboxPath: string;
}

/** Pull a JSON object out of model output (tolerates fences/prose). */
function extractJsonObject(output: string): unknown {
	const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(output);
	const candidate = fenced ? fenced[1] : output;
	const start = candidate.indexOf('{');
	const end = candidate.lastIndexOf('}');
	if (start === -1 || end <= start) throw new Error('no JSON object in model output');
	return JSON.parse(candidate.slice(start, end + 1));
}

/** Why edits could not be placed in the current code. */
export class EditMismatchError extends Error {}

/** A checkout file's full text; null when it is missing, a symlink, or outside the checkout. */
async function readCheckoutFile(root: string, file: string): Promise<string | null> {
	const base = resolve(root);
	const path = resolve(base, file);
	if (!path.startsWith(base + '/')) return null;
	try {
		const info = await lstat(path);
		if (info.isSymbolicLink() || !info.isFile()) return null;
		return await readFile(path, 'utf8');
	} catch {
		return null;
	}
}

/** The single place `find` occurs in `content`, forgiving copied line numbers and indentation. */
export function locateEdit(content: string, find: string): { start: number; end: number } | null {
	const once = (needle: string) => {
		const at = content.indexOf(needle);
		return at >= 0 && content.indexOf(needle, at + 1) < 0 ? { start: at, end: at + needle.length } : null;
	};
	const exact = once(find);
	if (exact) return exact;
	const lines = find.replace(/\n$/, '').split('\n');
	// The excerpt the model saw was numbered; a verbatim copy may keep the numbers.
	const unnumbered = lines.every((line) => /^\s*\d+: /.test(line)) ? lines.map((line) => line.replace(/^\s*\d+: /, '')) : lines;
	if (unnumbered !== lines) {
		const stripped = once(unnumbered.join('\n'));
		if (stripped) return stripped;
	}
	// Last resort: whole lines equal after trimming, matching exactly one window.
	const want = unnumbered.map((line) => line.trim());
	while (want.length && want[0] === '') want.shift();
	while (want.length && want.at(-1) === '') want.pop();
	if (!want.length) return null;
	const have = content.split('\n');
	const offsets: number[] = [];
	for (let i = 0, at = 0; i < have.length; i++) { offsets.push(at); at += have[i].length + 1; }
	let found: { start: number; end: number } | null = null;
	for (let i = 0; i + want.length <= have.length; i++) {
		if (!want.every((line, j) => have[i + j].trim() === line)) continue;
		if (found) return null;
		const last = i + want.length - 1;
		found = { start: offsets[i], end: offsets[last] + have[last].length };
	}
	return found;
}

/** Apply edits to the checkout's current files (in memory). Throws EditMismatchError. */
async function editedFiles(sandboxPath: string, edits: FixEdit[]): Promise<Map<string, { before: string; after: string }>> {
	const files = new Map<string, { before: string; after: string }>();
	for (const [index, edit] of edits.entries()) {
		const file = edit.file.replace(/^[ab]\//, '');
		if (file.startsWith('/') || file.split('/').includes('..')) throw new EditMismatchError(`edit ${index + 1}: invalid path ${edit.file}`);
		let entry = files.get(file);
		if (!entry) {
			const before = await readCheckoutFile(sandboxPath, file);
			if (before === null) throw new EditMismatchError(`edit ${index + 1}: ${file} does not exist`);
			entry = { before, after: before };
			files.set(file, entry);
		}
		const span = locateEdit(entry.after, edit.find);
		if (!span) throw new EditMismatchError(`edit ${index + 1}: the "find" text does not match exactly one place in ${file}`);
		entry.after = entry.after.slice(0, span.start) + edit.replace + entry.after.slice(span.end);
	}
	return files;
}

/** A unified diff (`a/` and `b/` prefixes) from the checkout's files to the edited ones. */
export async function patchFromEdits(sandboxPath: string, edits: FixEdit[]): Promise<string> {
	const files = await editedFiles(sandboxPath, edits);
	const dir = await mkdtemp(join(tmpdir(), 'recoder-fix-'));
	try {
		const parts: string[] = [];
		for (const [file, { before, after }] of files) {
			if (before === after) continue;
			for (const [side, text] of [['a', before], ['b', after]] as const) {
				await mkdir(dirname(join(dir, side, file)), { recursive: true });
				await writeFile(join(dir, side, file), text);
			}
			const proc = Bun.spawn(['git', 'diff', '--no-index', '--no-color', '--no-prefix', '--', `a/${file}`, `b/${file}`], { cwd: dir, stdout: 'pipe', stderr: 'pipe' });
			const [out] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
			parts.push(out);
		}
		const patch = parts.join('');
		if (!patch.trim()) throw new EditMismatchError('the edits change nothing');
		return patch;
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

export async function suggestFix(
	input: SuggestFixInput
): Promise<{ agent: string; model: string; summary: string; patch: string; edits: FixEdit[] }> {
	const role = resolveDiscussRole(input.agent);
	const cfg = configForRole(role);

	const parts = [
		`Finding (${input.severity}, ${input.file}:${input.line}-${input.endLine}): ${input.message}`
	];
	const span = Math.max(0, input.endLine - input.line);
	const excerpt = await readExcerpt(input.sandboxPath, input.file, input.line + Math.floor(span / 2), Math.max(40, Math.ceil(span / 2) + 25), 16000);
	if (excerpt !== null) parts.push(`--- ${input.file} (current, numbered) ---\n${excerpt}`);
	const trimmedDiff =
		input.diff.length > 20000 ? input.diff.slice(0, 20000) + '\n…[diff truncated]' : input.diff;
	parts.push(`--- unified diff (capped) ---\n${trimmedDiff}`);

	return { agent: role, model: cfg.model, ...await writeFix(cfg, SYSTEM_PROMPT, parts.join('\n\n'), input.sandboxPath) };
}

/** Ask for edits, build the patch from them, and give the model one more try when they don't land. */
async function writeFix(
	cfg: ReturnType<typeof configForRole>,
	system: string,
	user: string,
	sandboxPath: string
): Promise<{ summary: string; patch: string; edits: FixEdit[] }> {
	const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
		{ role: 'system', content: system },
		{ role: 'user', content: user }
	];
	try {
		for (let attempt = 1; ; attempt++) {
			const output = await chatCompletion({
				provider: cfg.provider,
				reasoningEffort: cfg.reasoningEffort,
				baseUrl: cfg.baseUrl,
				apiKey: cfg.apiKey,
				model: cfg.model,
				messages,
				temperature: 0,
				timeoutMs: 120_000
			});
			let problem: string;
			try {
				const parsed = fixOutputSchema.safeParse(extractJsonObject(output));
				if (!parsed.success) throw new EditMismatchError('the reply was not {"summary", "edits"} JSON');
				const patch = await patchFromEdits(sandboxPath, parsed.data.edits);
				return { summary: parsed.data.summary.trim(), patch, edits: parsed.data.edits };
			} catch (err) {
				if (!(err instanceof EditMismatchError) && !(err instanceof SyntaxError) && !(err instanceof Error && err.message === 'no JSON object in model output')) throw err;
				problem = err.message;
			}
			if (attempt >= 2) throw new LlmError(0, 'The model could not write a fix that matches the code. Try again.');
			messages.push({ role: 'assistant', content: output }, { role: 'user', content: `That fix could not be used: ${problem}. Copy "find" verbatim from the file and reply with the JSON again.` });
		}
	} catch (err) {
		if (err instanceof LlmError) throw err;
		throw new LlmError(0, err instanceof Error ? err.message : String(err));
	}
}

const CHECK_SYSTEM_PROMPT = SYSTEM_PROMPT.replace(
	'You write minimal code fixes for a single review finding.',
	'You write minimal code fixes that make a failing CI check pass on a pull request.'
).replace('Fix only the reported finding.', 'Fix only what the log shows is failing. Fix the code, not the check: never skip, delete or weaken a test or CI step to make it pass.');

/** Source files a CI log points at, e.g. `src/a.ts:12`, that exist in the checkout. */
async function filesInLog(sandboxPath: string, log: string, limit = 3): Promise<{ file: string; line: number }[]> {
	const found: { file: string; line: number }[] = [];
	for (const match of log.matchAll(/((?:[\w@.-]+\/)*[\w@.-]+\.[a-z]{1,6})(?::(\d+))?/gi)) {
		const file = match[1].replace(/^\.\//, '');
		if (found.some((entry) => entry.file === file) || file.includes('..')) continue;
		if (await readCheckoutFile(sandboxPath, file) === null) continue;
		found.push({ file, line: Number(match[2] ?? 1) || 1 });
		if (found.length >= limit) break;
	}
	return found;
}

/** A fix for a failing CI check, written from its log, the PR diff and the files the log names. */
export async function suggestCheckFix(input: {
	check: string;
	log: string;
	diff: string;
	sandboxPath: string;
}): Promise<{ agent: string; model: string; summary: string; patch: string; edits: FixEdit[] }> {
	const cfg = configForRole('correctness');
	const parts = [`Failing CI check: ${input.check}`, `--- failure log (untrusted, excerpt) ---\n${input.log}`];
	for (const { file, line } of await filesInLog(input.sandboxPath, input.log)) {
		const excerpt = await readExcerpt(input.sandboxPath, file, line, 40, 8000);
		if (excerpt !== null) parts.push(`--- ${file} (current, numbered) ---\n${excerpt}`);
	}
	const trimmedDiff = input.diff.length > 20000 ? input.diff.slice(0, 20000) + '\n…[diff truncated]' : input.diff;
	parts.push(`--- pull request diff (capped) ---\n${trimmedDiff}`);
	return { agent: 'correctness', model: cfg.model, ...await writeFix(cfg, CHECK_SYSTEM_PROMPT, parts.join('\n\n'), input.sandboxPath) };
}

/** Check a patch against a checkout without applying it. */
export async function patchApplies(sandboxPath: string, patch: string): Promise<boolean> {
	const dir = await mkdtemp(join(tmpdir(), 'recoder-fix-'));
	try {
		const file = join(dir, 'fix.patch');
		await writeFile(file, patch.endsWith('\n') ? patch : `${patch}\n`);
		const run = await runCommand({
			label: 'fix apply check',
			command: 'git',
			args: ['apply', '--recount', '--check', file],
			cwd: sandboxPath
		});
		return run.status === 'succeeded';
	} catch {
		return false;
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

export const suggestFixFindingSchema = z.object({
	file: z.string().min(1).max(500),
	line: z.number().int().positive(),
	endLine: z.number().int().positive(),
	severity: z.string().min(1).max(20),
	message: z.string().min(1).max(4000)
});

export const suggestFixRequestSchema = z.object({
	agent: z.string().min(1).max(50),
	finding: suggestFixFindingSchema
});

export const applyFixRequestSchema = z.object({
	findingId: z.string().min(1).max(200).optional(),
	agent: z.string().min(1).max(50).optional(),
	finding: suggestFixFindingSchema,
	summary: z.string().min(1).max(500),
	patch: z.string().min(1).max(60000),
	edits: fixEditsSchema.optional()
});

/** Fix-application failure with the HTTP status the route should answer. */
export class FixError extends Error {
	status: 409 | 502;
	sha?: string;

	constructor(status: 409 | 502, message: string, sha?: string) {
		super(message);
		this.status = status;
		this.sha = sha;
	}
}

/** Run git in a checkout, mapping failures to FixError. */
async function git(cwd: string, args: string[], label: string, status: 409 | 502 = 502): Promise<string> {
	let run;
	try {
		run = await runCommand({ label, command: 'git', args, cwd });
	} catch (err) {
		throw new FixError(status, err instanceof Error ? err.message : String(err));
	}
	if (run.status !== 'succeeded') {
		throw new FixError(status, `git ${args[0]} failed: ${run.logs.slice(-2000)}`);
	}
	return run.logs.trim();
}

async function writeTempPatch(patch: string): Promise<{ dir: string; file: string }> {
	const dir = await mkdtemp(join(tmpdir(), 'recoder-fix-'));
	const file = join(dir, 'fix.patch');
	await writeFile(file, patch.endsWith('\n') ? patch : `${patch}\n`);
	return { dir, file };
}

/** Repo-relative paths a patch touches (`+++ b/<path>` lines). */
function patchPaths(patch: string): string[] {
	const paths = new Set<string>();
	for (const match of patch.matchAll(/^\+\+\+\s+b\/(.+)$/gm)) {
		const path = match[1].trim();
		if (path !== '/dev/null' && path !== '' && !path.startsWith('/') && !path.includes('..')) {
			paths.add(path);
		}
	}
	return [...paths];
}

export interface ApplyFixInput {
	sandboxPath: string;
	patch: string;
	/** When present, the patch is rebuilt from these against the current code. */
	edits?: FixEdit[];
	summary: string;
	file: string;
	line: number;
	message: string;
}

/**
 * Validate, apply, and commit a suggested patch in a review sandbox.
 * Returns the new commit SHA; pushing is left to {@link pushFixBranch}.
 */
export async function applyFixCommit(input: ApplyFixInput): Promise<{ sha: string }> {
	let patch = input.patch.trim();
	if (input.edits?.length) {
		try {
			patch = await patchFromEdits(input.sandboxPath, input.edits);
		} catch (err) {
			if (err instanceof EditMismatchError) throw new FixError(409, 'The code changed since this fix was written. Write the fix again.');
			throw err;
		}
	}
	if (!/^---\s/m.test(patch) || !/^\+\+\+\s/m.test(patch)) {
		throw new FixError(409, 'not a unified diff patch');
	}
	const paths = patchPaths(patch);
	if (paths.length === 0) throw new FixError(409, 'patch touches no files');
	const { dir, file } = await writeTempPatch(patch);
	try {
		try {
			await git(input.sandboxPath, ['apply', '--recount', '--check', file], 'fix apply check', 409);
		} catch (err) {
			if (err instanceof FixError) {
				throw new FixError(
					409,
					'This fix no longer applies to the latest code. Write the fix again.'
				);
			}
			throw err;
		}
		await git(input.sandboxPath, ['apply', '--recount', file], 'fix apply', 409);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
	await git(input.sandboxPath, ['add', '--', ...paths], 'fix stage', 409);
	const message = `recoder: ${input.summary}\n\nFixes ${input.file}:${input.line} — ${input.message}`;
	await git(
		input.sandboxPath,
		['-c', 'user.name=recoder', '-c', 'user.email=recoder@localhost', 'commit', '-m', message],
		'fix commit',
		502
	);
	const sha = await git(input.sandboxPath, ['rev-parse', 'HEAD'], 'fix sha');
	return { sha };
}

/** One git operation at a time per sandbox (apply and verify both move HEAD). */
const sandboxLocks = new Map<string, Promise<unknown>>();
export function withSandboxLock<T>(sandboxPath: string, fn: () => Promise<T>): Promise<T> {
	const previous = sandboxLocks.get(sandboxPath) ?? Promise.resolve();
	const run = previous.catch(() => undefined).then(fn);
	sandboxLocks.set(sandboxPath, run.catch(() => undefined));
	return run;
}

/** Temporary branches Recoder pushes to run CI on a fix; nothing else may be deleted. */
export const VERIFY_BRANCH_PREFIX = 'recoder/fix-';

/**
 * Verify a fix on CI without touching the PR branch: commit the patch on a
 * throwaway local branch from the current HEAD, force-push it as
 * `recoder/fix-…`, then put the sandbox back exactly as it was.
 */
export async function pushVerifyBranch(input: ApplyFixInput & { branch: string }): Promise<{ sha: string }> {
	if (!input.branch.startsWith(VERIFY_BRANCH_PREFIX)) throw new FixError(409, 'invalid verify branch');
	const path = input.sandboxPath;
	const base = await git(path, ['rev-parse', 'HEAD'], 'verify base');
	const current = await git(path, ['rev-parse', '--abbrev-ref', 'HEAD'], 'verify branch');
	const local = `recoder-verify-${Date.now()}`;
	await git(path, ['checkout', '-q', '-b', local, base], 'verify checkout', 409);
	try {
		const { sha } = await applyFixCommit(input);
		try {
			await git(path, ['push', '-f', 'origin', `${local}:refs/heads/${input.branch}`], 'verify push', 502);
		} catch (err) {
			if (err instanceof FixError) throw new FixError(502, `couldn't push the fix branch (check push access): ${err.message}`);
			throw err;
		}
		return { sha };
	} finally {
		await git(path, ['reset', '-q', '--hard', base], 'verify reset').catch(() => undefined);
		await git(path, ['checkout', '-q', current === 'HEAD' ? base : current], 'verify restore').catch(() => undefined);
		await git(path, ['branch', '-q', '-D', local], 'verify cleanup').catch(() => undefined);
	}
}

/** Remove a verify branch from the remote (after applying or discarding the fix). */
export async function deleteVerifyBranch(sandboxPath: string, branch: string): Promise<void> {
	if (!branch.startsWith(VERIFY_BRANCH_PREFIX)) throw new FixError(409, 'invalid verify branch');
	await git(sandboxPath, ['push', 'origin', '--delete', branch], 'verify delete', 502);
}

/** Push a sandbox branch to the PR head ref over the host's git credentials. */
export async function pushFixBranch(input: {
	sandboxPath: string;
	localBranch: string;
	headRef: string;
}): Promise<void> {
	try {
		await git(
			input.sandboxPath,
			['push', 'origin', `${input.localBranch}:${input.headRef}`],
			'fix push',
			502
		);
	} catch (err) {
		if (err instanceof FixError) {
			throw new FixError(
				502,
				`committed locally but the push failed (check push access): ${err.message}`
			);
		}
		throw err;
	}
}
