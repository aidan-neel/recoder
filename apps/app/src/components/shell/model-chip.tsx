import { Tooltip } from '@recoder/ui';
import Link from 'next/link';

import { settingsHref } from '@/lib/shell/routes';

/** Whether reviews can run: a model is ready, one is set but does not answer, or none is set up. */
export type ModelState = 'ready' | 'off' | 'missing';

const STATE_LABELS: Record<ModelState, string> = {
	ready: 'Ready',
	off: 'Not answering',
	missing: 'Not set up'
};

interface ModelChipProps {
	/** `Opus 5.5`, or what to do when no model is set up. */
	label: string;
	state: ModelState;
}

/** The model reviews run with, at the foot of the sidebar. It opens the model's settings. */
export function ModelChip({ label, state }: ModelChipProps) {
	return (
		<Tooltip content="Change the review model">
			<Link href={settingsHref('models')} className="model-chip">
				<span className="model-dot" data-state={state} role="img" aria-label={STATE_LABELS[state]} />
				<span className="model-chip-name">{label}</span>
			</Link>
		</Tooltip>
	);
}
