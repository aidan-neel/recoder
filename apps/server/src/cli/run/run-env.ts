import { REVIEW_LEVERS, type ReviewTuning } from '../review/options.js';

const LEVER_ON = '1';

const EXEC_VARIABLE = 'RECODER_EXEC';

const EXEC_OFF = 'off';

/**
 * Sets the environment switches this review asks for and returns a function that puts each back as it was. Only
 * this process sees them: a child that Bun starts without an explicit `env` gets the environment the process started
 * with. That is enough, because every switch is read from `process.env` in this process when the pipeline runs (the
 * obligations, second-look and test-strength configs, caller selection in the change model, and the exec tool in
 * `exec-sandbox.ts`), and the OpenCode tool host that runs those tools is a server inside this process. The git
 * repository variables are dealt with once, at start-up, in `repository-env.ts`.
 */
export function applyRunEnv(tuning: Pick<ReviewTuning, 'levers' | 'exec'>): () => void {
	const changes = switchesFor(tuning);
	const previous = Object.keys(changes).map((name) => ({ name, value: process.env[name] }));

	Object.assign(process.env, changes);

	return () => {
		for (const { name, value } of previous) restoreVariable(name, value);
	};
}

function switchesFor(tuning: Pick<ReviewTuning, 'levers' | 'exec'>): Record<string, string> {
	const levers = tuning.levers.map((lever) => [REVIEW_LEVERS[lever], LEVER_ON] as const);
	const exec = tuning.exec ? [] : [[EXEC_VARIABLE, EXEC_OFF] as const];

	return Object.fromEntries([...levers, ...exec]);
}

function restoreVariable(name: string, value: string | undefined): void {
	if (value === undefined) delete process.env[name];
	else process.env[name] = value;
}
