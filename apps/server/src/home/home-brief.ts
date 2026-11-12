import {
	briefSnapshotKey,
	isHomeBriefResponse,
	latestReviews,
	repoLabels,
	type HomeBriefPr,
	type HomeBriefRef,
	type HomeBriefRequest,
	type HomeBriefResponse,
	type Repo,
	type Review
} from '@recoder/shared';
import { rmSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chatCompletion, LlmError } from '../models/llm.js';
import { configForOrchestrator } from '../models/models.js';
import { serverDataDir } from '../util/data-dir';

const SYSTEM_PROMPT = `You write the one-line brief at the top of a code-review app's home screen.
Say only the single most useful thing: the one pull request that most needs attention and why (open high-severity findings, a failed review, or the biggest one nobody has reviewed). Mention a second only if it is just as urgent. Do not list, count, or summarize the rest; leave everything unremarkable out.
Tone: a sharp colleague in passing. Plain and specific, no filler, no exclamation marks, no emoji. Do not greet; the page adds the greeting.
Refer to each PR by its bracketed tag from the facts, like [repoId#number]. Mark at most one key phrase with **double asterisks**. Never mark a PR tag.
Use only the facts provided. One or two short sentences, at most 25 words. Plain text only.`;

/** Bump when the prompt or stored response shape changes so an older cached brief is replaced. */
const BRIEF_VERSION = 4;

/** Output budget: reasoning models spend output tokens thinking before the brief itself. */
const BRIEF_MAX_TOKENS = 4000;

/** Never let one stuck call hold every later request. */
const BRIEF_TIMEOUT_MS = 90_000;

/**
 * Maximum age (RECODER_BRIEF_TTL_MS, default 12 hours) for a cached brief when
 * the open pull request snapshot (`repoId#number@headSha`) has not changed.
 */
function briefTtlMs(): number {
	const raw = Number(process.env.RECODER_BRIEF_TTL_MS);

	return Number.isFinite(raw) && raw > 0 ? raw : 12 * 60 * 60_000;
}

function briefFile(): string {
	return join(serverDataDir(), 'home-brief.json');
}

function isErrnoCode(err: unknown, code: string): boolean {
	return typeof err === 'object' && err !== null && 'code' in err && err.code === code;
}

async function readStoredBrief(): Promise<HomeBriefResponse | null> {
	let raw: string;

	try {
		raw = await readFile(briefFile(), 'utf8');
	} catch (err) {
		if (isErrnoCode(err, 'ENOENT')) return null;
		throw err;
	}

	let parsed: unknown;

	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		if (err instanceof SyntaxError) return null;
		throw err;
	}

	if (typeof parsed !== 'object' || parsed === null || !('version' in parsed) || parsed.version !== BRIEF_VERSION) {
		return null;
	}

	if (!isHomeBriefResponse(parsed)) return null;

	return {
		text: parsed.text,
		refs: parsed.refs,
		snapshot: parsed.snapshot,
		generatedAt: parsed.generatedAt,
		model: parsed.model
	};
}

let stored: HomeBriefResponse | null | undefined;
const inflight = new Map<string, Promise<HomeBriefResponse>>();
let latestGeneration = 0;

function ageText(iso: string, now: number): string {
	const t = Date.parse(iso);

	if (!Number.isFinite(t)) return 'unknown age';

	const hours = Math.max(0, (now - t) / 3_600_000);

	if (hours < 1) return 'opened within the hour';
	if (hours < 24) return `opened ${Math.round(hours)}h ago`;

	return `opened ${Math.round(hours / 24)}d ago`;
}

function reviewText(review: Review | undefined, now: number): string {
	if (!review) return 'never reviewed';
	if (review.status === 'draft') return 'review session open, not started';
	if (review.status === 'running' || review.status === 'queued') return 'review running now';
	if (review.status === 'failed')
		return "Recoder's last review run errored before finishing (a tool problem, not a verdict on the code; it needs a re-run)";

	const high = review.findings.filter((f) => f.severity === 'error').length;
	const medium = review.findings.filter((f) => f.severity === 'warning').length;
	const when = ageText(review.updatedAt, now).replace('opened', 'reviewed');

	if (review.findings.length === 0) return `${when}, clean`;

	const parts = [high && `${high} high`, medium && `${medium} medium`].filter(Boolean);
	const rest = review.findings.length - high - medium;

	if (rest) parts.push(`${rest} low/info`);

	return `${when}, ${parts.join(', ')} finding${review.findings.length === 1 ? '' : 's'}`;
}

