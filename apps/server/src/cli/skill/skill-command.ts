import { homedir } from 'node:os';
import { parseChoiceOr, parseText } from '../args/values.js';
import { rejectMoreThanOne } from '../args/lists.js';
import { parseFlags } from '../args/parse.js';
import { EXIT, usageError, type ExitCode } from '../exit.js';
import { writeStderrLine, writeStdout } from '../output/streams.js';
import { BUNDLED_SKILL } from './bundled-skill.js';
import { installSkill } from './install-skill.js';
import { skillHelp } from './skill-help.js';
import { SKILL_AGENTS, SKILL_SCOPES, resolveSkillsFolder } from './skills-folder.js';

const SUBCOMMANDS = ['show', 'install'] as const;

const INSTALL_PARSE_CONFIG = {
	options: {
		agent: { type: 'string' },
		scope: { type: 'string' },
		dir: { type: 'string' },
		force: { type: 'boolean' }
	},
	strict: true,
	allowPositionals: false
} as const;

const NO_FLAGS_PARSE_CONFIG = { options: {}, strict: true, allowPositionals: false } as const;

/**
 * Runs `recoder skill`: `argv` is everything after it. Prints the bundled skill or installs it.
 * Throws a `CliError` for a wrong subcommand, flag or destination.
 */
export async function runSkillCommand(argv: string[], workingDirectory: string): Promise<ExitCode> {
	const [subcommand, ...flags] = argv;

	if (subcommand === undefined || argv.includes('--help')) return printLine(skillHelp());

	switch (subcommand) {
		case 'show':
			parseFlags(flags, NO_FLAGS_PARSE_CONFIG);

			return printLine(BUNDLED_SKILL[0].text);
		case 'install':
			return runInstall(flags, workingDirectory);
		default:
			throw usageError(`unknown skill command "${subcommand}"; use ${SUBCOMMANDS.join(', ')}.`);
	}
}

async function runInstall(flags: string[], workingDirectory: string): Promise<ExitCode> {
	const values = parseFlags(flags, INSTALL_PARSE_CONFIG);

	rejectMoreThanOne(values, ['dir', 'agent']);
	rejectMoreThanOne(values, ['dir', 'scope']);

	const skillsFolder = resolveSkillsFolder(
		{
			agent: parseChoiceOr('--agent', values.agent, SKILL_AGENTS, 'claude'),
			scope: parseChoiceOr('--scope', values.scope, SKILL_SCOPES, 'user'),
			dir: parseText('--dir', values.dir)
		},
		{ workingDirectory, homeDirectory: homedir() }
	);

	const { destination, files, warning } = await installSkill({
		source: BUNDLED_SKILL,
		skillsFolder,
		force: values.force === true
	});

	if (warning !== null) writeStderrLine(`recoder: ${warning}`);

	return printLine(JSON.stringify({ installed: destination, files }));
}

async function printLine(text: string): Promise<ExitCode> {
	await writeStdout(text.endsWith('\n') ? text : `${text}\n`);

	return EXIT.ok;
}
