'use client';

import type { ReviewMetrics } from '@recoder/shared';
import { useCallback, useEffect, useState } from 'react';

import { useApi } from '../api/client';
import { failureText } from '../api/http';
import { summarizeTokenUsage, type TokenUsageKind, type TokenUsageSummary } from './token-usage';

const POLL_MS = 2500;

type TokenUsageState =
	{ phase: 'loading' } | { phase: 'ready'; summary: TokenUsageSummary | null } | { phase: 'failed'; error: string };

/**
 * Reads and refreshes token usage for a review or repository chat while its
 * modal is open. Background polls update the figures in place without flashing
 * the loading skeleton.
 */
export function useTokenUsage(
	kind: TokenUsageKind,
	id: string,
	open: boolean
): TokenUsageState & { retry: () => void } {
	const client = useApi();
	const [state, setState] = useState<TokenUsageState>({ phase: 'loading' });
	const [nonce, setNonce] = useState(0);

	const retry = useCallback(() => {
		setState({ phase: 'loading' });
		setNonce((value) => value + 1);
	}, []);

	useEffect(() => {
		if (!open) return;

		let active = true;
		let currentAbort: AbortController | null = null;

		const fallback =
			kind === 'chat' ? 'Token usage for this chat did not load.' : 'Token usage for this review did not load.';

		async function fetchOnce(initial: boolean): Promise<void> {
			currentAbort?.abort();

			const controller = new AbortController();

			currentAbort = controller;

			if (initial) {
				setState((previous) => (previous.phase === 'ready' ? previous : { phase: 'loading' }));
			}

			try {
				const metrics: ReviewMetrics | null =
					kind === 'chat'
						? await client.chatMetrics(id, controller.signal)
						: await client.reviewMetrics(id, controller.signal);

				if (!active || controller.signal.aborted) return;

				setState({ phase: 'ready', summary: summarizeTokenUsage(metrics, kind) });
			} catch (error) {
				if (!active || controller.signal.aborted) return;

				setState((previous) =>
					previous.phase === 'ready' ? previous : { phase: 'failed', error: failureText(error, fallback) }
				);
			}
		}

		void fetchOnce(true);

		const timer = setInterval(() => {
			if (typeof document === 'undefined' || document.visibilityState === 'visible') {
				void fetchOnce(false);
			}
		}, POLL_MS);

		return () => {
			active = false;
			clearInterval(timer);
			currentAbort?.abort();
		};
	}, [client, id, kind, nonce, open]);

	useEffect(() => {
		setState({ phase: 'loading' });
	}, [id, kind]);

	return { ...state, retry };
}
