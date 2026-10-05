import { parseArgs } from 'node:util';

export interface RunOptions {
	runs: number;
	/** Reviews running at once. */
	concurrency: number;
	base: string;
	timeoutMs: number;
	/** False for `--no-baseline-cache`: every baseline check runs again, for a suspected flaky suite. */
	baselineCache: boolean;
}

type StringFlags = Record<string, { type: 'string' }>;

/** Prints the message and the usage line, then exits. */
function failWith(usage: string): (message: string) => never {
	return (message) => {
		console.error(`${message}\n${usage}`);
		process.exit(1);
	};
}

/**
 * Parses an eval's own string flags plus the ones every eval takes: runs,
 * reviews at once, the server, and each review's time limit in minutes.
 */
export function parseEvalArgs<Flags extends StringFlags>(
	usage: string,
	flags: Flags,
	defaults: { runs: string; concurrency: string; timeout: string }
) {
	const fail = failWith(usage);

	const positiveInt = (value: string | undefined, name: string): number => {
		const parsed = Number(value);

		if (!Number.isInteger(parsed) || parsed <= 0) fail(`--${name} must be a positive integer.`);

		return parsed;
	};

	const parsed: Record<string, string | boolean | undefined> = parseArgs({
		args: Bun.argv.slice(2),
		options: {
			...flags,
			runs: { type: 'string', default: defaults.runs },
			concurrency: { type: 'string', default: defaults.concurrency },
			base: { type: 'string', default: 'http://localhost:3001' },
			timeout: { type: 'string', default: defaults.timeout },
			'no-baseline-cache': { type: 'boolean' }
		},
		strict: true
	}).values;

	const { 'no-baseline-cache': noBaselineCache, ...rest } = parsed;
	const values = rest as Record<string, string | undefined>;

	const run: RunOptions = {
		runs: positiveInt(values.runs, 'runs'),
		concurrency: positiveInt(values.concurrency, 'concurrency'),
		base: values.base ?? '',
		timeoutMs: positiveInt(values.timeout, 'timeout') * 60_000,
		baselineCache: !noBaselineCache
	};

	return { values: values as { [Key in keyof Flags]?: string }, run, fail, positiveInt };
}
