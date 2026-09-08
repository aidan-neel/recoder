import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { runCommand } from '../commands/runner.js';
import { resolveDiscussRole } from './discuss.js';
import { readExcerpt } from './harness.js';
import { chatCompletion, LlmError } from './llm.js';
import { configForRole } from './models.js';

/**
 * On-demand fix suggestions for a single finding. The model returns a
 * minimal unified diff; the caller decides whether to apply/commit it.
 */

const SYSTEM_PROMPT = `You write minimal code fixes for a single review finding. You cannot run commands or see anything outside the provided finding, file excerpt, and diff.
Fix only the reported finding. Keep the patch minimal — no refactors, no unrelated changes, no new files.
Output STRICT JSON: {"summary": string, "patch": string}. "summary" is one short sentence describing the change. "patch" is a unified diff against the NEW-side file content shown, with paths like "a/<file>" and "b/<file>". No prose outside the JSON object.`;

const fixOutputSchema = z.object({
	summary: z.string().min(1).max(500),
	patch: z.string().min(1).max(30000)
});

export interface SuggestFixInput {
	agent: string;
	file: string;
	line: number;
	endLine: number;
	severity: string;
	message: string;
	diff: string;
	sandboxPath: string | null;
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

export async function suggestFix(
	input: SuggestFixInput
): Promise<{ agent: string; model: string; summary: string; patch: string }> {
	const role = resolveDiscussRole(input.agent);
	const cfg = configForRole(role);

	const parts = [
		`Finding (${input.severity}, ${input.file}:${input.line}-${input.endLine}): ${input.message}`
	];
	if (input.sandboxPath) {
		const excerpt = await readExcerpt(input.sandboxPath, input.file, input.line);
		if (excerpt !== null) {
			parts.push(`--- ${input.file} (new-side, numbered) ---\n${excerpt}`);
		}
	} else {
		parts.push('(no sandbox checkout — base the patch on the diff below)');
	}
	const trimmedDiff =
		input.diff.length > 20000 ? input.diff.slice(0, 20000) + '\n…[diff truncated]' : input.diff;
	parts.push(`--- unified diff (capped) ---\n${trimmedDiff}`);

	try {
		const output = await chatCompletion({
			baseUrl: cfg.baseUrl,
			apiKey: cfg.apiKey,
			model: cfg.model,
			messages: [
				{ role: 'system', content: SYSTEM_PROMPT },
				{ role: 'user', content: parts.join('\n\n') }
			],
			temperature: 0,
			timeoutMs: 120_000
		});
		const parsed = fixOutputSchema.safeParse(extractJsonObject(output));
		if (!parsed.success) throw new Error('model did not return {summary, patch} JSON');
		const patch = parsed.data.patch.trim();
		if (!/^---\s/m.test(patch) || !/^\+\+\+\s/m.test(patch)) {
			throw new Error('model did not return a unified diff patch');
		}
		return { agent: role, model: cfg.model, summary: parsed.data.summary.trim(), patch };
	} catch (err) {
		if (err instanceof LlmError) throw err;
		throw new LlmError(0, err instanceof Error ? err.message : String(err));
	}
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
			args: ['apply', '--check', file],
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
	finding: suggestFixFindingSchema,
	summary: z.string().min(1).max(500),
	patch: z.string().min(1).max(30000)
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
	const patch = input.patch.trim();
	if (!/^---\s/m.test(patch) || !/^\+\+\+\s/m.test(patch)) {
		throw new FixError(409, 'not a unified diff patch');
	}
	const paths = patchPaths(patch);
	if (paths.length === 0) throw new FixError(409, 'patch touches no files');
	const { dir, file } = await writeTempPatch(patch);
	try {
		try {
			await git(input.sandboxPath, ['apply', '--check', file], 'fix apply check', 409);
		} catch (err) {
			if (err instanceof FixError) {
				throw new FixError(
					409,
					'patch does not apply cleanly — regenerate the suggestion against the latest diff'
				);
			}
			throw err;
		}
		await git(input.sandboxPath, ['apply', file], 'fix apply', 409);
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
