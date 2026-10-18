'use client';

import type { PrCheck } from '@recoder/shared';
import { StatusGlyph, type GlyphKind } from '@recoder/ui';

const GLYPH: Record<PrCheck['state'], GlyphKind> = {
	passed: 'ok',
	failed: 'failed',
	running: 'spinner',
	pending: 'idle',
	skipped: 'dismissed'
};

const ORDER: PrCheck['state'][] = ['failed', 'running', 'pending', 'passed', 'skipped'];

/** The pull request's CI, failures first; a check with a log links to it. */
export function CiChecks({ checks }: { checks: PrCheck[] }) {
	const sorted = [...checks].sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state));

	return (
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
	);
}
