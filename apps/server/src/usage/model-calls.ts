import type { ModelCallOutcome, ModelCallRow } from '@recoder/shared';
import { db, modelCalls, reviewMetrics } from '../store';
import type { RunTokenCall, StoredMetrics } from '../models/metrics';

/** How long recorded model calls are kept; rows older than this are pruned at startup. */
export const MODEL_CALL_KEEP_DAYS = 400;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Who a metrics row's calls were for: its review or repository chat, or `other` when neither exists. */
interface CallOwner {
	kind: ModelCallRow['kind'];
	ownerId: string | null;
	person: string | null;
}

async function ownerOf(metricsId: string, reviewStarters: Map<string, string | undefined>): Promise<CallOwner> {
	if (reviewStarters.has(metricsId)) {
		return { kind: 'review', ownerId: metricsId, person: reviewStarters.get(metricsId) ?? null };
	}

	const chat = await db.repoChats.get(metricsId);

	if (chat) return { kind: 'chat', ownerId: metricsId, person: chat.startedBy ?? null };

	return { kind: 'other', ownerId: null, person: null };
}

function outcomeOf(call: RunTokenCall): ModelCallOutcome {
	if (call.status === 'completed') return 'ok';

	if (call.status === 'failed' && !(call.error && /cancelled|aborted/i.test(call.error))) return 'failed';

	return 'cancelled';
}

const LLM_STATUS = /^LLM (\d+):/;

/** A live call carries its own error kind; for a stored one the message's `LLM <status>:` shape is the best hint left. */
function storedErrorKind(error: string | undefined): string {
	const status = Number(LLM_STATUS.exec(error ?? '')?.[1]);

	if (status === 429 || status === 529) return 'rate-limit';
	if (status >= 500) return 'provider';
	if (status >= 400) return 'request';
	if (error && /timed out|timeout/i.test(error)) return 'timeout';

	return 'error';
}

function rowOf(call: RunTokenCall, metrics: StoredMetrics, owner: CallOwner): ModelCallRow {
	const outcome = outcomeOf(call);
	const worker = call.run !== undefined ? metrics.runs?.[call.run]?.worker : undefined;

	return {
		id: call.id,
		at: call.at ?? metrics.startedAt,
		person: owner.person,
		kind: owner.kind,
		ownerId: owner.ownerId,
		...(call.stage && { stage: call.stage }),
		provider: call.provider,
		model: call.model,
		usage: call.usage,
		outcome,
		...(outcome === 'failed' && { errorKind: storedErrorKind(call.error) }),
		...(worker && { worker })
	};
}

/**
 * Copies every call already stored on review and chat metrics into `model_calls`, so usage
 * history kept before the collection existed is not lost. A call id already recorded is left
 * alone, so running this again — or a second replica starting — adds nothing.
 */
export async function backfillModelCalls(): Promise<number> {
	const [stored, existing, reviews] = await Promise.all([reviewMetrics.list(), modelCalls.list(), db.reviews.list()]);

	const recorded = new Set(existing.map((row) => row.id));
	const starters = new Map(reviews.map((review) => [review.id, review.startedBy]));

	let added = 0;

	for (const metrics of stored) {
		const owner = await ownerOf(metrics.id, starters);

		for (const call of metrics.calls) {
			if (recorded.has(call.id)) continue;
			await modelCalls.set(rowOf(call, metrics, owner));
			added++;
		}
	}

	return added;
}

/** Drops call rows older than {@link MODEL_CALL_KEEP_DAYS} days; returns how many it removed. */
export async function pruneModelCalls(now = Date.now()): Promise<number> {
	const cutoff = now - MODEL_CALL_KEEP_DAYS * DAY_MS;
	let pruned = 0;

	for (const row of await modelCalls.list()) {
		const at = Date.parse(row.at);

		if (!Number.isNaN(at) && at < cutoff) {
			await modelCalls.delete(row.id);
			pruned++;
		}
	}

	return pruned;
}
