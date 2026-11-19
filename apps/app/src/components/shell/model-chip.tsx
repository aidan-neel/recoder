import { Tooltip } from '@recoder/ui';

import { useApi } from '@/lib/api/client';
import { openSettings } from '@/lib/settings/open-settings';
import { isLiveApp } from '@/lib/shell/routes';

/** Whether reviews can run: a model is ready, one is set but does not answer, or none is set up. */
type ModelState = 'ready' | 'off' | 'missing';

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

/**
 * The model reviews run with, at the foot of the sidebar. In the live app it opens the model's settings; the sample
 * has no Settings, so there it only names the model.
 */
export function ModelChip({ label, state }: ModelChipProps) {
	const parts = (
		<>
			<span className="model-dot" data-state={state} role="img" aria-label={STATE_LABELS[state]} />
			<span className="model-chip-name">{label}</span>
		</>
	);

	if (!isLiveApp(useApi().base)) return <span className="model-chip">{parts}</span>;

	return (
		<Tooltip content="Change the review model">
			<button type="button" className="model-chip" onClick={() => openSettings('models')}>
				{parts}
			</button>
		</Tooltip>
	);
}
