import type {
	UpdateAvailable,
	UpdateCurrent,
	UpdateMode,
	UpdateState,
	UpdateStatus,
	WebRestart
} from '@recoder/shared';
import { collection } from '../storage/backend';

/** The one record an install keeps: its id is always `current`. */
export const UPDATE_RECORD_ID = 'current';

/**
 * The update's durable state, so the UI can poll it across the restart: what
 * was coming, how far the apply got, and which reviews to resume on the next
 * boot. Written at every transition; cleared once the successor resumed the
 * reviews or the update failed and its reviews were let go.
 */
export interface UpdateRecord {
	id: typeof UPDATE_RECORD_ID;
	state: UpdateState;
	mode: UpdateMode;
	current: UpdateCurrent;
	available: UpdateAvailable | null;
	blockedReason?: string;
	error?: string;
	/** Reviews paused so the update could apply; the next boot resumes exactly these. */
	pausedReviewIds: string[];
	managedNote?: string;
	webRestart?: WebRestart;
	updatedAt: string;
}

export const updateRecords = collection<UpdateRecord>('update_state');

/** The stored update as the API reports it. */
export function toStatus(record: UpdateRecord): UpdateStatus {
	return {
		mode: record.mode,
		current: record.current,
		available: record.available,
		state: record.state,
		...(record.error !== undefined ? { error: record.error } : {}),
		...(record.blockedReason !== undefined ? { blockedReason: record.blockedReason } : {}),
		...(record.pausedReviewIds.length ? { pausedReviews: record.pausedReviewIds.length } : {}),
		...(record.managedNote !== undefined ? { managedNote: record.managedNote } : {}),
		...(record.webRestart !== undefined ? { webRestart: record.webRestart } : {})
	};
}
