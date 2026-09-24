import type { PrCheck, Repo } from '@recoder/shared';
import { githubRest } from './github-rest.js';
import { glabApi } from './glab.js';
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
	return provider === 'gitlab' ? gitlabChecks(slug, ref) : githubChecks(slug, ref);
}

async function githubChecks(slug: string, ref: string): Promise<PrCheck[]> {
	const target = encodeURIComponent(ref);
	const [runs, combined] = await Promise.all([
		githubRest(`repos/${slug}/commits/${target}/check-runs?per_page=100`) as Promise<{ check_runs?: { name: string; status: string; conclusion: string | null; html_url: string | null; details_url: string | null }[] }>,
		githubRest(`repos/${slug}/commits/${target}/status`) as Promise<{ statuses?: { context: string; state: string; target_url: string | null }[] }>
	]);
	const checks: PrCheck[] = (runs.check_runs ?? []).map((run) => ({
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

async function gitlabChecks(slug: string, ref: string): Promise<PrCheck[]> {
	const env = tokenEnv('gitlab');
	const project = encodeURIComponent(slug);
	const commit = await glabApi(`projects/${project}/repository/commits/${encodeURIComponent(ref)}`, env) as { id: string };
	const statuses = await glabApi(`projects/${project}/repository/commits/${commit.id}/statuses?per_page=100`, env) as { name: string; status: string; target_url: string | null }[];
	const seen = new Set<string>();
	const checks: PrCheck[] = [];
	for (const status of statuses) {
		if (seen.has(status.name)) continue;
		seen.add(status.name);
		checks.push({
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
