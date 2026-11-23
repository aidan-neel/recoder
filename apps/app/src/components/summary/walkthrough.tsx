'use client';

import { Button, Icon, Pill } from '@recoder/ui';
import { useMemo } from 'react';

import { foundLabel, foundTone, foundTotal } from '@/lib/bugs/tiers';
import type { GuidePart } from '@/lib/changes/types';
import { plural } from '@/lib/shell/format';
import { walkthroughSteps, type WalkthroughStep } from '@/lib/summary/walkthrough';

interface WalkthroughProps {
	parts: GuidePart[];
	/** Opens the Changes tab in the guide's reading order. */
	onOpenGuide: () => void;
}

/**
 * The order to read the change in, as a compact numbered list: each step's
 * title over one line of why, with its open bugs as a badge and its size.
 * Nothing renders until the review has planned.
 */
export function Walkthrough({ parts, onOpenGuide }: WalkthroughProps) {
	const steps = useMemo(() => walkthroughSteps(parts), [parts]);

	if (steps.length === 0) return null;

	return (
		<section className="summary-section" aria-labelledby="walkthrough-title">
			<div className="summary-section-head">
				<h2 id="walkthrough-title" className="summary-section-title">
					Walkthrough
					<span className="summary-count">{steps.length}</span>
				</h2>
				<Button variant="ghost" onClick={onOpenGuide}>
					Open in Changes
					<Icon name="chevron_right" />
				</Button>
			</div>
			<ol className="walkthrough">
				{steps.map((step, index) => (
					<Step key={step.id} step={step} place={index + 1} />
				))}
			</ol>
		</section>
	);
}

/** One step: its place, its title and note, each cut to one line with the whole on hover, then its facts. */
function Step({ step, place }: { step: WalkthroughStep; place: number }) {
	return (
		<li className="walkthrough-step">
			<span className="walkthrough-place">{place}</span>
			<div className="walkthrough-text">
				<span className="walkthrough-title" title={step.title}>
					{step.title}
				</span>
				{step.note ? (
					<span className="walkthrough-note" title={step.note}>
						{step.note}
					</span>
				) : null}
			</div>
			<div className="walkthrough-facts">
				{foundTotal(step.found) > 0 ? <Pill tone={foundTone(step.found)}>{foundLabel(step.found)}</Pill> : null}
				<span className="walkthrough-size">{plural(step.paths.length, 'file')}</span>
			</div>
		</li>
	);
}
