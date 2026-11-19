import type { ReactNode } from 'react';

interface TrailStepProps {
	kind: 'thought' | 'note' | 'tool';
	failed?: boolean;
	/** The step's one line, and what it opens to: a thought's text, a call's files or output. */
	children: ReactNode;
}

/** The shape every step of the trail shares: one quiet line, as Capy lists what a reply did. */
export function TrailStep({ kind, failed = false, children }: TrailStepProps) {
	return (
		<li className="trail-step" data-kind={kind} data-failed={failed || undefined}>
			{children}
		</li>
	);
}
