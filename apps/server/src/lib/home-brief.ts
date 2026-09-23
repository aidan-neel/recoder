import type { HomeBriefRequest, HomeBriefResponse, Review } from '@recoder/shared';
import { chatCompletion, LlmError } from './llm.js';
import { configForOrchestrator } from './models.js';

/**
 * The Home brief: a short, conversational read of the open PRs, written by the
 * orchestrator's model. Facts come from the client's PR list joined with the
 * stored reviews, so the model never guesses at review state.
 */

const SYSTEM_PROMPT = `You write the brief at the top of a code-review app's home screen: two or three short sentences telling the developer where their open pull requests stand.
Tone: a sharp colleague catching them up. Conversational, specific, no filler, no exclamation marks, no emoji.
Start with the greeting you are given, then say how many PRs are open across how many repos. Then point at what deserves attention: the biggest unreviewed PR, open high-severity findings, failed or running reviews. Skip anything unremarkable.
Refer to PRs only as #number. Mark the greeting and at most two key phrases with **double asterisks**. Never mark a PR number.
Use only the facts provided. At most 60 words. Plain text only.`;

const CACHE_TTL_MS = 30 * 60_000;
const cache = new Map<string, { at: number; value: HomeBriefResponse }>();
const inflight = new Map<string, Promise<HomeBriefResponse>>();

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
	if (review.status === 'failed') return 'last review failed';
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

const GREETING: Record<HomeBriefRequest['dayPart'], string> = {
	morning: 'Morning',
	afternoon: 'Afternoon',
	evening: 'Evening',
	night: 'Evening'
};

export function briefFacts(input: HomeBriefRequest, reviews: Review[], now = Date.now()): string {
	const latest = latestReviews(reviews);
	const greeting = `${GREETING[input.dayPart]}${input.name ? `, ${input.name}` : ''}.`;
	const repos = new Set(input.prs.map((pr) => pr.repo));
	const lines = [
		`Greeting: ${greeting}`,
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
		.replace(/^["“]|["”]$/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 600);
}

export async function homeBrief(input: HomeBriefRequest, reviews: Review[]): Promise<HomeBriefResponse> {
	const facts = briefFacts(input, reviews);
	const cfg = configForOrchestrator();
	const key = `${cfg.model}\n${facts.replace(/opened [^;,]*|reviewed [^;,]*/g, '')}`;
	const hit = cache.get(key);
	if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
	const pending = inflight.get(key);
	if (pending) return pending;

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
				maxTokens: 400,
				timeoutMs: 60_000
			});
			const text = cleanBrief(raw);
			if (!text) throw new LlmError(0, 'model returned an empty brief');
			const value: HomeBriefResponse = { text, generatedAt: new Date().toISOString(), model: cfg.model };
			cache.set(key, { at: Date.now(), value });
			return value;
		} finally {
			inflight.delete(key);
		}
	})();
	inflight.set(key, run);
	return run;
}

export function clearHomeBriefCache(): void {
	cache.clear();
}
