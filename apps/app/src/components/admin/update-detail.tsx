import { CollapsibleTrigger, Spinner } from '@recoder/ui';
import { Check, ChevronDown } from 'lucide-react';

import type { UpdateLine, UpdateStep } from '@/lib/update/update-line';

type AvailableLine = Extract<UpdateLine, { kind: 'available' }>;

/** The line under the version: what the updater is doing or what it found. */
export function UpdateDetail({ line }: { line: UpdateLine }) {
	switch (line.kind) {
		case 'current':
			return 'Up to date';
		case 'checking':
			return 'Checking for updates';
		case 'managed':
			return line.note;
		case 'progress':
			return <UpdateSteps steps={line.steps} />;
		case 'updated':
			return <UpdatedLine note={line.note} />;
		case 'failed':
			return <span data-tone="danger">{line.error}</span>;
		case 'available':
			return <AvailableLine line={line} />;
	}
}

function AvailableLine({ line }: { line: AvailableLine }) {
	const note = line.blockedReason ?? line.touches;

	return (
		<span className="update-available">
			<span className="update-headline">{line.headline}</span>
			{line.commits.length > 0 ? (
				<CollapsibleTrigger className="update-disclosure">
					What’s new
					<ChevronDown aria-hidden />
				</CollapsibleTrigger>
			) : null}
			{note ? <span data-tone={line.blockedReason ? 'danger' : undefined}>{note}</span> : null}
		</span>
	);
}

function UpdatedLine({ note }: { note: string | null }) {
	return (
		<span className="update-available">
			<span data-tone="success">Updated</span>
			{note ? <span>{note}</span> : null}
		</span>
	);
}

function UpdateSteps({ steps }: { steps: UpdateStep[] }) {
	return (
		<ol className="update-steps" aria-label="Update progress">
			{steps.map((step) => (
				<li key={step.label} data-stage={step.stage} aria-current={step.stage === 'current' ? 'step' : undefined}>
					<StepMark stage={step.stage} />
					{step.label}
				</li>
			))}
		</ol>
	);
}

/** The mark before a step, always the same width so the steps stay put as the update moves along. */
function StepMark({ stage }: { stage: UpdateStep['stage'] }) {
	return (
		<span className="update-step-mark" aria-hidden>
			{stage === 'current' ? <Spinner size={12} /> : null}
			{stage === 'done' ? <Check /> : null}
		</span>
	);
}
