import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { isReviewConfigured } from '../../models/models.js';
import { runDoctor } from '../doctor/doctor.js';
import { EXIT, usageError, type ExitCode } from '../exit.js';
import type { ListedModel } from '../models/model-list.js';
import { writeStdout } from '../output/streams.js';
import { bootHeadless } from '../run/boot.js';
import { MODEL_LOOKUP_LIMIT_MS } from '../run/model-choices.js';
import { openRunSignal } from '../run/run-signal.js';
import { abortOnSignal } from '../signals/abort-on-signal.js';
import { resolveSkillsFolder, type SkillAgent } from '../skill/skills-folder.js';
import { tildePath } from '../terminal/home-path.js';
import { confirmPrompt } from '../terminal/prompt/confirm.js';
import { ask, canPrompt } from '../terminal/prompt/prompt.js';
import { selectPrompt } from '../terminal/prompt/select.js';
import { withSpinner } from '../terminal/spinner.js';
import type { Terminal } from '../terminal/terminal.js';
import { detectAgents, type AgentProbe } from './detect-agents.js';
import { createGuidelinesStep } from './guidelines-step.js';
import type { InitRequest, InitScope } from './init-request.js';
import type { InitStep } from './init-step.js';
import { initClosing, initHeading, stepLines, type InitResult } from './init-view.js';
import { machineStep } from './machine-step.js';
import { registerMcpStep } from './mcp-step.js';
import { reviewModelStep } from './model-step.js';
import { installSkillStep, type SkillInstallPlan } from './skill-step.js';

/** What one `recoder init` works with once its scope is known. */
interface InitRun {
	request: InitRequest;
	scope: InitScope;
	projectFolder: string;
	terminal: Terminal;
	/** Whether a question may be asked: on a terminal, for a person, without `--yes`. */
	canAsk: boolean;
}

/**
 * `recoder init`: sets Recoder up for coding agents in this project or on this machine. Each step is printed as it
 * ends, so a slow one does not hold back the others' news. Exits 0 when everything is in place and reviews can run,
 * 3 when a step failed, and 4 when the setup is in place but this machine cannot review yet.
 */
export async function runInitCommand(request: InitRequest, terminal: Terminal): Promise<ExitCode> {
	const canAsk = canPrompt(terminal) && !request.assumeDefaults;
	const scope = request.scope ?? (await chooseScope(canAsk, terminal));

	if (scope === 'global' && request.mcp)
		throw usageError('--mcp writes .mcp.json into a project; use it with --project.');

	const run: InitRun = { request, scope, projectFolder: process.cwd(), terminal, canAsk };
	const isShown = terminal.audience === 'person';

	bootHeadless();

	if (isShown) await writeLines(initHeading(scope, terminal.out));

	const steps: InitStep[] = [];

	for (const step of stepsOf(run)) {
		const ended = await step();

		steps.push(ended);

		if (isShown) await writeLines(stepLines(ended, run, terminal.out));
	}

	const result: InitResult = { scope, ready: steps.every(isInPlace), steps };

	await writeLines(isShown ? initClosing(result, terminal.out) : [JSON.stringify(result)]);

	return exitCodeOf(steps);
}

/** The steps in the order they run; each starts only when the one before it has ended, so their prompts never overlap. */
function stepsOf(run: InitRun): (() => Promise<InitStep>)[] {
	const { request, scope, projectFolder } = run;
	const agents = request.agents ?? detectAgents(machineProbe());
	const skills = agents.map((agent) => () => installSkillStep(skillPlan(agent, run)));

	const project =
		scope === 'project'
			? [
					...(request.guidelines ? [() => createGuidelinesStep(projectFolder)] : []),
					...(request.mcp ? [() => registerMcpStep(projectFolder, request.force)] : [])
				]
			: [];

	return [...skills, ...project, () => chooseReviewModel(run), () => checkMachine(run)];
}

function machineProbe(): AgentProbe {
	return {
		homeDirectory: homedir(),
		hasCommand: (name: string) => Bun.which(name) !== null,
		hasFolder: existsSync
	};
}

function skillPlan(agent: SkillAgent, run: InitRun): SkillInstallPlan {
	const { request, scope, projectFolder, terminal, canAsk } = run;

	const skillsFolder = resolveSkillsFolder(
		{ agent, scope: scope === 'project' ? 'project' : 'user', dir: null },
		{ workingDirectory: projectFolder, homeDirectory: homedir() }
	);

	const shouldReplace = async (destination: string): Promise<boolean> => {
		if (request.force || request.assumeDefaults) return true;

		if (!canAsk) return false;

		const question = `Replace the skill in ${tildePath(destination)}? It differs from this version.`;

		return ask(confirmPrompt(question, true), terminal.err);
	};

	return { agent, skillsFolder, shouldReplace };
}

async function chooseReviewModel(run: InitRun): Promise<InitStep> {
	const { request, terminal, canAsk } = run;
	const signal = abortOnSignal();

	return reviewModelStep({
		requested: request.reviewer,
		pick: canAsk ? (models) => askForModel(models, terminal) : null,
		listing: (work) => withSpinner('Listing the models', terminal, work),
		lookup: { stop: openRunSignal(signal, null), limitMs: MODEL_LOOKUP_LIMIT_MS }
	});
}

function askForModel(models: readonly ListedModel[], terminal: Terminal): Promise<ListedModel> {
	const options = models.map((model) => ({
		value: model,
		label: model.id,
		hint: `${model.name} ${terminal.err.glyphs.separator} ${model.provider}`
	}));

	const question = selectPrompt({ message: 'Which model should reviews run on?', options, isFilterable: true });

	return ask(question, terminal.err).then((option) => option.value);
}

async function checkMachine({ terminal }: InitRun): Promise<InitStep> {
	const report = await withSpinner('Checking this machine', terminal, runDoctor);

	return machineStep(report, isReviewConfigured());
}

/** The scope a person picks when no flag gave one; nobody to ask is a usage error that names the flags. */
async function chooseScope(canAsk: boolean, terminal: Terminal): Promise<InitScope> {
	if (!canAsk)
		throw usageError('choose where to set Recoder up: --project for this folder, or --global for this machine.');

	const question = selectPrompt<InitScope>({
		message: 'Where should Recoder be set up?',
		options: [
			{ value: 'project', label: 'This project', hint: 'the skill and RECODER.md in this folder, to commit' },
			{ value: 'global', label: 'This machine', hint: 'the skill in your home folder, for every project' }
		],
		isFilterable: false
	});

	return (await ask(question, terminal.err)).value;
}

/** A step leaves Recoder set up when it did its work or found it done. */
function isInPlace(step: InitStep): boolean {
	return step.state === 'done' || step.state === 'unchanged';
}

/** A step that failed outside the machine check is a failure of the command; a machine that cannot review is not ready. */
function exitCodeOf(steps: readonly InitStep[]): ExitCode {
	if (steps.some((step) => step.state === 'failed' && step.id !== 'machine')) return EXIT.failed;

	return steps.every(isInPlace) ? EXIT.ok : EXIT.notReady;
}

async function writeLines(lines: readonly string[]): Promise<void> {
	await writeStdout(`${lines.join('\n')}\n`);
}
