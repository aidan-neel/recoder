import { existsSync, readdirSync } from 'node:fs';
import { basename } from 'node:path';
import type { ActiveRun, BenchmarkProcess, HostConfig, HostStatus, LiveReview } from '$lib/reports/types';
import { hosts, quote, shell } from './hosts';
import { readLabels } from './datasets';
import { evalsDir, syncHost } from './mirror';
import { flag, probe, type Probe } from './probe';
import { getRepos, getReviews, getSnapshot, getSummaries, type ReviewRow } from './recoder-api';
import { readReport } from './report-index';

/** The review list is large, so each server's copy is reused for this long. */
const REVIEWS_FRESH_MS = 20_000;

const reviewCache = new Map<string, { at: number; rows: Promise<ReviewRow[]> }>();

function cachedReviews(target: HostConfig, base: string): Promise<ReviewRow[]> {
	const key = `${target.id} ${base}`;
	const hit = reviewCache.get(key);

	if (hit && Date.now() - hit.at < REVIEWS_FRESH_MS) return hit.rows;

	const rows = getReviews(target, base);

	reviewCache.set(key, { at: Date.now(), rows });
	rows.catch(() => reviewCache.delete(key));

	return rows;
}

/** The report a run writes: the first one named after its dataset that started at or just after the process. */
function reportFor(target: HostConfig, dataset: string, startedAt: string): string | null {
	const dir = evalsDir(target);

	if (!existsSync(dir)) return null;

	const start = Date.parse(startedAt) - 10_000;
	const prefix = `benchmark-${dataset}-`;

	const candidates = readdirSync(dir)
		.filter((file) => file.startsWith(prefix) && file.endsWith('.json'))
		.map((file) => {
			const stamp = file.slice(prefix.length, -5).replace(/T(\d\d)-(\d\d)-(\d\d)-(\d+)Z$/, 'T$1:$2:$3.$4Z');

			return { file, at: Date.parse(stamp) };
		})
		.filter((item) => item.at >= start)
		.sort((a, b) => a.at - b.at);

	return candidates[0]?.file ?? null;
}

function runOf(target: HostConfig, process: BenchmarkProcess): ActiveRun {
	const { args } = process;
	const dataset = basename(flag(args, 'dataset') ?? 'unknown');
	const only = flag(args, 'only')?.split(',') ?? null;
	const runs = Number(flag(args, 'runs') ?? 1);
	const prCount = only?.length ?? readLabels(target, dataset).length;
	const report = reportFor(target, dataset, process.startedAt);
	let done = 0;
	let found = 0;
	let planted = 0;

	if (report) {
		try {
			const saved = readReport(target, report);

			done = saved.prs.reduce((sum, pr) => sum + pr.runs.length, 0);
			found = saved.summary.overall.found;
			planted = saved.summary.overall.planted;
		} catch {}
	}

	return {
		key: `${target.id}/${process.pid}`,
		host: target.id,
		hostLabel: target.label,
		pid: process.pid,
		startedAt: process.startedAt,
		cwd: process.cwd,
		dataset,
		only,
		runs,
		concurrency: Number(flag(args, 'concurrency') ?? 3),
		base: flag(args, 'base') ?? 'http://localhost:3001',
		judge: flag(args, 'judge') ?? 'review',
		log: process.log,
		report,
		done,
		expected: prCount ? prCount * runs : null,
		found,
		planted,
		reviews: []
	};
}

/**
 * Running reviews on the run's server that belong to it: started after the
 * run did, on one of its PRs. Two runs on one server share PRs only when the
 * user started them so; then a review goes to the later run.
 */
async function attachReviews(target: HostConfig, runs: ActiveRun[]): Promise<void> {
	for (const base of new Set(runs.map((run) => run.base))) {
		const onServer = runs.filter((run) => run.base === base).sort((a, b) => b.startedAt.localeCompare(a.startedAt));

		const [rows, summaries, repos] = await Promise.all([
			cachedReviews(target, base),
			getSummaries(target, base),
			getRepos(target, base)
		]);

		const repoUrl = new Map(repos.map((repo) => [repo.id, repo.url]));
		const taken = new Set<string>();

		for (const run of onServer) {
			const labels = readLabels(target, run.dataset).filter((label) => !run.only || run.only.includes(label.id));

			for (const row of rows) {
				const started = row.startedAt ?? row.createdAt;

				if (row.status !== 'running' || taken.has(row.id) || started < run.startedAt) continue;

				const label = labels.find((item) => item.pull === row.prNumber && item.repo === repoUrl.get(row.repoId));

				if (labels.length && !label) continue;

				const summary = summaries[row.id];

				taken.add(row.id);

				run.reviews.push({
					id: row.id,
					prNumber: row.prNumber,
					label: label?.id ?? null,
					startedAt: started,
					tasksDone: summary?.tasksDone ?? 0,
					tasksTotal: summary?.tasksTotal ?? 0,
					agents: summary?.agents ?? 0
				} satisfies LiveReview);
			}
		}
	}
}

async function hostRuns(target: HostConfig, found: Probe): Promise<{ runs: ActiveRun[]; reviews: number }> {
	const runs = found.benchmarks.map((process) => runOf(target, process));
	let reviews = 0;

	await attachReviews(target, runs).catch(() => undefined);

	for (const server of found.servers) {
		const summaries = await getSummaries(target, `http://localhost:${server.port}`).catch(() => null);

		if (!summaries) continue;

		const rows = await cachedReviews(target, `http://localhost:${server.port}`).catch(() => []);

		reviews += rows.filter((row) => row.status === 'running').length;
	}

	return { runs, reviews };
}

/** Every host's status and the runs in progress on it. A host that does not answer reports why. */
export async function activeRuns(): Promise<{ hosts: HostStatus[]; runs: ActiveRun[] }> {
	const results = await Promise.all(
		hosts().map(async (target) => {
			try {
				const [found] = await Promise.all([probe(target), syncHost(target)]);
				const { runs, reviews } = await hostRuns(target, found);

				const status: HostStatus = {
					id: target.id,
					label: target.label,
					remote: target.ssh !== null,
					error: null,
					servers: found.servers,
					runs: runs.length,
					reviews
				};

				return { status, runs };
			} catch (error) {
				const status: HostStatus = {
					id: target.id,
					label: target.label,
					remote: target.ssh !== null,
					error: error instanceof Error ? error.message : String(error),
					servers: [],
					runs: 0,
					reviews: 0
				};

				return { status, runs: [] };
			}
		})
	);

	return {
		hosts: results.map((result) => result.status),
		runs: results.flatMap((result) => result.runs).sort((a, b) => b.startedAt.localeCompare(a.startedAt))
	};
}

/** Adds each review's running tasks and locked model, for the run page. */
export async function withTasks(target: HostConfig, run: ActiveRun): Promise<ActiveRun> {
	const reviews = await Promise.all(
		run.reviews.map(async (review) => {
			const snapshot = await getSnapshot(target, run.base, review.id);

			return {
				...review,
				model: snapshot?.orchestratorModel ?? null,
				tasks: (snapshot?.tasks ?? [])
					.filter((task) => task.status === 'running')
					.map((task) => ({ label: task.label, message: task.message ?? '', startedAt: task.startedAt }))
			};
		})
	);

	return { ...run, reviews };
}

/** The last lines of a run's log on its host. */
export async function tailLog(target: HostConfig, path: string, lines = 60): Promise<string> {
	return shell(target, `tail -n ${lines} ${quote(path)} 2>/dev/null || true`);
}
