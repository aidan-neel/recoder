import type { PrCheck, Repo } from '@recoder/shared';
import { GhError } from './gh.js';
import { githubRest } from './github-rest.js';
import { glabApi, glabApiText } from './glab.js';
import { detectProvider, parseSlug } from './providers.js';
import { tokenEnv } from './tokens.js';

/**
 * CI checks on a commit or branch: GitHub check runs plus legacy commit
 * statuses (REST API with the configured token, not the gh CLI), or GitLab
 * commit statuses. Read-only.
 */
export async function fetchChecks(repo: Repo, ref: string): Promise<PrCheck[]> {
	const provider = repo.provider ?? detectProvider(repo.url);
	const slug = parseSlug(repo.url);
	return provider === 'gitlab' ? gitlabChecks(slug, ref, repo.url) : githubChecks(slug, ref);
}

async function githubChecks(slug: string, ref: string): Promise<PrCheck[]> {
	const target = encodeURIComponent(ref);
	const [runs, combined] = await Promise.all([
		githubRest(`repos/${slug}/commits/${target}/check-runs?per_page=100`) as Promise<{ check_runs?: { id: number; name: string; status: string; conclusion: string | null; html_url: string | null; details_url: string | null }[] }>,
		githubRest(`repos/${slug}/commits/${target}/status`) as Promise<{ statuses?: { context: string; state: string; target_url: string | null }[] }>
	]);
	const checks: PrCheck[] = (runs.check_runs ?? []).map((run) => ({
		id: String(run.id),
		name: run.name,
		state: run.status !== 'completed' ? (run.status === 'in_progress' ? 'running' : 'pending')
			: run.conclusion === 'success' ? 'passed'
			: run.conclusion === 'skipped' || run.conclusion === 'neutral' ? 'skipped'
			: 'failed',
		url: run.html_url ?? run.details_url
	}));
	// Statuses come newest first; keep one per context.
	const seen = new Set<string>();
	for (const status of combined.statuses ?? []) {
		if (seen.has(status.context)) continue;
		seen.add(status.context);
		checks.push({
			name: status.context,
			state: status.state === 'success' ? 'passed' : status.state === 'pending' ? 'running' : 'failed',
			url: status.target_url
		});
	}
	return checks;
}

async function gitlabChecks(slug: string, ref: string, repoUrl: string): Promise<PrCheck[]> {
	const env = tokenEnv('gitlab', repoUrl);
	const project = encodeURIComponent(slug);
	const commit = await glabApi(`projects/${project}/repository/commits/${encodeURIComponent(ref)}`, env) as { id: string };
	const statuses = await glabApi(`projects/${project}/repository/commits/${commit.id}/statuses?per_page=100`, env) as { id: number; name: string; status: string; target_url: string | null }[];
	const seen = new Set<string>();
	const checks: PrCheck[] = [];
	for (const status of statuses) {
		if (seen.has(status.name)) continue;
		seen.add(status.name);
		checks.push({
			id: String(status.id),
			name: status.name,
			state: status.status === 'success' ? 'passed'
				: status.status === 'running' ? 'running'
				: status.status === 'skipped' || status.status === 'canceled' || status.status === 'manual' ? 'skipped'
				: status.status === 'failed' ? 'failed'
				: 'pending',
			url: status.target_url
		});
	}
	return checks;
}

/**
 * A failed check's log. GitHub Actions jobs have a full log; other check apps
 * only have their summary and annotations. GitLab jobs have a trace.
 */
export async function fetchCheckLog(repo: Repo, id: string): Promise<string> {
	if (!/^\d+$/.test(id)) throw new GhError('not-found', 'Unknown check.');
	const provider = repo.provider ?? detectProvider(repo.url);
	const slug = parseSlug(repo.url);
	if (provider === 'gitlab') {
		return glabApiText(`projects/${encodeURIComponent(slug)}/jobs/${id}/trace`, tokenEnv('gitlab', repo.url));
	}
	try {
		return await githubRest(`repos/${slug}/actions/jobs/${id}/logs`, { text: true }) as string;
	} catch (err) {
		if (!(err instanceof GhError) || err.kind !== 'not-found') throw err;
	}
	const run = await githubRest(`repos/${slug}/check-runs/${id}`) as { output?: { title?: string | null; summary?: string | null; text?: string | null } };
	const notes = await githubRest(`repos/${slug}/check-runs/${id}/annotations?per_page=50`).catch(() => []) as { path: string; start_line: number; message: string; annotation_level: string }[];
	return [
		run.output?.title, run.output?.summary, run.output?.text,
		...notes.map((note) => `${note.path}:${note.start_line}: ${note.annotation_level}: ${note.message}`)
	].filter(Boolean).join('\n');
}

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z ?/;
const FAILURE_LINE = /error|fail|✗|✘|panic|exception|assert/i;

/**
 * The part of a CI log that says why it failed, for the model: colors and
 * timestamps stripped, the lines that mention a failure (with a little
 * context) plus the tail, capped.
 */
export function failureExcerpt(log: string, maxChars = 16_000): string {
	const lines = log.replace(/\r\n?/g, '\n').split('\n').map((line) => line.replace(ANSI, '').replace(TIMESTAMP, '').trimEnd());
	const keep = new Set<number>();
	for (let i = 0; i < lines.length; i++) {
		if (!FAILURE_LINE.test(lines[i])) continue;
		for (let j = Math.max(0, i - 3); j <= Math.min(lines.length - 1, i + 6); j++) keep.add(j);
	}
	for (let i = Math.max(0, lines.length - 80); i < lines.length; i++) keep.add(i);
	const out: string[] = [];
	let last = -1;
	for (const i of [...keep].sort((a, b) => a - b)) {
		if (last >= 0 && i > last + 1) out.push('…');
		out.push(lines[i]);
		last = i;
	}
	const text = out.join('\n').trim();
	// Over the cap, the end of the log (where runners report the failure) wins.
	return text.length > maxChars ? '…' + text.slice(text.length - maxChars) : text;
}
