import { SquareTerminal } from 'lucide-react';

import { cn } from '../../lib/cn';
import { AGENT_PATHS } from './agent-paths';

interface AgentMarkProps {
	/** The server's agent id: `claude-code`, `codex`, `opencode`… */
	agent: string;
	/** What a screen reader hears; leave it out where the CLI's name is beside the mark. */
	label?: string;
	className?: string;
}

/**
 * An agent CLI's mark in the current text color (Claude Code in its own
 * orange), or a terminal for a CLI without one, such as a custom command.
 * 16px unless sized.
 */
export function AgentMark({ agent, label, className }: AgentMarkProps) {
	const paths = AGENT_PATHS[agent];
	const classes = cn('size-4 shrink-0', className);
	const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true };

	if (!paths) return <SquareTerminal data-ui="agent-mark" className={classes} {...a11y} />;

	return (
		<svg
			viewBox="0 0 24 24"
			fill="currentColor"
			fillRule="evenodd"
			data-ui="agent-mark"
			data-agent={agent}
			className={classes}
			{...a11y}
		>
			{paths.map((path) => (
				<path key={path} d={path} />
			))}
		</svg>
	);
}
