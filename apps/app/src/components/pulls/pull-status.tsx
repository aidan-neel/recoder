'use client';

import { Button, Pill, Spinner, type ButtonStatus, type PillTone } from '@recoder/ui';

import { plural } from '@/lib/shell/format';
import type { PullRowStatus } from '@/lib/pulls/types';

interface StatusFace {
	tone: PillTone;
	label: string;
}

/** `2 bugs`, `1 suggestion`, or both when the review found both. */
function findingsLabel(bugs: number, suggestions: number): string {
	if (suggestions === 0) return plural(bugs, 'bug');
	if (bugs === 0) return plural(suggestions, 'suggestion');

	return `${plural(bugs, 'bug')}, ${plural(suggestions, 'suggestion')}`;
}

/** The pill each status wears. The two statuses that ask for a review wear a button and have no face. */
function statusFace(status: PullRowStatus): StatusFace | null {
	switch (status.kind) {
		case 'reviewing':
			return { tone: 'low', label: 'Reviewing' };
		case 'bugs':
			return {
				tone: status.bugs > 0 ? 'high' : 'medium',
				label: findingsLabel(status.bugs, status.suggestions)
			};
		case 'review-failed':
			return { tone: 'danger', label: 'Review failed' };
		case 'conflicts':
			return { tone: 'medium', label: 'Merge conflicts' };
		case 'checks-failing':
			return { tone: 'danger', label: plural(status.failed, 'check') + ' failing' };
		case 'draft':
			return { tone: 'neutral', label: 'Draft' };
		case 'ready':
			return { tone: 'ok', label: 'Ready to merge' };
		case 'reviewed':
			return { tone: 'neutral', label: 'No bugs' };
		case 'not-reviewed':
		case 'outdated':
			return null;
	}
}

interface PullStatusProps {
	status: PullRowStatus;
	/** True while this row's review start is in flight. */
	starting: boolean;
	onReview: () => void;
}

/**
 * The one thing a row says about its pull request: a pill for a state, or
 * the Review button when the next step is a review. A pull request with
 * commits newer than its review gets the quieter "Review again".
 */
export function PullStatus({ status, starting, onReview }: PullStatusProps) {
	const face = statusFace(status);
	const pending: ButtonStatus = starting ? 'pending' : 'idle';

	if (face) {
		const lead = status.kind === 'reviewing' ? <Spinner size={11} /> : <span aria-hidden className="pill-dot" />;

		return (
			<Pill tone={face.tone} icon={status.kind === 'draft' || status.kind === 'reviewed' ? undefined : lead}>
				{face.label}
			</Pill>
		);
	}

	if (status.kind === 'outdated') {
		return (
			<Button variant="outline" size="sm" status={pending} onClick={onReview}>
				Review again
			</Button>
		);
	}

	return (
		<Button variant="primary" size="sm" status={pending} onClick={onReview}>
			Review
		</Button>
	);
}
