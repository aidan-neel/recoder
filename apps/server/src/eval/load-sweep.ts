import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { CapacityError } from '../models/llm/errors';
import { acquireLlmSlot, releaseLlmSlot, resetLlmLimiter, withLlmLane } from '../models/llm/limiter';

const USAGE =
	'Usage: bun run --filter @recoder/server eval:load -- [--reviews 12] [--requests 8] [--levels 1,2,4,8,16,32] ' +
	'[--model-parallel 8] [--latency 40] [--queue-timeout 120]';

/** The fake endpoint's limiter key, apart from every real endpoint's. */
const ENDPOINT = 'load-sweep';

/** A level supports more load only when its throughput beats the level before by at least this share. */
const MIN_THROUGHPUT_GAIN = 0.05;

interface SweepOptions {
	reviews: number;
	/** Model requests each review sends at once. */
	requests: number;
	/** Limiter concurrency levels to try, in the order given. */
	levels: number[];
	/** Requests the fake model server runs at once; the rest wait inside it. */
	modelParallel: number;
	latencyMs: number;
	queueTimeoutMs: number;
}

/** What one concurrency level measured. Times are in milliseconds. */
export interface LevelResult {
	concurrency: number;
	requestsPerSecond: number;
	queueMeanMs: number;
	queueP95Ms: number;
	queueMaxMs: number;
	/** Mean time requests waited inside the model server after the limiter let them through. */
	modelWaitMs: number;
	reviewMeanMs: number;
	reviewMaxMs: number;
	capacityFailures: number;
}

/**
 * Where adding concurrency stops helping, and what holds throughput there: the model server when requests at the
 * next level only waited longer inside it, the limiter's cap when every level tried still helped, and the sweep's
 * own load when the next level gained nothing without the model server filling up.
 */
interface SupportedRange {
	from: number;
	to: number;
	limitedBy: 'model' | 'limiter' | 'load';
}

/**
 * The levels that still raise throughput, from the first: the range ends at
 * the last level whose throughput beat the one before it by
 * {@link MIN_THROUGHPUT_GAIN} without adding capacity failures.
 */
export function supportedRange(results: LevelResult[]): SupportedRange | null {
	const first = results[0];

	if (!first) return null;

	let last = first;

	for (const next of results.slice(1)) {
		const gained = next.requestsPerSecond >= last.requestsPerSecond * (1 + MIN_THROUGHPUT_GAIN);

		if (!gained || next.capacityFailures > last.capacityFailures) {
			return { from: first.concurrency, to: last.concurrency, limitedBy: limitPast(last, next) };
		}

		last = next;
	}

	return { from: first.concurrency, to: last.concurrency, limitedBy: 'limiter' };
}

function limitPast(last: LevelResult, next: LevelResult): SupportedRange['limitedBy'] {
	return next.modelWaitMs > last.modelWaitMs ? 'model' : 'load';
}

/** A fake inference server that runs `parallel` requests at once for `latencyMs` each; it returns how long a request waited inside. */
function fakeModelServer(parallel: number, latencyMs: number): () => Promise<number> {
	let running = 0;
	const waiting: (() => void)[] = [];

	return async () => {
		const arrived = performance.now();

		if (running < parallel) running++;
		else await new Promise<void>((resolve) => waiting.push(resolve));

		const waited = performance.now() - arrived;

		await delay(latencyMs);

		const next = waiting.shift();

		if (next) next();
		else running--;

		return waited;
	};
}

/** The value `fraction` of the way through `values`, by nearest rank; 0 for none. */
function nearestRank(values: number[], fraction: number): number {
	const sorted = [...values].sort((a, b) => a - b);

	return sorted[Math.ceil(sorted.length * fraction) - 1] ?? 0;
}

