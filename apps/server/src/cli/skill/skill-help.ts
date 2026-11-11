import { SKILL_AGENTS, SKILL_SCOPES } from './skills-folder.js';

/** The text of `recoder skill --help`. */
export function skillHelp(): string {
	return `Usage: recoder skill <show|install> [flags]

The agent skill that teaches a coding agent to run reviews with recoder.

Commands:
  recoder skill show       Print SKILL.md.
  recoder skill install    Write the skill to <skills folder>/recoder and print one JSON line: {"installed":"<path>","files":<n>}.

Install flags:
  --agent <${SKILL_AGENTS.join('|')}>   Whose skills folder to use. Default: claude.
  --scope <${SKILL_SCOPES.join('|')}>    user: ~/.claude/skills or ~/.agents/skills. project: the same under the working directory. Default: user.
  --dir <path>              Use this skills folder instead; relative to the working directory. For any other agent.
  --force                   Replace an existing recoder folder. Nothing beside it is touched.

Install refuses an existing recoder folder without --force, and a recoder folder that is a symbolic link always.`;
}
