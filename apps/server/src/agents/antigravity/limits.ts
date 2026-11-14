import type { UsageWindow } from '@recoder/shared';
import { z } from 'zod';
import { cliOutput, emptyDirectory, findCli } from '../cli-process';
import { parseJson } from '../cli-stream';
import {
	CLI_LIMITS_TIMEOUT_MS,
	LimitsError,
	isoTime,
	parseUsage,
	usageWindow,
	type LimitsReading
} from '../limits-read';
import { isSignedOutOutput } from './antigravity-output';
import { ANTIGRAVITY_CLI, ANTIGRAVITY_PROBE_DIR, antigravityEnv } from './antigravity-process';

type Env = Record<string, string | undefined>;

const PROVIDER = 'Antigravity';

/** Windows `agy` names in a bucket's `window`, as Settings labels them. */
const WINDOW_LABELS: Record<string, string> = { '5h': '5-hour', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };

/**
 * Antigravity's quota windows, from the report `agy -p /usage --output-format json` prints (agy 1.1.11 and later):
 * a slash command that sends no prompt. The CLI keeps its sign-in and makes the call, so Recoder never reads its
 * credentials. Auto-update is off for the run, so a usage check never starts an update.
 */
export async function readAntigravityLimits(env: Env): Promise<LimitsReading> {
	const path = findCli(ANTIGRAVITY_CLI, env);

	if (!path) throw new LimitsError('Antigravity is not installed.');

	const { code, stdout, stderr } = await cliOutput([path, '-p', '/usage', '--output-format', 'json'], {
		cwd: await emptyDirectory(ANTIGRAVITY_PROBE_DIR),
		env: { ...antigravityEnv(env), AGY_CLI_DISABLE_AUTO_UPDATE: 'true' },
		timeoutMs: CLI_LIMITS_TIMEOUT_MS
	});

	if (code === 0) return antigravityLimits(parseJson(stdout));
	if (isSignedOutOutput(`${stderr}\n${stdout}`)) return { status: 'signed-out' };

	throw new LimitsError(`Antigravity’s usage could not be read (exit ${code}).`);
}

const bucketSchema = z.object({
	name: z.string().nullish(),
	window: z.string().nullish(),
	remaining_fraction: z.number().nullish(),
	reset_time: z.string().nullish(),
	disabled: z.boolean().nullish()
});

const reportSchema = z.object({
	status: z.string(),
	response: z.string().nullish(),
	error: z.string().nullish(),
	command: z
		.object({
			name: z.string(),
			data: z.object({ groups: z.array(z.object({ name: z.string(), buckets: z.array(bucketSchema) })) })
		})
		.nullish()
});

type Bucket = z.infer<typeof bucketSchema>;

/**
 * What the usage report says: each group's buckets (`Gemini Models`: a weekly and a five-hour limit) as windows
 * labelled by length and group (`Weekly Gemini`), used share being what the bucket has not left. A disabled bucket,
 * or one with no fraction, is left out. A report that did not succeed is a sign-in to ask for when it says so.
 */
export function antigravityLimits(raw: unknown): LimitsReading {
	const report = parseUsage(reportSchema, raw, PROVIDER);
	const groups = report.command?.name === 'usage' ? report.command.data.groups : null;

	if (report.status !== 'SUCCESS' || !groups) {
		if (isSignedOutOutput(`${report.error ?? ''}\n${report.response ?? ''}`)) return { status: 'signed-out' };

		throw new LimitsError(`Antigravity’s usage could not be read: it reported ${report.status}.`);
	}

	const windows = groups.flatMap((group) => {
		const scope = group.name.replace(/\s+models$/i, '');

		return group.buckets.flatMap((bucket) => bucketWindow(bucket, scope));
	});

	return { status: 'ready', plan: null, windows };
}

function bucketWindow(bucket: Bucket, scope: string): UsageWindow[] {
	if (bucket.disabled || typeof bucket.remaining_fraction !== 'number') return [];

	const length = WINDOW_LABELS[bucket.window ?? ''] ?? bucket.name ?? 'Quota';

	return [usageWindow(`${length} ${scope}`, (1 - bucket.remaining_fraction) * 100, isoTime(bucket.reset_time))];
}
