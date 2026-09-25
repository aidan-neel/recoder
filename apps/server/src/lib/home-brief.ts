import type { HomeBriefRequest, HomeBriefResponse, Review } from '@recoder/shared';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { serverDataDir } from './data-dir';
import { chatCompletion, LlmError } from './llm.js';
import { configForOrchestrator } from './models.js';

/**
 * The Home brief: a short, conversational read of the open PRs, written by the
 * orchestrator's model. Facts come from the client's PR list joined with the
 * stored reviews, so the model never guesses at review state.
 */

const SYSTEM_PROMPT = `You write the one-line brief at the top of a code-review app's home screen.
Say only the single most useful thing: the one pull request that most needs attention and why (open high-severity findings, a failed review, or the biggest one nobody has reviewed). Mention a second only if it is just as urgent. Do not list, count, or summarize the rest; leave everything unremarkable out.
Tone: a sharp colleague in passing. Plain and specific, no filler, no exclamation marks, no emoji. Do not greet; the page adds the greeting.
Refer to PRs only as #number. Mark at most one key phrase with **double asterisks**. Never mark a PR number.
Use only the facts provided. One or two short sentences, at most 25 words. Plain text only.`;

/** Bump when the prompt changes so a saved brief written by the old one is replaced. */
const BRIEF_VERSION = 3;

/**
 * One brief, kept on disk and rewritten at most every 12 hours
 * (RECODER_BRIEF_TTL_MS). PRs opening or reviews finishing don't trigger a
 * rewrite: Home shows live state everywhere else, and the brief is a digest.
 */
function briefTtlMs(): number {
	const raw = Number(process.env.RECODER_BRIEF_TTL_MS);
	return Number.isFinite(raw) && raw > 0 ? raw : 12 * 60 * 60_000;
}

function briefFile(): string {
	return join(serverDataDir(), 'home-brief.json');
}

function readStoredBrief(): HomeBriefResponse | null {
	try {
		const value = JSON.parse(readFileSync(briefFile(), 'utf8')) as HomeBriefResponse & { version?: number };
		if (value?.version !== BRIEF_VERSION) return null;
		return typeof value.text === 'string' && typeof value.generatedAt === 'string' ? value : null;
	} catch {
		return null;
	}
}

let stored: HomeBriefResponse | null | undefined;
let inflight: Promise<HomeBriefResponse> | null = null;

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
	if (review.status === 'failed') return "Recoder's last review run errored before finishing (a tool problem, not a verdict on the code; it needs a re-run)";
	const high = review.findings.filter((f) => f.severity === 'error').length;
	const medium = review.findings.filter((f) => f.severity === 'warning').length;
	const when = ageText(review.updatedAt, now).replace('opened', 'reviewed');
	if (review.findings.length === 0) return `${when}, clean`;
	const parts = [high && `${high} high`, medium && `${medium} medium`].filter(Boolean);
	const rest = review.findings.length - high - medium;
	if (rest) parts.push(`${rest} low/info`);
	return `${when}, ${parts.join(', ')} finding${review.findings.length === 1 ? '' : 's'}`;
}

/** Latest review per repo#pr, ignoring empty drafts when a real review exists. */
export function latestReviews(reviews: Review[]): Map<string, Review> {
	const latest = new Map<string, Review>();
	for (const review of reviews) {
		const key = `${review.repoId}#${review.prNumber}`;
		const current = latest.get(key);
		const rank = (r: Review) => (r.status === 'draft' ? 0 : 1);
		if (
			!current ||
			rank(review) > rank(current) ||
			(rank(review) === rank(current) && Date.parse(review.updatedAt) > Date.parse(current.updatedAt))
		) {
			latest.set(key, review);
		}
	}
	return latest;
}

export function briefFacts(input: HomeBriefRequest, reviews: Review[], now = Date.now()): string {
	const latest = latestReviews(reviews);
	const repos = new Set(input.prs.map((pr) => pr.repo));
	const lines = [
		`Open PRs: ${input.prs.length} across ${repos.size} repo${repos.size === 1 ? '' : 's'}.`
	];
	for (const pr of input.prs) {
		const review = latest.get(`${pr.repoId}#${pr.number}`);
		lines.push(
			`- ${pr.repo} #${pr.number} "${pr.title}": +${pr.additions} −${pr.deletions} in ${pr.changedFiles} files, ${ageText(pr.createdAt, now)}; ${reviewText(review, now)}.`
		);
	}
	if (input.emptyRepos?.length) lines.push(`Repos with no open PRs: ${input.emptyRepos.join(', ')}.`);
	return lines.join('\n');
}

/** Trim model output down to the brief itself. */
export function cleanBrief(raw: string): string {
	return raw
		.replace(/^\s*(brief:)?\s*/i, '')
		// Home adds its own greeting for the current time of day; a cached one would go stale.
		.replace(/^\**\s*(good\s+)?(morning|afternoon|evening|night)\b[^.!*]*[.!]\s*\**\s*/i, '')
		.replace(/^["“]|["”]$/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 600);
}

export async function homeBrief(input: HomeBriefRequest, reviews: Review[]): Promise<HomeBriefResponse> {
	const facts = briefFacts(input, reviews);
	const cfg = configForOrchestrator();
	if (stored === undefined) stored = readStoredBrief();
	if (stored && stored.model === cfg.model && Date.now() - Date.parse(stored.generatedAt) < briefTtlMs()) return stored;
	if (inflight) return inflight;

	const run = (async () => {
		try {
			const raw = await chatCompletion({
				provider: cfg.provider,
				reasoningEffort: cfg.reasoningEffort,
				baseUrl: cfg.baseUrl,
				apiKey: cfg.apiKey,
				model: cfg.model,
				messages: [
					{ role: 'system', content: SYSTEM_PROMPT },
					{ role: 'user', content: facts }
				],
				// Reasoning models spend output tokens thinking before the brief itself.
				maxTokens: 4000,
				thinking: false,
				timeoutMs: 60_000
			});
			const text = cleanBrief(raw);
			if (!text) throw new LlmError(0, 'model returned an empty brief');
			const value: HomeBriefResponse = { text, generatedAt: new Date().toISOString(), model: cfg.model };
			stored = value;
			try { writeFileSync(briefFile(), JSON.stringify({ ...value, version: BRIEF_VERSION })); } catch { /* Kept in memory for this run. */ }
			return value;
		} finally {
			inflight = null;
		}
	})();
	// Never let one stuck call hold every later request.
	inflight = Promise.race([
		run,
		new Promise<never>((_, reject) => setTimeout(() => reject(new LlmError(0, 'brief timed out')), 90_000))
	]).finally(() => { inflight = null; });
	return inflight;
}

export function clearHomeBriefCache(): void {
	stored = null;
	try { rmSync(briefFile(), { force: true }); } catch { /* Nothing stored. */ }
}
