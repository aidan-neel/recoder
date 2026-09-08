import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { parseUnifiedDiff, type FileDiff, type Finding, type FindingSeverity, type ReviewTask } from '@recoder/shared';
import { chatCompletion } from './llm.js';
import { configForRole, reviewLimits, type ReviewRole } from './models.js';
import { extraExcludes, scopeReviewFiles } from './review-scope.js';
import { REVIEW_ROLES, ROLE_FOCUS } from './roles.js';

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

/** Three explorer scouts per role; each takes a slice of the changed files. */
const SCOUTS_PER_ROLE = 3;

/**
 * File context per scout (chars). Scouts flag candidates from the diff plus
 * file heads (imports, conventions); the synthesizer verifies against full
 * excerpts. Keeps the 30-scout fan-out fast on local models.
 */
const SCOUT_MAX_FILE_CHARS = 4000;

/**
 * Shared spine for every reviewer: fierce staff engineer, not polite
 * assistant. Findings need file:line evidence, never vibes — and the
 * codebase's own idioms outrank textbook patterns.
 */
const REVIEW_PERSONA = `You are a fierce staff engineer doing review, not a polite assistant. You have strong opinions and you defend them with evidence.
Every finding must cite concrete file:line evidence from the diff or excerpts below. No vibes, no generic advice, no style crusades.
Respect this codebase's own grain: the file excerpts show how this repo actually does things. Never prescribe a pattern the codebase itself rejects (no OOP in a functional codebase, no framework idioms it doesn't use). Call out code that fights the local conventions instead.
Rank ruthlessly: a short list of real, evidenced issues beats a long list of nits. Zero findings is a valid, honorable outcome.`;

const SYSTEM_PROMPT = `You are a read-only code reviewer. You cannot change code, run commands, or access anything outside the provided diff and file excerpts.
Review only what is shown. Do not invent files, lines, or behavior you cannot see.
Be concise: each finding body is one or two short sentences stating the problem and, where obvious, the fix. No background, no explanations of your reasoning.
The body is rendered as markdown: use inline code for identifiers (names, files, symbols). You may add ONE short fenced code block, and only when showing the exact snippet or fix genuinely helps — never for prose. No headings, lists, quotes, bold, or emojis.
If the diff is clean, return {"findings":[]}. There is no quota — zero findings is the correct answer for good code.
Output STRICT JSON object: {"findings":[{"file": string, "line": number, "endLine": number, "severity": "high"|"medium"|"low"|"info", "category": string, "body": string}]}.
"line"/"endLine" are NEW-side line numbers from the diff. Use "high" only for issues that are certainly reachable and damaging. {"findings":[]} is valid when there is nothing worth flagging. No prose outside the JSON object.
${REVIEW_PERSONA}`;

const scoutNoteSchema = z.object({
	file: z.string().min(1).max(500),
	line: z.number().int().positive(),
	note: z.string().min(1).max(1000)
});

