'use client';

import type { PrCheck } from '@recoder/shared';
import { StatusGlyph, type GlyphKind } from '@recoder/ui';
import { StatusNotice } from '@recoder/ui/status-notice';

import { OpenConnections } from '@/components/guidelines/open-connections';
import { listTime } from '@/lib/queue/format';
import { useReview } from '@/lib/review/review-store';

import { ActionButton } from './action-button';

const GLYPH: Record<PrCheck['state'], GlyphKind> = {
	passed: 'ok',
	failed: 'failed',
	running: 'spinner',
	pending: 'idle',
	skipped: 'dismissed'
};

const ORDER: PrCheck['state'][] = ['failed', 'running', 'pending', 'passed', 'skipped'];

/**
 * One quiet line under checks a later read could not bring up to date: when
 * they were read, the reason in plain words, and the way out. Try again
 * reads the checks again; a rejected token opens Connections instead, and
 * says nothing more while the pull request's line already says so. The next
 * answer clears it.
 */
function NotRefreshed() {
	const stale = useReview((state) => state.checksStale);
	const pullSaysAuth = useReview((state) => state.pullError?.kind === 'auth');
	const retry = useReview((state) => state.retryChecks);

	if (!stale) return null;

	const { since, failure } = stale;
	const auth = failure.kind === 'auth';
	const quiet = auth && pullSaysAuth;

	return (
		<StatusNotice
			variant="inline"
			title={since ? `Not refreshed since ${listTime(since)}.` : 'Couldn’t refresh.'}
			detail={quiet ? null : failure.text || null}
			actions={quiet ? null : auth ? <OpenConnections /> : <ActionButton run={retry}>Try again</ActionButton>}
			className="ci-stale"
		/>
	);
}

/**
 * The pull request's CI, failures first; a check with a log links to it.
 * Checks a later read failed to refresh stay, with a line that says so.
 */
export function CiChecks({ checks }: { checks: PrCheck[] }) {
	const sorted = [...checks].sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state));

	return (
		<>
			<ul data-ui="ci-checks" className="ci" aria-label="CI checks">
				{sorted.map((check) => {
					const body = (
						<>
							<StatusGlyph kind={GLYPH[check.state]} label={check.state} />
							{check.name}
						</>
					);

					return (
						<li key={check.id ?? check.name}>
							{check.url ? (
								<a className="ci-check" data-state={check.state} href={check.url} target="_blank" rel="noreferrer">
									{body}
								</a>
							) : (
								<span className="ci-check" data-state={check.state}>
									{body}
								</span>
							)}
						</li>
					);
				})}
			</ul>
			<NotRefreshed />
		</>
	);
}
