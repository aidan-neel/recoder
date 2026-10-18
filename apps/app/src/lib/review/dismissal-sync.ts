import { failureText } from '../api/http';
import { reviewsApi } from '../api/reviews';
import { errorToast } from '../shell/notify';
import type { DecisionState } from './surface';

/** The reason the server stores with a dismissal. */
const DISMISS_REASON = 'Not an issue';

let writes: Promise<unknown> = Promise.resolve();

/** Dismissals that never reached the server (`review/finding`), so opening one again has nothing to restore there. */
const unsaved = new Set<string>();

/** What a failed write leaves behind, said plainly: why it failed, then where the decision now stands. */
function failed(error: unknown, now: DecisionState): void {
	const left =
		now === 'dismissed'
			? 'The decision is saved here, but Recoder will raise this again next review.'
			: 'It’s open again here, but Recoder still treats it as not an issue.';

	errorToast('Couldn’t save that on the server', `${failureText(error, '')} ${left}`.trim());
}

/**
 * Tells the server a finding became "not an issue", or stopped being one, so
 * later reviews of the repo stop raising it. Writes run one at a time, in
 * order; any other change of state sends nothing. A dismissal the server
 * never stored is not restored there, so undoing it reports nothing false.
 */
export function sendDismissal(reviewId: string, findingId: string, was: DecisionState, now: DecisionState): void {
	if (was === now || (was !== 'dismissed' && now !== 'dismissed')) return;

	const key = `${reviewId}/${findingId}`;

	async function write(): Promise<void> {
		if (now !== 'dismissed') {
			if (!unsaved.delete(key)) await reviewsApi.restore(reviewId, findingId);

			return;
		}

		unsaved.add(key);
		await reviewsApi.dismiss(reviewId, findingId, DISMISS_REASON);
		unsaved.delete(key);
	}

	writes = writes.then(write).catch((error: unknown) => failed(error, now));
}
