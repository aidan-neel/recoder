import { REASONING_EFFORTS } from '@recoder/shared';
import type { HostConfig, RunRequest } from '$lib/reports/types';
import { host, quote, shell } from './hosts';
import { readLabels } from './datasets';
import { flag, probe } from './probe';
import { getSettings } from './recoder-api';

const ID = /^[\w.-]+$/;
const MODEL = /^[\w:./@-]+$/;

/** Rejects a request whose values could not have come from the form. */
function validate(request: RunRequest): void {
	const efforts: readonly string[] = REASONING_EFFORTS;

	if (!ID.test(request.dataset) || !ID.test(request.tag))
		throw new Error('Dataset and tag take letters, digits, dots and dashes.');
	if (request.only.some((id) => !ID.test(id))) throw new Error('A PR id has characters a label id never has.');
	if (request.model && !MODEL.test(request.model))
		throw new Error('That model id has characters a model id never has.');
	if (request.judge !== 'review' && request.judge !== 'second' && !MODEL.test(request.judge))
		throw new Error('That judge id has characters a model id never has.');
	if (request.effort && !efforts.includes(request.effort)) throw new Error('Unknown effort.');
	if (request.judgeEffort && !efforts.includes(request.judgeEffort)) throw new Error('Unknown judge effort.');

	for (const [name, value, max] of [
		['Runs', request.runs, 50],
		['Concurrency', request.concurrency, 20],
		['Timeout', request.timeout, 600]
	] as const) {
		if (!Number.isInteger(value) || value < 1 || value > max)
			throw new Error(`${name} is a whole number from 1 to ${max}.`);
	}

	if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(request.base))
		throw new Error('The server is http://localhost:<port>.');
}

function samePort(a: string, b: string): boolean {
	return new URL(a).port === new URL(b).port;
}

/**
 * Model picks are one setting per server. A run that is still starting
 * reviews would pick up a new model for the reviews it has not started, so a
 * model change is refused while another run uses the same server.
 */
async function guardPicks(target: HostConfig, request: RunRequest): Promise<void> {
	if (!request.model) return;

	const { benchmarks } = await probe(target);

	const busy = benchmarks.find((process) =>
		samePort(flag(process.args, 'base') ?? 'http://localhost:3001', request.base)
	);

	if (busy)
		throw new Error(
			`Run ${busy.pid} is using this server. A new model would also apply to the reviews it has not started. Keep the current model, or pick another server.`
		);
}

function picksBody(model: string, effort: string | null): string {
	return JSON.stringify({
		orchestratorModelId: model,
		specialistModelId: model,
		orchestratorEffort: effort,
		specialistEffort: effort
	});
}

function patch(base: string, body: string): string {
	return `curl -s -X PATCH ${quote(`${base}/api/settings/models`)} -H 'content-type: application/json' -d ${quote(body)} >/dev/null`;
}

/**
 * The script that starts the run detached, like trial.sh: set the picks, start
 * the benchmark, and put the old picks back once its reviews have locked their
 * models (a minute when every review starts at once, else when it ends).
 */
function script(target: HostConfig, request: RunRequest, restore: string | null, total: number): string {
	const log = `${target.dataDir}/evals/bench-${request.tag}.log`;

	const args = [
		'--dataset',
		`${target.datasetsDir}/${request.dataset}`,
		...(request.only.length ? ['--only', request.only.join(',')] : []),
		'--runs',
		String(request.runs),
		'--concurrency',
		String(request.concurrency),
		'--timeout',
		String(request.timeout),
		'--base',
		request.base,
		'--judge',
		request.judge,
		...(request.judgeEffort ? ['--judge-effort', request.judgeEffort] : [])
	];

	const wait = total <= request.concurrency ? 'sleep 60' : 'while kill -0 "$PID" 2>/dev/null; do sleep 30; done';

	return [
		'set -e',
		`cd ${quote(`${target.repo}/apps/server`)}`,
		target.path ? `export PATH=${quote(target.path)}:"$PATH"` : '',
		`LOG=${quote(log)}`,
		`mkdir -p ${quote(`${target.dataDir}/evals`)}`,
		`echo "=== bench ${request.tag} $(date)" >> "$LOG"`,
		request.model ? patch(request.base, picksBody(request.model, request.effort)) : '',
		'DETACH=nohup; command -v setsid >/dev/null 2>&1 && DETACH="setsid nohup"',
		`$DETACH bun src/eval/benchmark.ts ${args.map(quote).join(' ')} </dev/null >> "$LOG" 2>&1 &`,
		'PID=$!',
		restore
			? `$DETACH sh -c ${quote(`PID=$1; ${wait}; ${patch(request.base, restore)}`)} sh "$PID" </dev/null >/dev/null 2>&1 &`
			: '',
		'echo "$PID"'
	]
		.filter(Boolean)
		.join('\n');
}

/** Starts a benchmark run on its host and returns the run's process id. */
export async function launch(request: RunRequest): Promise<{ host: string; pid: number }> {
	validate(request);

	const target = host(request.host);

	await guardPicks(target, request);

	let restore: string | null = null;

	if (request.model) {
		const settings = await getSettings(target, request.base);

		restore = JSON.stringify({
			orchestratorModelId: settings.orchestratorModelId ?? null,
			specialistModelId: settings.specialistModelId ?? null,
			orchestratorEffort: settings.orchestratorEffort ?? null,
			specialistEffort: settings.specialistEffort ?? null
		});
	}

	const prs = request.only.length || readLabels(target, request.dataset).length;
	const out = await shell(target, script(target, request, restore, prs * request.runs));
	const pid = Number(out.trim().split('\n').at(-1));

	if (!pid) throw new Error(`The run did not start: ${out.trim() || 'no process id'}`);

	return { host: target.id, pid };
}