function labelsForInput(input: HomeBriefRequest, repos: ReadonlyArray<Repo>): Map<string, string> {
	const knownIds = new Set(repos.map((repo) => repo.id));
	const combined: Pick<Repo, 'id' | 'name' | 'url' | 'provider'>[] = [...repos];

	for (const pr of input.prs) {
		if (knownIds.has(pr.repoId)) continue;
		knownIds.add(pr.repoId);
		combined.push({ id: pr.repoId, name: pr.repo, url: '', provider: 'github' });
	}

	return repoLabels(combined);
}

function emptyRepoNames(
	input: HomeBriefRequest,
	repos: ReadonlyArray<Repo>,
	labels: ReadonlyMap<string, string>
): string[] {
	if (!input.emptyRepos?.length) return [];

	const openIds = new Set(input.prs.map((pr) => pr.repoId));
	const emptyTracked = repos.filter((repo) => !openIds.has(repo.id));

	if (emptyTracked.length === input.emptyRepos.length) {
		return emptyTracked.map((repo) => labels.get(repo.id) ?? repo.name);
	}

	return input.emptyRepos;
}

function briefFacts(
	input: HomeBriefRequest,
	reviews: Review[],
	repos: ReadonlyArray<Repo>,
	labels: ReadonlyMap<string, string>,
	now = Date.now()
): string {
	const latest = latestReviews(reviews);
	const repoIds = new Set(input.prs.map((pr) => pr.repoId));
	const lines = [`Open PRs: ${input.prs.length} across ${repoIds.size} repo${repoIds.size === 1 ? '' : 's'}.`];

	for (const pr of input.prs) {
		const review = latest.get(`${pr.repoId}#${pr.number}`);
		const label = labels.get(pr.repoId) ?? pr.repo;
		const safeTitle = pr.title.replace(/\s+/g, ' ').trim();

		lines.push(
			`- [${pr.repoId}#${pr.number}] ${label} #${pr.number} "${safeTitle}": +${pr.additions} −${pr.deletions} in ${pr.changedFiles} files, ${ageText(pr.createdAt, now)}; ${reviewText(review, now)}.`
		);
	}

	const empty = emptyRepoNames(input, repos, labels);

	if (empty.length) lines.push(`Repos with no open PRs: ${empty.join(', ')}.`);

	return lines.join('\n');
}

/**
 * Trim model output down to the brief itself. A greeting is dropped: Home adds
 * its own for the current time of day, and a cached one would go stale.
 */
export function cleanBrief(raw: string): string {
	return raw
		.replace(/^\s*(brief:)?\s*/i, '')
		.replace(/^\**\s*(good\s+)?(morning|afternoon|evening|night)\b[^.!*]*[.!]\s*\**\s*/i, '')
		.replace(/^["“]|["”]$/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 600);
}

function resolveBareNumber(
	num: number,
	candidates: ReadonlyArray<HomeBriefPr>,
	preceding: string,
	labels: ReadonlyMap<string, string>
): HomeBriefRef | null {
	if (candidates.length === 1) return { repoId: candidates[0].repoId, number: num };
	if (candidates.length === 0) return null;

	const lower = preceding.toLowerCase();

	const ranked = candidates
		.map((candidate) => ({
			candidate,
			at: lower.lastIndexOf((labels.get(candidate.repoId) ?? candidate.repo).toLowerCase())
		}))
		.filter((entry) => entry.at >= 0)
		.sort((a, b) => b.at - a.at);

	if (ranked.length > 0 && (ranked.length === 1 || ranked[0].at > ranked[1].at)) {
		return { repoId: ranked[0].candidate.repoId, number: num };
	}

	return null;
}

