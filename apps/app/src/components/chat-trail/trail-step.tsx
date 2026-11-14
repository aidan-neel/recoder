import type { ReactNode } from 'react';

interface TrailStepProps {
	/** The mark on the trail's line: the step's icon, a spinner, or the failure mark. */
	icon: ReactNode;
	kind: 'thought' | 'tool';
	failed?: boolean;
	/** The step's label, then what it holds: a thought's text, a call's files or output. */
	children: ReactNode;
}

/** The shape every step of the trail shares: its icon on the line that joins the steps, then its label and body. */
export function TrailStep({ icon, kind, failed = false, children }: TrailStepProps) {
	return (
		<li className="trail-step" data-kind={kind} data-failed={failed || undefined}>
			<span className="trail-icon" aria-hidden>
				{icon}
			</span>
			<div className="trail-step-body">{children}</div>
		</li>
	);
}
