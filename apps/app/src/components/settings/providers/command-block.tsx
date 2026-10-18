'use client';

import { CodeBlock } from '@recoder/ui';

interface CommandBlockProps {
	/** What to do with the command: "Install it, then check again." */
	hint: string;
	command: string;
}

/** A shell command to run by hand, under what to do with it, in the kit's code block with its copy button. */
export function CommandBlock({ hint, command }: CommandBlockProps) {
	return (
		<div data-ui="provider-command" className="provider-command">
			<p className="provider-command-hint">{hint}</p>
			<CodeBlock code={command} lang="bash" copy />
		</div>
	);
}