function mean(values: number[]): number {
	return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

/** Samples one level's run collects: each request's limiter and model-server waits, and each review's duration. */
interface LevelSamples {
	queueMs: number[];
	modelWaitMs: number[];
	reviewMs: number[];
	capacityFailures: number;
}

/** One review: its requests all go at once in its own limiter lane, and it ends when the last one does. */
async function runFakeReview(
	id: string,
	options: SweepOptions,
	callModel: () => Promise<number>,
	samples: LevelSamples
): Promise<void> {
	const started = performance.now();
	const lane = { id, recordWait: (waitedMs: number) => samples.queueMs.push(waitedMs) };

	const request = async () => {
		try {
			await acquireLlmSlot(ENDPOINT, undefined, options.queueTimeoutMs);
		} catch (error) {
			if (!(error instanceof CapacityError)) throw error;
			samples.capacityFailures++;

			return;
		}

		try {
			samples.modelWaitMs.push(await callModel());
		} finally {
			releaseLlmSlot(ENDPOINT);
		}
	};

	await withLlmLane(lane, () => Promise.all(Array.from({ length: options.requests }, request)));
	samples.reviewMs.push(performance.now() - started);
}

async function runLevel(concurrency: number, options: SweepOptions): Promise<LevelResult> {
	process.env.RECODER_LLM_CONCURRENCY = String(concurrency);
	resetLlmLimiter();

	const callModel = fakeModelServer(options.modelParallel, options.latencyMs);
	const samples: LevelSamples = { queueMs: [], modelWaitMs: [], reviewMs: [], capacityFailures: 0 };
	const started = performance.now();

	await Promise.all(
		Array.from({ length: options.reviews }, (_, index) =>
			runFakeReview(`review-${index + 1}`, options, callModel, samples)
		)
	);

	const elapsedSeconds = (performance.now() - started) / 1000;

	return {
		concurrency,
		requestsPerSecond: samples.modelWaitMs.length / elapsedSeconds,
		queueMeanMs: mean(samples.queueMs),
		queueP95Ms: nearestRank(samples.queueMs, 0.95),
		queueMaxMs: Math.max(0, ...samples.queueMs),
		modelWaitMs: mean(samples.modelWaitMs),
		reviewMeanMs: mean(samples.reviewMs),
		reviewMaxMs: Math.max(0, ...samples.reviewMs),
		capacityFailures: samples.capacityFailures
	};
}

/**
 * The load sweep: fake reviews against a fake model server, through the real
 * model-request limiter, once per concurrency level, restoring the process's
 * own concurrency setting afterwards. Nothing here reaches a model, a forge or
 * storage.
 */
async function runSweep(options: SweepOptions): Promise<LevelResult[]> {
	const saved = process.env.RECODER_LLM_CONCURRENCY;
	const results: LevelResult[] = [];

	try {
		for (const level of options.levels) results.push(await runLevel(level, options));
	} finally {
		resetLlmLimiter();
		if (saved === undefined) delete process.env.RECODER_LLM_CONCURRENCY;
		else process.env.RECODER_LLM_CONCURRENCY = saved;
	}

	return results;
}

function formatRow(result: LevelResult): string {
	const ms = (value: number) => `${Math.round(value)}ms`.padStart(9);

	return [
		String(result.concurrency).padStart(11),
		result.requestsPerSecond.toFixed(1).padStart(12),
		ms(result.queueMeanMs),
		ms(result.queueP95Ms),
		ms(result.queueMaxMs),
		ms(result.modelWaitMs),
		ms(result.reviewMeanMs),
		ms(result.reviewMaxMs),
		String(result.capacityFailures).padStart(9)
	].join(' ');
}

function formatRange(range: SupportedRange | null, options: SweepOptions): string {
	if (!range) return 'No levels ran.';

	const span = `Supported range: concurrency ${range.from} to ${range.to}.`;

	if (range.limitedBy === 'limiter') return `${span} Every level still helped; try higher levels.`;

	if (range.limitedBy === 'model')
		return `${span} Past ${range.to}, requests only wait inside the model server (${options.modelParallel} at once).`;

	return `${span} Past ${range.to}, the sweep sends too few requests to use more; add reviews or requests.`;
}

function report(results: LevelResult[], options: SweepOptions): string {
	return [
		`${options.reviews} fake reviews × ${options.requests} requests, model server runs ${options.modelParallel} at once, ${options.latencyMs}ms each.`,
		'',
		'concurrency  requests/s  queue avg  queue p95  queue max model wait review avg review max  capacity',
		...results.map(formatRow),
		'',
		formatRange(supportedRange(results), options)
	].join('\n');
}

function parseOptions(): SweepOptions {
	const fail = (message: string): never => {
		console.error(`${message}\n${USAGE}`);
		process.exit(1);
	};

	const positive = (value: string, name: string): number => {
		const parsed = Number(value);

		return Number.isInteger(parsed) && parsed > 0 ? parsed : fail(`--${name} must be a positive integer.`);
	};

	const { values } = parseArgs({
		args: Bun.argv.slice(2),
		options: {
			reviews: { type: 'string', default: '12' },
			requests: { type: 'string', default: '8' },
			levels: { type: 'string', default: '1,2,4,8,16,32' },
			'model-parallel': { type: 'string', default: '8' },
			latency: { type: 'string', default: '40' },
			'queue-timeout': { type: 'string', default: '120' }
		},
		strict: true
	});

	return {
		reviews: positive(values.reviews, 'reviews'),
		requests: positive(values.requests, 'requests'),
		levels: values.levels.split(',').map((level) => positive(level.trim(), 'levels')),
		modelParallel: positive(values['model-parallel'], 'model-parallel'),
		latencyMs: positive(values.latency, 'latency'),
		queueTimeoutMs: positive(values['queue-timeout'], 'queue-timeout') * 1000
	};
}

if (import.meta.main) {
	const options = parseOptions();

	console.log(report(await runSweep(options), options));
}