function parseBriefRefs(
	raw: string,
	prs: ReadonlyArray<HomeBriefPr>,
	labels: ReadonlyMap<string, string>
): { text: string; refs: HomeBriefRef[] } {
	const cleaned = cleanBrief(raw);
	const byNumber = new Map<number, HomeBriefPr[]>();

	for (const pr of prs) {
		const list = byNumber.get(pr.number) ?? [];

		list.push(pr);
		byNumber.set(pr.number, list);
	}

	const refs: HomeBriefRef[] = [];
	const pattern = /\[([^\][\s#]+)#(\d+)\]|#(\d+)\b/g;
	let out = '';
	let lastIndex = 0;

	for (const match of cleaned.matchAll(pattern)) {
		const index = match.index ?? 0;

		out += cleaned.slice(lastIndex, index);
		lastIndex = index + match[0].length;

		const [, tagRepoId, tagNumber, bareNumber] = match;

		if (tagRepoId !== undefined && tagNumber !== undefined) {
			const num = Number(tagNumber);
			const candidates = byNumber.get(num) ?? [];
			const exact = prs.find((pr) => pr.repoId === tagRepoId && pr.number === num);
			const target = exact ?? (candidates.length === 1 ? candidates[0] : undefined);

			if (target) {
				refs.push({ repoId: target.repoId, number: target.number });

				const label = labels.get(target.repoId) ?? target.repo;
				const alreadyNamed = out.trimEnd().toLowerCase().endsWith(label.toLowerCase());

				out += candidates.length > 1 && !alreadyNamed ? `${label} #${num}` : `#${num}`;
			} else {
				out += `#${num}`;
			}
		} else if (bareNumber !== undefined) {
			const num = Number(bareNumber);
			const resolved = resolveBareNumber(num, byNumber.get(num) ?? [], out, labels);

			if (resolved) refs.push(resolved);
			out += `#${num}`;
		}
	}

	out += cleaned.slice(lastIndex);

	return { text: cleanBrief(out), refs };
}

/**
 * The Home brief: a short, conversational read of the open PRs, written by the
 * orchestrator's model. Cached on disk per open-PR snapshot (`repoId#number@headSha`),
 * carrying structured PR references so the UI links and actions match the prose.
 */
export async function homeBrief(
	input: HomeBriefRequest,
	reviews: Review[],
	repos: Repo[] = []
): Promise<HomeBriefResponse> {
	const snapshot = briefSnapshotKey(input.prs);
	const cfg = configForOrchestrator();

	if (stored === undefined) stored = await readStoredBrief();

	if (
		stored &&
		stored.model === cfg.model &&
		stored.snapshot === snapshot &&
		Date.now() - Date.parse(stored.generatedAt) < briefTtlMs()
	) {
		return stored;
	}

	const cacheKey = `${cfg.model}\0${snapshot}`;
	const running = inflight.get(cacheKey);

	if (running) return running;

	const generation = ++latestGeneration;
	const labels = labelsForInput(input, repos);
	const facts = briefFacts(input, reviews, repos, labels);

	const run = (async () => {
		const raw = await chatCompletion({
			...cfg,
			messages: [
				{ role: 'system', content: SYSTEM_PROMPT },
				{ role: 'user', content: facts }
			],
			maxTokens: BRIEF_MAX_TOKENS,
			thinking: false,
			timeoutMs: 60_000
		});

		const { text, refs } = parseBriefRefs(raw, input.prs, labels);

		if (!text) throw new LlmError(0, 'model returned an empty brief');

		const value: HomeBriefResponse = {
			text,
			refs,
			snapshot,
			generatedAt: new Date().toISOString(),
			model: cfg.model
		};

		if (generation === latestGeneration) {
			stored = value;
			await writeFile(briefFile(), JSON.stringify({ ...value, version: BRIEF_VERSION }));
		}

		return value;
	})();

	let timeoutId: ReturnType<typeof setTimeout> | undefined;

	const raced = Promise.race([
		run,
		new Promise<never>((_, reject) => {
			timeoutId = setTimeout(() => reject(new LlmError(0, 'brief timed out')), BRIEF_TIMEOUT_MS);
		})
	]).finally(() => {
		if (timeoutId !== undefined) clearTimeout(timeoutId);
		inflight.delete(cacheKey);
	});

	inflight.set(cacheKey, raced);

	return raced;
}

export function clearHomeBriefCache(): void {
	stored = undefined;
	inflight.clear();
	latestGeneration++;
	rmSync(briefFile(), { force: true });
}
