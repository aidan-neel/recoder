'use client';

import { Button, Pill } from '@recoder/ui';
import { ChevronRight } from 'lucide-react';
import { useMemo } from 'react';

import type { BugView } from '@/lib/bugs/types';
import type { GuidePart } from '@/lib/changes/types';
import { plural } from '@/lib/shell/format';
import { worstTone } from '@/lib/summary/bug-tones';
import { walkthroughSteps, type WalkthroughStep } from '@/lib/summary/walkthrough';

interface WalkthroughProps {
	parts: GuidePart[];
	/** The review's open findings, to tint each step's bug badge by its worst severity. */
	open: readonly BugView[];
	/** Opens the Changes tab in the guide's reading order. */
	onOpenGuide: () => void;
}

/**
 * The order to read the change in, as a compact numbered list: each step's
 * title over one line of why, with its open bugs as a badge and its size.
 * Nothing renders until the review has planned.
 */
export function Walkthrough({ parts, open, onOpenGuide }: WalkthroughProps) {
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
					<ChevronRight aria-hidden />
				</Button>
			</div>
			<ol className="walkthrough">
				{steps.map((step, index) => (
					<Step key={step.id} step={step} place={index + 1} open={open} />
				))}
			</ol>
		</section>
	);
}

/** One step: its place, its title and note, each cut to one line with the whole on hover, then its facts. */
function Step({ step, place, open }: { step: WalkthroughStep; place: number; open: readonly BugView[] }) {
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
				{step.bugs > 0 ? <Pill tone={worstTone(step.paths, open) ?? 'neutral'}>{plural(step.bugs, 'bug')}</Pill> : null}
				<span className="walkthrough-size">{plural(step.paths.length, 'file')}</span>
			</div>
		</li>
	);
}
