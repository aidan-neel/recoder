import type { ReviewMetrics, TokenCall } from './metrics';
import type { ModelCallOutcome } from './telemetry';

const LLM_STATUS = /^LLM (\d+):/;

/** A stored call's outcome: a failure whose error says it was cancelled or aborted is a cancellation. */
export function storedOutcome(call: Pick<TokenCall, 'status' | 'error'>): ModelCallOutcome {
	if (call.status === 'completed') return 'ok';

	if (call.status === 'failed' && !(call.error && /cancelled|aborted/i.test(call.error))) return 'failed';

	return 'cancelled';
}

/** A stored call's error kind: its own when it kept one, else the best hint its message's `LLM <status>:` shape gives. */
export function storedErrorKind(call: Pick<TokenCall, 'error' | 'errorKind'>): string {
	if (call.errorKind) return call.errorKind;

	const status = Number(LLM_STATUS.exec(call.error ?? '')?.[1]);

	if (status === 429 || status === 529) return 'rate-limit';
	if (status >= 500) return 'provider';
	if (status >= 400) return 'request';
	if (call.error && /timed out|timeout/i.test(call.error)) return 'timeout';

	return 'error';
}

/**
 * What a review's usage shows beside its totals: every call that failed with its error kind, and each verifier
 * session's latest counters. A session reports cumulative counters on each of its calls, so the last call's are kept.
 */
export function callDiagnostics(calls: readonly TokenCall[]): Pick<ReviewMetrics, 'failures' | 'verifierSessions'> {
	const failures = calls
		.filter((call) => storedOutcome(call) === 'failed')
		.map((call) => ({
			id: call.id,
			model: call.model,
			provider: call.provider,
			...(call.stage && { stage: call.stage }),
			errorKind: storedErrorKind(call),
			...(call.error && { error: call.error })
		}));

	const sessions = new Map<string, NonNullable<ReviewMetrics['verifierSessions']>[number]>();

	for (const call of calls) {
		if (call.verifierSession) sessions.set(call.verifierSession.id, { ...call.verifierSession, model: call.model });
	}

	return { failures, ...(sessions.size > 0 && { verifierSessions: [...sessions.values()] }) };
}