/** Render one file's hunks back into unified-diff text for a scout's slice. */
function renderMiniDiff(file: FileDiff): string {
	const hunks = file.hunks
		.map((hunk) => {
			const lines = hunk.lines
				.map((line) => (line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ') + line.text)
				.join('\n');
			return `${hunk.header}\n${lines}`;
		})
		.join('\n');
	return `--- a/${file.path}\n+++ b/${file.path}\n${hunks}`;
}

/**
 * One explorer scout: reads its slice of files and returns compact
 * observations for the role's lens. Never throws — a blind scout just
 * yields no notes and the synthesizer falls back to the raw diff.
 */
async function runScout(
	role: ReviewRole,
	scoutIndex: number,
	files: FileDiff[],
	input: { sandboxPath: string | null; maxFileChars: number; batch: number; batches: number },
	model: { baseUrl: string; apiKey: string; model: string },
	log: (message: string) => void,
	onTask?: HarnessEvents['onTask']
): Promise<string> {
	const label = `scout ${scoutIndex + 1}/${SCOUTS_PER_ROLE}`;
	const startedAt = new Date().toISOString();
	const report = (status: ReviewTask['status'], message: string, extra: Partial<ReviewTask> = {}) => onTask?.({
		id: role + ':' + input.batch + ':scout:' + scoutIndex,
		agent: role, label: 'Scout ' + (scoutIndex + 1), scout: scoutIndex + 1,
		batch: input.batch, batches: input.batches, model: model.model,
		files: files.map((file) => file.path), startedAt, status, message, ...extra
	});
	if (!files.length) {
		report('skipped', 'No files assigned');
		return '';
	}
	report('running', 'Reading ' + files.length + ' assigned files');
	try {
		let context = '';
		if (input.sandboxPath) {
			for (const file of files) {
				report('running', 'Reading ' + file.path, { currentFile: file.path });
				const text = await readSandboxFile(input.sandboxPath, file.path, input.maxFileChars);
				if (text !== null) context += `\n--- ${file.path} ---\n${text}`;
			}
		}
		const miniDiff = files.map(renderMiniDiff).join('\n').slice(0, 30000);
		const user = [
			`You are scouting for a ${role} review. Lens: ${ROLE_FOCUS[role]}`,
			'',
			'--- assigned changed files (unified diff) ---',
			miniDiff || '(no hunks assigned)',
			context ? '\n--- file excerpts (new-side) ---' + context : '',
			'',
			'List every observation relevant to your lens as a JSON array: [{"file": string, "line": number, "note": string}]. "line" is a NEW-side line number. Flag anything suspicious — the synthesizer decides what becomes a finding. [] is valid. No prose outside the JSON array.'
		].join('\n');
		log(`${label}: exploring ${files.map((f) => f.path).join(', ') || 'nothing'}…`);
		const output = await chatCompletion({
			onProgress: (status, elapsedMs) => report(status, status === 'queued' ? 'Waiting for a model slot' : 'Examining assigned changes', { elapsedMs, currentFile: undefined }),
			baseUrl: model.baseUrl,
			apiKey: model.apiKey,
			model: model.model,
			messages: [
				{
					role: 'system',
					content: `You are a scout for a ${role} code review. ${REVIEW_PERSONA}`
				},
				{ role: 'user', content: user }
			],
			temperature: 0.2,
			timeoutMs: 120_000
		});
		const parsed = z.array(scoutNoteSchema).safeParse(extractFindingsJson(output));
		if (!parsed.success) {
			report('error', 'Scout returned invalid notes; specialist will use the diff');
			log(`${label}: no usable notes`);
			return '';
		}
		log(`${label}: ${parsed.data.length} note(s)`);
		report('done', 'Finished scouting · ' + parsed.data.length + ' observations', { currentFile: undefined });
		return parsed.data.map((n) => `${n.file}:${n.line} — ${n.note}`).join('\n');
	} catch (err) {
		report('error', err instanceof Error ? err.message : 'Scout failed');
		log(`${label} failed: ${err instanceof Error ? err.message : String(err)}`);
		return '';
	}
}

export interface HarnessEvents {
	onTask?: (task: Omit<ReviewTask, 'updatedAt'>) => void;
	onLog?: (role: ReviewRole, message: string) => void;
	onAgentStart?: (role: ReviewRole, model: string) => void;
	onAgentDone?: (role: ReviewRole, findings: number) => void;
	onFiles?: (role: ReviewRole, files: string[]) => void;
	/** Fired with the validated findings just before `onAgentDone`. */
	onFindings?: (role: ReviewRole, findings: Finding[]) => void;
}

/** Safely read a sandbox file (stays inside the checkout, capped length). */
export async function readSandboxFile(sandboxPath: string, file: string, maxChars: number): Promise<string | null> {
	const resolved = resolve(join(sandboxPath, file));
	if (!resolved.startsWith(resolve(sandboxPath) + '/')) return null;
	try {
		const [root, target] = await Promise.all([realpath(sandboxPath), realpath(resolved)]);
		if (!target.startsWith(root + '/')) return null;
		const text = await readFile(target, 'utf8');
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
function unwrapFindings(parsed: unknown): unknown {
	if (Array.isArray(parsed)) return parsed;
	if (parsed && typeof parsed === 'object') {
		const obj = parsed as Record<string, unknown>;
		for (const key of ['findings', 'items', 'results', 'issues']) {
			if (Array.isArray(obj[key])) return obj[key];
		}
		if (typeof obj.file === 'string') return [obj];
	}
	throw new Error('no JSON array in model output');
}

/** Pull a findings array out of model output (tolerates fences/prose/object wrappers). */
export function extractFindingsJson(output: string): unknown {
	const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(output);
	const candidate = (fenced ? fenced[1] : output).trim();
	try {
		return unwrapFindings(JSON.parse(candidate));
	} catch {
		// Fall through to sliced extraction — models often wrap JSON in prose.
	}
	const start = candidate.indexOf('[');
	const end = candidate.lastIndexOf(']');
	if (start !== -1 && end > start) {
		return JSON.parse(candidate.slice(start, end + 1));
	}
	const objStart = candidate.indexOf('{');
	const objEnd = candidate.lastIndexOf('}');
	if (objStart !== -1 && objEnd > objStart) {
		return unwrapFindings(JSON.parse(candidate.slice(objStart, objEnd + 1)));
	}
	throw new Error('no JSON array in model output');
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
	input: { diff: string; sandboxPath: string | null; batch?: number; batches?: number },
	events?: HarnessEvents
): Promise<RoleResult> {
	const log = (message: string) => events?.onLog?.(role, message);
	const limits = reviewLimits();
	const cfg = configForRole(role);
	const batch = input.batch ?? 1;
	const batches = input.batches ?? 1;
	const synthesis = (status: ReviewTask['status'], message: string, elapsedMs?: number) => events?.onTask?.({
		id: role + ':' + batch + ':synthesis', agent: role, label: 'Verify findings',
		model: cfg.model, batch, batches, status, message, elapsedMs
	});
	const done = (findings: Finding[]): RoleResult => {
		if (findings.length > 0) events?.onFindings?.(role, findings);
		events?.onAgentDone?.(role, findings.length);
		return { role, findings };
	};
	events?.onAgentStart?.(role, cfg.model);

	// Review scope first: build output, lockfiles, and binaries never enter
	// model context (they stay visible in the diff view regardless).
	const { included, skipped } = scopeReviewFiles(parseUnifiedDiff(input.diff), extraExcludes());
	for (const s of skipped) log(`skipping ${s.path} (${s.reason})`);
	const files = included.slice(0, limits.maxFiles);
	if (included.length === 0) {
		for (let i = 0; i < SCOUTS_PER_ROLE; i++) events?.onTask?.({
			id: role + ':' + batch + ':scout:' + i, agent: role, label: 'Scout ' + (i + 1),
			scout: i + 1, batch, batches, status: 'skipped', message: 'No reviewable files'
		});
		synthesis('skipped', 'No reviewable files');
		log('no reviewable files in scope');
		return done([]);
	}
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
	// Model-facing diff covers in-scope files only, so build noise can't eat
	// the context budget.
	const scopedDiff = files.map(renderMiniDiff).join('\n');
	const trimmedDiff =
		scopedDiff.length > limits.maxDiffChars
			? scopedDiff.slice(0, limits.maxDiffChars) + '\n…[diff truncated]'
			: scopedDiff;

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

	// Explorer fan-out: three scouts split the files round-robin so every
	// corner gets eyes before the role synthesizes its verdict.
	const slices: FileDiff[][] = Array.from({ length: SCOUTS_PER_ROLE }, () => []);
	files.forEach((file, i) => slices[i % SCOUTS_PER_ROLE].push(file));
	const scoutNotes = (
		await Promise.all(
			slices.map((slice, i) =>
				runScout(
					role,
					i,
					slice,
					{ sandboxPath: input.sandboxPath, maxFileChars: SCOUT_MAX_FILE_CHARS, batch, batches },
					cfg,
					log,
					events?.onTask
				)
			)
		)
	).filter(Boolean);

	const user = [
		`Role focus: ${ROLE_FOCUS[role]}`,
		'',
		'--- unified diff ---',
		trimmedDiff,
		context ? '\n--- file excerpts (new-side) ---' + context : '',
		scoutNotes.length > 0
			? '\n--- explorer scout notes (verify each against the diff before citing) ---\n' +
				scoutNotes.join('\n')
			: ''
	].join('\n');

	let raw: unknown;
	try {
		log(`sending ${user.length} chars to ${cfg.model}…`);
		const seed = Number(process.env.RECODER_REVIEW_SEED);
		const output = await chatCompletion({
			onProgress: (status, elapsedMs) => synthesis(status, status === 'queued' ? 'Waiting for a model slot' : 'Checking scout observations against the diff', elapsedMs),
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
		synthesis('running', 'Validating findings and file references');
		raw = extractFindingsJson(output);
	} catch (err) {
		synthesis('error', err instanceof Error ? err.message : 'Specialist failed');
		log(`model call failed: ${err instanceof Error ? err.message : String(err)}`);
		return done([]);
	}

	const parsed = z.array(rawFindingSchema).safeParse(raw);
	if (!parsed.success) {
		synthesis('error', 'Specialist returned invalid findings');
		log(`dropping invalid model output (${parsed.error.issues.length} schema issues)`);
		return done([]);
	}
	// Keep only findings anchored to in-scope files in this diff.
	const known = new Set(files.map((f) => f.path));
	const findings = parsed.data
		.filter((f) => known.has(f.file))
		.map((f) => toFinding(f, role, cfg.model, anchorText));
	const dropped = parsed.data.length - findings.length;
	if (dropped > 0) log(`dropping ${dropped} finding(s) outside review scope`);
	for (const finding of findings) {
		const body = finding.message.replace(/^\[[^\]]+\]\s*/, '');
		log(`${finding.file}${finding.line ? `:${finding.line}` : ''} · ${body}`);
	}
	log(`done: ${findings.length} finding(s)`);
		synthesis('done', 'Verified ' + findings.length + ' findings');
	return done(findings);
}

/** Partition large reviews so the per-request file limit never drops later files. */
export function reviewBatches(diff: string, maxFiles: number, maxDiffChars: number): string[] {
	const { included } = scopeReviewFiles(parseUnifiedDiff(diff), extraExcludes());
	const batches: string[] = [];
	let parts: string[] = [];
	let chars = 0;
	for (const file of included) {
		const patch = 'diff --git a/' + file.path + ' b/' + file.path + '\n' + renderMiniDiff(file);
		if (parts.length && (parts.length >= maxFiles || chars + patch.length > maxDiffChars)) {
			batches.push(parts.join('\n'));
			parts = [];
			chars = 0;
		}
		parts.push(patch);
		chars += patch.length + 1;
	}
	if (parts.length) batches.push(parts.join('\n'));
	return batches;
}

/** Roles run in parallel; batches run sequentially to bound model concurrency. */
export async function runAllRoles(
	input: { diff: string; sandboxPath: string | null },
	events?: HarnessEvents
): Promise<RoleResult[]> {
	const { REVIEW_ROLES } = await import('./models.js');
	const limits = reviewLimits();
	const batches = reviewBatches(input.diff, limits.maxFiles, limits.maxDiffChars);
	if (!batches.length) batches.push(input.diff);
	for (const role of REVIEW_ROLES) {
		for (let batch = 1; batch <= batches.length; batch++) {
			for (let scout = 0; scout < SCOUTS_PER_ROLE; scout++) events?.onTask?.({
				id: role + ':' + batch + ':scout:' + scout, agent: role, label: 'Scout ' + (scout + 1),
				scout: scout + 1, batch, batches: batches.length, status: 'queued', message: 'Waiting for batch ' + batch
			});
			events?.onTask?.({
				id: role + ':' + batch + ':synthesis', agent: role, label: 'Verify findings',
				batch, batches: batches.length, status: 'queued', message: 'Waiting for scout observations'
			});
		}
	}
	return Promise.all(REVIEW_ROLES.map(async (role) => {
		const findings: Finding[] = [];
		for (const [index, diff] of batches.entries()) {
			events?.onLog?.(role, 'Reviewing batch ' + (index + 1) + '/' + batches.length);
			const result = await runRoleReview(role, { ...input, diff, batch: index + 1, batches: batches.length }, {
				...events,
				onAgentStart: index === 0 ? events?.onAgentStart : undefined,
				onAgentDone: undefined
			});
			findings.push(...result.findings);
		}
		events?.onAgentDone?.(role, findings.length);
		return { role, findings };
	}));
}
