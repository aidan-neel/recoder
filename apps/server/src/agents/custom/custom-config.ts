import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { z } from 'zod';

type Env = Record<string, string | undefined>;

/** The variable that holds the command's configuration, as JSON. */
export const CUSTOM_AGENT_VAR = 'RECODER_CUSTOM_AGENT';

/** What a command may print for one turn by default: far above a review's replies, far below what hurts the server. */
const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

/** The largest output cap a configuration may set. */
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

const configSchema = z.object({
	/** The command and its arguments, run as given: an array, never a shell string, so nothing is interpolated. */
	argv: z.array(z.string().min(1).max(4096)).min(1).max(64),
	/** The name Settings and errors show; "Custom command" when unset. */
	name: z.string().min(1).max(60).optional(),
	maxOutputBytes: z.number().int().positive().max(MAX_OUTPUT_BYTES).optional()
});

/** A configured command, resolved: the binary found, and the limits it runs under. */
export interface CustomCommand {
	/** The binary's path, then the configured arguments. */
	argv: string[];
	name: string;
	maxOutputBytes: number;
}

/** No command is configured, the configuration is invalid, or the command it names. */
export type CustomCommandConfig =
	{ kind: 'unset' } | { kind: 'invalid'; error: string } | { kind: 'ready'; command: CustomCommand };

export const DEFAULT_NAME = 'Custom command';

/**
 * Reads the command from {@link CUSTOM_AGENT_VAR}: `{"argv": ["my-agent", "--json"], "name": "My agent"}`. The
 * first argument is a path, or a command found on PATH. The value is the user's own setting, but it is still
 * checked here, where it enters the server.
 */
export function readCustomCommand(env: Env): CustomCommandConfig {
	const raw = env[CUSTOM_AGENT_VAR];

	if (!raw) return { kind: 'unset' };

	let value: unknown;

	try {
		value = JSON.parse(raw);
	} catch {
		return { kind: 'invalid', error: `${CUSTOM_AGENT_VAR} is not JSON.` };
	}

	const parsed = configSchema.safeParse(value);

	if (!parsed.success) {
		const issue = parsed.error.issues[0];

		return {
			kind: 'invalid',
			error: `${CUSTOM_AGENT_VAR} is invalid (${issue.path.join('.') || 'value'}: ${issue.message}).`
		};
	}

	const [command, ...args] = parsed.data.argv;
	const binary = findBinary(command, env);

	if (!binary) return { kind: 'invalid', error: `The command ${command} in ${CUSTOM_AGENT_VAR} was not found.` };

	return {
		kind: 'ready',
		command: {
			argv: [binary, ...args],
			name: parsed.data.name ?? DEFAULT_NAME,
			maxOutputBytes: parsed.data.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES
		}
	};
}

/** The command's path: as given when it is absolute and exists, else as found on PATH; null when neither. */
function findBinary(command: string, env: Env): string | null {
	if (isAbsolute(command)) return existsSync(command) ? command : null;

	return Bun.which(command, { PATH: env.PATH ?? '' });
}
