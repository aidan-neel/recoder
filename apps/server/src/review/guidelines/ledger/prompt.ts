import type { LedgerSource } from './sources.js';

export const LEDGER_SYSTEM_PROMPT = `You turn a repository's contributor instructions into a ledger of atomic code rules. Reviewers cite these rules by id when a pull request breaks one, so every rule must be something a reviewer can check by reading the changed code.

Keep only rules about the code itself: structure, file layout and size, naming, comments, formatting a linter does not enforce, forbidden constructs, required helpers or components, error handling, testing conventions, duplication and dead code.
Skip everything else: how to run commands, git and CI workflow, pull request process, instructions about how an AI agent should behave or report, design rationale, and anything vague ("write good code").

For each rule:
- "text": one imperative sentence that states exactly one requirement, in the repo's own terms. Split a bullet that holds several requirements into several rules.
- "source": the file path exactly as given in its === header.
- "line": the line number shown at the left of the line that states the rule.
- "appliesTo": a glob, only when the rule concerns some files. A rule in a nested file such as apps/web/AGENTS.md applies to "apps/web/**"; a rule under a heading or sentence that names a folder or file type applies to that folder or type. Omit it when the rule covers every file.
- "check": only when the rule is fully decided by one of these, otherwise omit it:
  {"kind":"max-file-lines","max":500,"glob":"**/*.ts"} - matching files stay at or under max lines.
  {"kind":"forbid-pattern","pattern":"^\\\\s*//(?!/)","glob":"**/*.ts"} - a JavaScript regex (at most 200 characters, no flags) tested against each added line on its own. Use it only when every match is a violation.
  {"kind":"path-pattern","files":"**/*.test.ts","mustMatch":"**/tests/**"} - added files matching "files" must also match "mustMatch".

Never invent a rule the text does not state. List rules in the order they appear.`;

export const LEDGER_FINAL_EXAMPLE = `{"message":"Read AGENTS.md.","rules":[{"text":"Keep every file under 500 lines.","source":"AGENTS.md","line":12,"check":{"kind":"max-file-lines","max":500}},{"text":"Build all UI with the shared component library.","source":"AGENTS.md","line":30,"appliesTo":"apps/web/**"}]}`;

/** Each source under its path, every line numbered so rules can cite it. */
export function ledgerUserPrompt(sources: LedgerSource[]): string {
	const blocks = sources.map((source) => {
		const lines = source.text.split('\n').map((line, index) => `${index + 1}| ${line}`);

		return `=== ${source.path} ===\n${lines.join('\n')}`;
	});

	return `Distill these instruction files into rules.\n\n${blocks.join('\n\n')}`;
}
