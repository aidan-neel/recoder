import type { Provider, Repo } from '@recoder/shared';
import { gitlabGet } from './gitlab-api.js';
import { githubRest } from './github-rest.js';
import { detectProvider, parseSlug } from './providers.js';
import { tokenEnv } from './tokens.js';

/**
 * Who is on a pull request and what it is for: reviewers, assignees, labels
 * and linked issues (with their descriptions and blocking links). The
 * orchestrator plans with it. Best effort: any failure yields ''.
 */

const MAX_CONTEXT_CHARS = 8_000;
const MAX_ISSUE_BODY = 1_200;
const MAX_ISSUES = 6;

interface IssueContext {
	ref: string;
	title: string;
	state: string;
	labels: string[];
	body: string;
	links: string[];
	/** Why it is linked: closes, mentioned. */
	relation: string;
}

interface PrContext {
	author: string | null;
	reviewers: string[];
	assignees: string[];
	labels: string[];
	milestone: string | null;
	draft: boolean;
	issues: IssueContext[];
}

function names(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) => {
		const row = item as Record<string, unknown> | null;
		const name = row?.username ?? row?.login ?? row?.name;
		return typeof name === 'string' ? [name] : [];
	});
}

function labelNames(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) => (typeof item === 'string' ? [item] : typeof (item as { name?: unknown })?.name === 'string' ? [(item as { name: string }).name] : []));
}

function clip(text: unknown, max: number): string {
	const clean = typeof text === 'string' ? text.trim() : '';
	return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

async function gitlabContext(repo: Repo, iid: number): Promise<PrContext> {
	const env = tokenEnv('gitlab', repo.url);
	const project = `projects/${encodeURIComponent(parseSlug(repo.url))}`;
	const mr = (await gitlabGet(`${project}/merge_requests/${iid}`, env)) as Record<string, unknown>;
	const [closes, related] = await Promise.all([
		gitlabGet(`${project}/merge_requests/${iid}/closes_issues`, env).catch(() => []),
		gitlabGet(`${project}/merge_requests/${iid}/related_issues`, env).catch(() => [])
	]);
	const seen = new Set<string>();
	const linked = [
		...(closes as Record<string, unknown>[]).map((issue) => ({ issue, relation: 'closes' })),
		...(related as Record<string, unknown>[]).map((issue) => ({ issue, relation: 'mentioned' }))
	].filter(({ issue }) => {
		const key = `${issue.project_id}#${issue.iid}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	}).slice(0, MAX_ISSUES);

	const issues = await Promise.all(
		linked.map(async ({ issue, relation }) => {
			const issueProject = `projects/${issue.project_id}`;
			const links = (await gitlabGet(`${issueProject}/issues/${issue.iid}/links`, env).catch(() => [])) as Record<string, unknown>[];
			return {
				ref: typeof (issue.references as { full?: unknown })?.full === 'string' ? (issue.references as { full: string }).full : `#${issue.iid}`,
				title: String(issue.title ?? ''),
				state: String(issue.state ?? ''),
				labels: labelNames(issue.labels),
				body: clip(issue.description, MAX_ISSUE_BODY),
				relation,
				links: links.map((link) => {
					const kind = link.link_type === 'blocks' ? 'blocks' : link.link_type === 'is_blocked_by' ? 'is blocked by' : 'relates to';
					const ref = (link.references as { full?: unknown })?.full ?? `#${link.iid}`;
					return `${kind} ${ref} "${String(link.title ?? '')}" (${String(link.state ?? '')})`;
				})
			};
		})
	);
	const milestone = mr.milestone as { title?: unknown } | null;
	return {
		author: names([mr.author])[0] ?? null,
		reviewers: names(mr.reviewers),
		assignees: names(mr.assignees),
		labels: labelNames(mr.labels),
		milestone: typeof milestone?.title === 'string' ? milestone.title : null,
		draft: mr.draft === true || mr.work_in_progress === true,
		issues
	};
}

/** GitHub has no REST link from a PR to the issues it closes, so read "Closes #12" style references. */
function closingRefs(body: string): number[] {
	const refs = [...body.matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+#(\d+)/gi)].map((match) => Number(match[1]));
	return [...new Set(refs)].slice(0, MAX_ISSUES);
}

async function githubContext(repo: Repo, number: number): Promise<PrContext> {
	const slug = parseSlug(repo.url);
	const pr = (await githubRest(`repos/${slug}/pulls/${number}`)) as Record<string, unknown>;
	const issues = await Promise.all(
		closingRefs(typeof pr.body === 'string' ? pr.body : '').map(async (n): Promise<IssueContext | null> => {
			const issue = (await githubRest(`repos/${slug}/issues/${n}`).catch(() => null)) as Record<string, unknown> | null;
			if (!issue) return null;
			return {
				ref: `#${n}`,
				title: String(issue.title ?? ''),
				state: String(issue.state ?? ''),
				labels: labelNames(issue.labels),
				body: clip(issue.body, MAX_ISSUE_BODY),
				relation: 'closes',
				links: []
			};
		})
	);
	const milestone = pr.milestone as { title?: unknown } | null;
	return {
		author: names([pr.user])[0] ?? null,
		reviewers: [...names(pr.requested_reviewers), ...names(pr.requested_teams)],
		assignees: names(pr.assignees),
		labels: labelNames(pr.labels),
		milestone: typeof milestone?.title === 'string' ? milestone.title : null,
		draft: pr.draft === true,
		issues: issues.filter((issue): issue is IssueContext => issue !== null)
	};
}

export function formatPrContext(ctx: PrContext): string {
	const lines = [
		ctx.author ? `Author: ${ctx.author}` : '',
		`Reviewers: ${ctx.reviewers.join(', ') || '(none)'}`,
		`Assignees: ${ctx.assignees.join(', ') || '(none)'}`,
		ctx.labels.length ? `Labels: ${ctx.labels.join(', ')}` : '',
		ctx.milestone ? `Milestone: ${ctx.milestone}` : '',
		ctx.draft ? 'Status: draft' : ''
	].filter(Boolean);
	if (ctx.issues.length === 0) lines.push('Linked issues: (none)');
	for (const issue of ctx.issues) {
		lines.push(
			'',
			`Linked issue ${issue.ref} (${issue.relation}, ${issue.state}): ${issue.title}`,
			...(issue.labels.length ? [`  Labels: ${issue.labels.join(', ')}`] : []),
			...issue.links.map((link) => `  ${link}`),
			...(issue.body ? [`  Description:\n${issue.body.replace(/^/gm, '    ')}`] : [])
		);
	}
	const text = lines.join('\n');
	return text.length > MAX_CONTEXT_CHARS ? `${text.slice(0, MAX_CONTEXT_CHARS)}\n…(truncated)` : text;
}

export async function fetchPrContext(repo: Repo, number: number, provider?: Provider): Promise<string> {
	try {
		const source = provider ?? repo.provider ?? detectProvider(repo.url);
		return formatPrContext(source === 'gitlab' ? await gitlabContext(repo, number) : await githubContext(repo, number));
	} catch {
		return '';
	}
}
