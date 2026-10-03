import { runCommand } from '../commands/runner.js';

export type GhErrorKind = 'unavailable' | 'auth' | 'not-found' | 'unknown';

/** A forge CLI or API failure, sorted by what the user can do about it. */
export class GhError extends Error {
	kind: GhErrorKind;

	constructor(kind: GhErrorKind, message: string) {
		super(message);
		this.kind = kind;
	}
}

/** The CLIs Recoder drives for GitHub and GitLab. */
type ForgeCli = 'gh' | 'glab';

/** The first JSON object or array in CLI output, which may carry log lines around it. */
export function extractJson(logs: string): unknown {
	const objStart = logs.indexOf('{');
	const arrStart = logs.indexOf('[');
	let start = -1;
	let end = -1;

	if (objStart !== -1 && (arrStart === -1 || objStart < arrStart)) {
		start = objStart;
		end = logs.lastIndexOf('}');
	} else if (arrStart !== -1) {
		start = arrStart;
		end = logs.lastIndexOf(']');
	}

	if (start === -1 || end <= start) {
		throw new GhError('unknown', `gh returned non-JSON: ${logs.slice(-500)}`);
	}

	try {
		return JSON.parse(logs.slice(start, end + 1));
	} catch {
		throw new GhError('unknown', `gh returned invalid JSON: ${logs.slice(-500)}`);
	}
}

/**
 * Run a forge CLI, capturing stdout. Never throws raw: a missing binary is an
 * `unavailable` GhError and a failed run is whatever `classify` makes of its logs.
 */
export async function runForgeCli(
	cli: ForgeCli,
	args: string[],
	env: Record<string, string> | undefined,
	classify: (logs: string) => GhError
): Promise<string> {
	let run;

	try {
		run = await runCommand({ label: `${cli} ${args.slice(0, 2).join(' ')}`, command: cli, args, env });
	} catch (err) {
		throw new GhError('unavailable', err instanceof Error ? err.message : String(err));
	}

	if (run.status !== 'succeeded') throw classify(run.logs);

	return run.logs;
}

/** Is the CLI binary usable at all? */
export async function forgeCliAvailable(cli: ForgeCli): Promise<boolean> {
	try {
		const run = await runCommand({ label: `${cli} version`, command: cli, args: ['--version'] });

		return run.status === 'succeeded';
	} catch {
		return false;
	}
}

/** The CLI's signed-in user, read from the `user` API's `field`. Never throws. */
export async function forgeCliUser(
	cli: ForgeCli,
	field: string,
	env?: Record<string, string>
): Promise<{ authenticated: boolean; user: string | null }> {
	try {
		const run = await runCommand({ label: `${cli} auth`, command: cli, args: ['api', 'user', '--jq', field], env });

		if (run.status !== 'succeeded') return { authenticated: false, user: null };

		const user = run.logs.trim();

		return { authenticated: true, user: user === '' ? null : user };
	} catch {
		return { authenticated: false, user: null };
	}
}
