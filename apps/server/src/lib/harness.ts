import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { parseUnifiedDiff, type FileDiff, type Finding, type FindingSeverity } from '@recoder/shared';
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
Be concise: each finding body is one short sentence stating the problem and, where obvious, the fix. No background, no explanations of your reasoning.
If the diff is clean, return []. There is no quota — zero findings is the correct answer for good code.
Output STRICT JSON: an array of findings, each {"file": string, "line": number, "endLine": number, "severity": "high"|"medium"|"low"|"info", "category": string, "body": string}.
"line"/"endLine" are NEW-side line numbers from the diff. Use "high" only for issues that are certainly reachable and damaging. An empty array [] is valid when there is nothing worth flagging. No prose outside the JSON array.`;

export interface HarnessEvents {
	onLog?: (role: ReviewRole, message: string) => void;
	onAgentStart?: (role: ReviewRole, model: string) => void;
	onAgentDone?: (role: ReviewRole, findings: number) => void;
	onFiles?: (role: ReviewRole, files: string[]) => void;
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
/** Pull a JSON array out of model output (tolerates fences/prose). */
export function extractFindingsJson(output: string): unknown {
	const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(output);
	const candidate = fenced ? fenced[1] : output;
	const start = candidate.indexOf('[');
	const end = candidate.lastIndexOf(']');
	if (start === -1 || end <= start) throw new Error('no JSON array in model output');
	return JSON.parse(candidate.slice(start, end + 1));
}

function toFinding(
	raw: z.infer<typeof rawFindingSchema>,
	role: ReviewRole,
	model: string,
	anchorText: (file: string, startLine: number, endLine: number) => string
): Finding {
	const endLine = raw.endLine && raw.endLine >= raw.line ? raw.endLine : raw.line;
	return {
		id: crypto.randomUUID(),
		file: raw.file,
		line: raw.line,
		endLine,
		severity: toBackendSeverity[raw.severity],
		message: `[${raw.category}] ${raw.body}`,
		agent: role,
		model,
		fingerprint: fingerprintFinding(raw.file, raw.category, anchorText(raw.file, raw.line, endLine))
	};
}

/** Normalize anchor code so cosmetic differences don't change the fingerprint. */
function normalizeAnchor(text: string): string {
	return text
		.split('\n')
		.map((line) => line.trim().replace(/\s+/g, ' '))
		.filter(Boolean)
		.join('\n');
}

/**
 * Stability fingerprint for a finding: file + category + normalized anchor
 * code. Line numbers are deliberately excluded so findings survive line
 * shifts; wording is excluded so rephrased duplicates still match.
 */
export function fingerprintFinding(file: string, category: string, anchorText: string): string {
	return createHash('sha256')
		.update(`${file}\n${category}\n${normalizeAnchor(anchorText)}`)
		.digest('hex')
		.slice(0, 16);
}

/**
 * Drop findings already reported by earlier reviews (by fingerprint) and
 * collapse in-run duplicates. Returns the genuinely new findings.
 */
export function filterNewFindings(
	current: Finding[],
	previousFingerprints: Set<string>
): { fresh: Finding[]; suppressed: number } {
	const seen = new Set<string>();
	const fresh: Finding[] = [];
	let suppressed = 0;
	for (const finding of current) {
		const fp = finding.fingerprint;
		if (!fp || previousFingerprints.has(fp) || seen.has(fp)) {
			suppressed++;
			continue;
		}
		seen.add(fp);
		fresh.push(finding);
	}
	return { fresh, suppressed };
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
	events?.onAgentStart?.(role, cfg.model);

	const files = parseUnifiedDiff(input.diff).slice(0, limits.maxFiles);
	events?.onFiles?.(role, files.map((f) => f.path));

	// New-side line text per file, for stability fingerprints.
	const anchorLines = new Map<string, Map<number, string>>();
	for (const file of files) {
		const lines = new Map<number, string>();
		for (const hunk of file.hunks) {
			for (const line of hunk.lines) {
				if (line.newNo !== null) lines.set(line.newNo, line.text);
			}
		}
		anchorLines.set(file.path, lines);
	}
	const anchorText = (file: string, startLine: number, endLine: number): string => {
		const lines = anchorLines.get(file);
		if (!lines) return '';
		const out: string[] = [];
		for (let n = startLine; n <= endLine; n++) {
			const text = lines.get(n);
			if (text !== undefined) out.push(text);
		}
		return out.join('\n');
	};
	const trimmedDiff =
		input.diff.length > limits.maxDiffChars
			? input.diff.slice(0, limits.maxDiffChars) + '\n…[diff truncated]'
			: input.diff;

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
			if (text !== null) {
				log(`reading ${file.path} (${text.length} chars)`);
				context += `\n--- ${file.path} ---\n${text}`;
			} else {
				log(`skipping ${file.path} (unreadable)`);
			}
		}
	} else {
		log('no sandbox — diff only');
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
		log(`sending ${user.length} chars to ${cfg.model}…`);
		const seed = Number(process.env.RECODER_REVIEW_SEED);
		const output = await chatCompletion({
			baseUrl: cfg.baseUrl,
			apiKey: cfg.apiKey,
			model: cfg.model,
			messages: [
				{ role: 'system', content: SYSTEM_PROMPT },
				{ role: 'user', content: user }
			],
			jsonMode: true,
			temperature: 0,
			...(Number.isFinite(seed) ? { seed } : {}),
			timeoutMs: 180_000
		});
		log(`parsing response (${output.length} chars)…`);
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
	const findings = parsed.data
		.filter((f) => known.has(f.file))
		.map((f) => toFinding(f, role, cfg.model, anchorText));
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
