import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { parseUnifiedDiff, type Finding, type FindingSeverity } from '@recoder/shared';
import { chatCompletion } from './llm.js';
import { configForRole, reviewLimits, type ReviewRole } from './models.js';

/**
 * Custom review harness. Read-only by construction:
 * - inputs are the PR diff + file excerpts read from the sandbox checkout;
 * - the model is instructed (and the output schema enforces) review-only
 *   findings — no patches, no commands, no file writes;
 * - this module never spawns processes or writes to disk.
 */

const rawFindingSchema = z.object({
	file: z.string().min(1).max(500),
	line: z.number().int().positive(),
	endLine: z.number().int().positive().optional(),
	severity: z.enum(['high', 'medium', 'low', 'info']),
	category: z.string().min(1).max(50),
	body: z.string().min(1).max(2000)
});

const toBackendSeverity: Record<string, FindingSeverity> = {
	high: 'error',
	medium: 'warning',
	low: 'info',
	info: 'info'
};

const ROLE_FOCUS: Record<ReviewRole, string> = {
	security:
		'Trust boundaries, auth/authz, injection, secret leaks, tenant isolation, unsafe deserialization, SSRF, path traversal.',
	perf: 'Algorithmic complexity, unbounded growth, N+1 patterns, wasteful allocation on hot paths, missing caching/eviction.',
	correctness:
		'Logic errors, off-by-ones, broken invariants, error handling, concurrency/race issues, dead or contradictory code.',
	docs: 'Stale comments, misleading names, missing docs for public behavior, comments that contradict the code.'
};

const SYSTEM_PROMPT = `You are a read-only code reviewer. You cannot change code, run commands, or access anything outside the provided diff and file excerpts.
Review only what is shown. Do not invent files, lines, or behavior you cannot see.
Output STRICT JSON: an array of findings, each {"file": string, "line": number, "endLine": number, "severity": "high"|"medium"|"low"|"info", "category": string, "body": string}.
"line"/"endLine" are NEW-side line numbers from the diff. Use "high" only for issues that are certainly reachable and damaging. An empty array [] is valid when there is nothing worth flagging. No prose outside the JSON array.`;

export interface HarnessEvents {
	onLog?: (role: ReviewRole, message: string) => void;
	onAgentStart?: (role: ReviewRole) => void;
	onAgentDone?: (role: ReviewRole, findings: number) => void;
}

/** Safely read a sandbox file (stays inside the checkout, capped length). */
async function readSandboxFile(sandboxPath: string, file: string, maxChars: number): Promise<string | null> {
	const resolved = resolve(join(sandboxPath, file));
	if (!resolved.startsWith(resolve(sandboxPath) + '/')) return null;
	try {
		const text = await readFile(resolved, 'utf8');
		return text.length > maxChars ? text.slice(0, maxChars) + '\n…[truncated]' : text;
	} catch {
		return null;
	}
}

/** Pull a JSON array out of model output (tolerates fences/prose). */
export function extractFindingsJson(output: string): unknown {
	const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(output);
	const candidate = fenced ? fenced[1] : output;
	const start = candidate.indexOf('[');
	const end = candidate.lastIndexOf(']');
	if (start === -1 || end <= start) throw new Error('no JSON array in model output');
	return JSON.parse(candidate.slice(start, end + 1));
}

function toFinding(raw: z.infer<typeof rawFindingSchema>): Finding {
	const endLine = raw.endLine && raw.endLine >= raw.line ? raw.endLine : raw.line;
	return {
		id: crypto.randomUUID(),
		file: raw.file,
		line: raw.line,
		endLine,
		severity: toBackendSeverity[raw.severity],
		message: `[${raw.category}] ${raw.body}`
	};
}

export interface RoleResult {
	role: ReviewRole;
	findings: Finding[];
}

/** Run one role over the diff. Returns validated findings (never throws on bad model output). */
export async function runRoleReview(
	role: ReviewRole,
	input: { diff: string; sandboxPath: string | null },
	events?: HarnessEvents
): Promise<RoleResult> {
	const log = (message: string) => events?.onLog?.(role, message);
	const limits = reviewLimits();
	const cfg = configForRole(role);
	const done = (findings: Finding[]): RoleResult => {
		events?.onAgentDone?.(role, findings.length);
		return { role, findings };
	};
	events?.onAgentStart?.(role);

	const files = parseUnifiedDiff(input.diff).slice(0, limits.maxFiles);
	const trimmedDiff =
		input.diff.length > limits.maxDiffChars
			? input.diff.slice(0, limits.maxDiffChars) + '\n…[diff truncated]'
			: input.diff;
	log(`reviewing ${files.length} files as ${role} (${cfg.model})`);

	// Focused context: full new-side content for the smallest files (most signal per token).
	let context = '';
	if (input.sandboxPath) {
		const smallest = [...files]
			.sort(
				(a, b) =>
					a.additions + a.deletions - (b.additions + b.deletions)
			)
			.slice(0, 5);
		for (const file of smallest) {
			const text = await readSandboxFile(input.sandboxPath, file.path, limits.maxFileChars);
			if (text !== null) context += `\n--- ${file.path} ---\n${text}`;
		}
	}

	const user = [
		`Role focus: ${ROLE_FOCUS[role]}`,
		'',
		'--- unified diff ---',
		trimmedDiff,
		context ? '\n--- file excerpts (new-side) ---' + context : ''
	].join('\n');

	let raw: unknown;
	try {
		const output = await chatCompletion({
			baseUrl: cfg.baseUrl,
			apiKey: cfg.apiKey,
			model: cfg.model,
			messages: [
				{ role: 'system', content: SYSTEM_PROMPT },
				{ role: 'user', content: user }
			],
			jsonMode: true,
			timeoutMs: 180_000
		});
		raw = extractFindingsJson(output);
	} catch (err) {
		log(`model call failed: ${err instanceof Error ? err.message : String(err)}`);
		return done([]);
	}

	const parsed = z.array(rawFindingSchema).safeParse(raw);
	if (!parsed.success) {
		log(`dropping invalid model output (${parsed.error.issues.length} schema issues)`);
		return done([]);
	}
	// Keep only findings anchored to files in this diff.
	const known = new Set(files.map((f) => f.path));
	const findings = parsed.data.filter((f) => known.has(f.file)).map(toFinding);
	log(`done: ${findings.length} finding(s)`);
	return done(findings);
}

/** Run all roles in parallel. */
export async function runAllRoles(
	input: { diff: string; sandboxPath: string | null },
	events?: HarnessEvents
): Promise<RoleResult[]> {
	const { REVIEW_ROLES } = await import('./models.js');
	return Promise.all(REVIEW_ROLES.map((role) => runRoleReview(role, input, events)));
}
