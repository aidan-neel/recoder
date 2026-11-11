import { homedir } from 'node:os';
import { parseChoiceOr, parseText } from '../args/values.js';
import { rejectMoreThanOne } from '../args/lists.js';
import { parseFlags } from '../args/parse.js';
import { EXIT, usageError, type ExitCode } from '../exit.js';
import { printResult } from '../output/print-result.js';
import { writeStderrLine, writeStdout } from '../output/streams.js';
import { tildePath } from '../terminal/home-path.js';
import type { Surface } from '../terminal/surface.js';
import type { Terminal } from '../terminal/terminal.js';
import { plural } from '../terminal/text.js';
import { BUNDLED_SKILL } from './bundled-skill.js';
import { installSkill } from './install-skill.js';
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

/** What `recoder skill install` did: where the skill is and how many files it has. */
interface InstallReceipt {
	installed: string;
	files: number;
}

/**
 * Runs `recoder skill`: `argv` is the subcommand and its flags. Prints the bundled skill or installs it.
 * Throws a `CliError` for a wrong subcommand, flag or destination.
 */
export async function runSkillCommand(argv: string[], workingDirectory: string, terminal: Terminal): Promise<ExitCode> {
	const [subcommand, ...flags] = argv;

	switch (subcommand) {
		case 'show':
			parseFlags(flags, NO_FLAGS_PARSE_CONFIG);
			await writeStdout(withTrailingNewline(BUNDLED_SKILL[0].text));

			return EXIT.ok;
		case 'install':
			return runInstall(flags, workingDirectory, terminal);
		default:
			throw usageError(`unknown skill command "${subcommand}"; use ${SUBCOMMANDS.join(', ')}.`);
	}
}

async function runInstall(flags: string[], workingDirectory: string, terminal: Terminal): Promise<ExitCode> {
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

	await printResult(terminal, { installed: destination, files }, installedView);

	return EXIT.ok;
}

function installedView(receipt: InstallReceipt, { paint, glyphs }: Surface): string[] {
	const where = `${tildePath(receipt.installed)} (${plural(receipt.files, 'file')})`;

	return [
		'',
		`  ${paint.ok(glyphs.ok)} ${paint.strong('Skill installed')} ${paint.muted(glyphs.separator)} ${where}`,
		`    ${paint.muted('Your agent picks it up in its next session.')}`,
		''
	];
}

function withTrailingNewline(text: string): string {
	return text.endsWith('\n') ? text : `${text}\n`;
}
