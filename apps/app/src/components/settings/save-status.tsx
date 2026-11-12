import { Spinner } from '@recoder/ui';
import { Check, X } from 'lucide-react';

import type { SaveState } from '@/lib/settings/use-save-state';

const SPOKEN: Record<SaveState, string> = {
	idle: '',
	pending: 'Saving',
	success: 'Saved',
	error: 'Not saved'
};

/**
 * Where a save that runs on change stands: a spinner, then a check or a
 * cross for a moment. The slot is always there, so the control beside it
 * never moves.
 */
export function SaveStatus({ state }: { state: SaveState }) {
	return (
		<span className="save-status" role="status" aria-label={SPOKEN[state] || undefined}>
			<span data-face="pending" data-on={state === 'pending'} aria-hidden>
				<Spinner size={14} />
			</span>
			<span data-face="success" data-on={state === 'success'} aria-hidden>
				<Check />
			</span>
			<span data-face="error" data-on={state === 'error'} aria-hidden>
				<X />
			</span>
		</span>
	);
}
