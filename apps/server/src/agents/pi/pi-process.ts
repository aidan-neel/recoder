import { dirname } from 'node:path';
import type { ReasoningEffort } from '@recoder/shared';
import { cliEnv } from '../cli-process';

type Env = Record<string, string | undefined>;

/**
 * Variables the CLI must not inherit from the server: the server's own settings and keys, every API key and token
 * (Pi bills a provider whose key it finds in the environment, so only the providers the user signed in to in Pi
 * itself are used), and `PI_*` overrides of Pi's session dir, package dir and telemetry. `PI_CODING_AGENT_DIR`
 * stays: it is where Pi keeps its sign-in, which Recoder never reads.
 */
const STRIPPED = [
	/^RECODER_/,
	/^PI_(?!CODING_AGENT_DIR$)/,
	/^ANTHROPIC_/,
	/^OPENAI_/,
	/^AZURE_OPENAI_/,
	/^AWS_/,
	/^GOOGLE_APPLICATION_CREDENTIALS$/,
	/^GH_TOKEN$/,
	/_TOKEN$/,
	/_API_KEY$/,
	/SECRET/,
	/PASSWORD/
];

/**
 * The environment Pi runs with: the server's, less its keys, and offline, so no startup step reaches the network
 * (Pi would otherwise install a package that the user's settings name but that is missing, running its scripts).
 */
export function piEnv(env: Env): Record<string, string> {
	return { ...cliEnv(env, STRIPPED), PI_OFFLINE: '1' };
}

/**
 * What every call turns off: startup network steps, the user's and the directory's extensions, skills, prompt
 * templates and themes, and `AGENTS.md`/`CLAUDE.md` context files. An empty `--append-system-prompt` stops Pi from
 * appending the user's `APPEND_SYSTEM.md` to the system prompt Recoder passes.
 */
export const PI_ISOLATION_ARGS = [
	'--offline',
	'--no-extensions',
	'--no-skills',
	'--no-prompt-templates',
	'--no-themes',
	'--no-context-files',
	'--append-system-prompt',
	''
];

/** The levels `pi --thinking` takes, less `off`, as Recoder names them; Pi lowers a level the model lacks. */
export const PI_EFFORTS: ReasoningEffort[] = ['minimal', 'low', 'medium', 'high', 'xhigh'];

/** Pi's own default level. */
export const PI_DEFAULT_EFFORT: ReasoningEffort = 'medium';

/** What a call needs to start Pi in print mode: the model, its thinking, the system prompt file and the session. */
export interface PiPrintOptions {
	/** `<provider>/<model>`, as `pi --list-models` lists it. */
	model: string;
	/** The level to think at; `off` turns thinking off; none leaves Pi's default. */
	thinking: ReasoningEffort | 'off' | undefined;
	systemFile: string;
	sessionFile: string;
	/** The flags that give the call its tools, or turn every tool off. */
	toolArgs: readonly string[];
}

/**
 * Print mode in text: the prompt comes on stdin, and Pi prints only the answer. The model's steps are read from the
 * session file, which lives in the call's scratch dir (`--session-dir` too, so nothing lands in the user's).
 * `--system-prompt` takes a file and reads it, replacing Pi's own prompt and the user's `SYSTEM.md`.
 */
export function printArgs({ model, thinking, systemFile, sessionFile, toolArgs }: PiPrintOptions): string[] {
	const slash = model.indexOf('/');
	const provider = slash > 0 ? ['--provider', model.slice(0, slash)] : [];

	return [
		'-p',
		'--mode',
		'text',
		...PI_ISOLATION_ARGS,
		...toolArgs,
		...provider,
		'--model',
		slash > 0 ? model.slice(slash + 1) : model,
		...(thinking ? ['--thinking', thinking] : []),
		'--system-prompt',
		systemFile,
		'--session',
		sessionFile,
		'--session-dir',
		dirname(sessionFile)
	];
}
