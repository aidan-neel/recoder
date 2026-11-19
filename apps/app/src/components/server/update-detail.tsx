import { CheckIcon, XIcon } from '@phosphor-icons/react';
import { Spinner } from '@recoder/ui';

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
			return 'Updating';
		case 'updated':
			return <UpdatedLine note={line.note} />;
		case 'failed':
		case 'rolled-back':
			return <span data-tone="danger">{line.error}</span>;
		case 'available':
			return <AvailableLine line={line} />;
	}
}

function AvailableLine({ line }: { line: AvailableLine }) {
	return (
		<span className="update-available">
			{line.since ? <span>{line.since}</span> : null}
			{line.blockedReason ? <span data-tone="danger">{line.blockedReason}</span> : null}
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

/** An update's steps, one a line: what it will do before it starts, and how far it got while it runs. */
export function UpdateSteps({ steps, label }: { steps: UpdateStep[]; label: string }) {
	return (
		<ol className="update-steps" aria-label={label}>
			{steps.map((step) => (
				<li key={step.label} data-stage={step.stage} aria-current={step.stage === 'current' ? 'step' : undefined}>
					<StepMark stage={step.stage} />
					<span className="update-step-label">{step.label}</span>
					{step.detail ? <span className="update-step-detail">{step.detail}</span> : null}
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
			{stage === 'done' ? <CheckIcon /> : null}
			{stage === 'failed' ? <XIcon /> : null}
		</span>
	);
}
