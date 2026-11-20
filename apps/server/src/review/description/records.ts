import type { PullDescriptionState } from '@recoder/shared';
import { collection, storageNow } from '../../storage/backend';

type Pending = Extract<PullDescriptionState, { status: 'pending' }>;

type Terminal = Extract<PullDescriptionState, { status: 'ready' | 'failed' }>;

type StoredState = Pending | Terminal;

interface HeadRecord {
	headSha: string;
	runId: string;
	updatedAt: number;
	state: StoredState;
}

interface DescriptionHistory {
	id: string;
	heads: HeadRecord[];
}

/** One row per PR makes the claim, its fence, and old-head retention a single transaction. */
const histories = collection<DescriptionHistory>('pull_descriptions');

const CLAIM_MS = 180_000;
const RETRY_MS = 60_000;
const KEEP_HEADS = 3;

export async function savedDescription(
	id: string,
	headSha: string,
	regenerate: boolean
): Promise<StoredState | undefined> {
	const current = (await histories.get(id))?.heads.find((head) => head.headSha === headSha);

	if (!current) return undefined;
	if (current.state.status === 'ready') return regenerate ? undefined : current.state;
	if (current.state.status === 'failed' && regenerate) return undefined;

	return reusable(current, await storageNow(), regenerate) ? current.state : undefined;
}

function reusable(head: HeadRecord, now: number, regenerate: boolean): boolean {
	if (head.state.status === 'pending') return active(head, now);

	return !regenerate && (head.state.status === 'ready' || now - head.updatedAt < RETRY_MS);
}

function active(head: HeadRecord, now: number): boolean {
	return head.state.status === 'pending' && now - head.updatedAt < CLAIM_MS;
}

/** Start once per head across replicas; concurrent POSTs join a run that's already pending. */
export async function claimDescription(id: string, headSha: string, regenerate: boolean) {
	const now = await storageNow();
	const runId = crypto.randomUUID();
	const pending: Pending = { status: 'pending', headSha, startedAt: new Date(now).toISOString() };

	const history = await histories.update(id, (current) => {
		const head = current?.heads.find((item) => item.headSha === headSha);

		if (head && reusable(head, now, regenerate)) return current;

		const heads = [
			{ headSha, runId, updatedAt: now, state: pending },
			...(current?.heads ?? []).filter((item) => item !== head)
		];

		return { id, heads: retain(heads, now) };
	});

	const head = history!.heads.find((item) => item.headSha === headSha)!;

	return { state: head.state, runId: head.runId === runId ? runId : null };
}

/** Don't evict an active claim even if a PR changes heads several times while it runs. */
function retain(heads: HeadRecord[], now: number): HeadRecord[] {
	return heads.filter((head, index) => index < KEEP_HEADS || active(head, now));
}

/** An expired or replaced executor cannot publish its result even if its provider eventually replies. */
export async function finishDescription(id: string, runId: string, state: Terminal): Promise<void> {
	const now = await storageNow();

	await histories.update(id, (current) => {
		const head = current?.heads.find((item) => item.runId === runId);

		if (!current || !head || !active(head, now)) return current;

		head.state = state;
		head.updatedAt = now;

		return { id, heads: retain(current.heads, now) };
	});
}
