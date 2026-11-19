import type { SetupStep as Step } from '@recoder/shared';
import { StatusGlyph, SwapText } from '@recoder/ui';
import { useEffect, useRef, type ReactNode } from 'react';

import { STEP_ORDER } from '@/lib/setup/setup-steps';
import type { SaveState } from '@/lib/settings/use-save-state';

import { SettingsRow } from '@/components/settings/settings-group';

interface SetupStepProps {
	name: string;
	step: Step;
	/** The first step not done: its body opens under the row, and its action is the page's next one. */
	current: boolean;
	/** What the step is about, shown while it waits its turn. */
	hint: string;
	/** Shows the fact in the code face: an address. */
	code?: boolean;
	/** Where the step's own save stands, when its control saves on change. */
	state?: SaveState;
	/** Under the row while the step is current, or open again to change it. */
	body?: ReactNode;
	/** Opens the body of a done step again. */
	open?: boolean;
	/** The step's actions, at the end of its row. */
	children?: ReactNode;
}

/** The step's mark: its number in a ring, the current one's in the accent, and a check mark once done. */
function StepMark({ number, done, current }: { number: number; done: boolean; current: boolean }) {
	if (done) return <StatusGlyph kind="ok" label="Done" />;

	return (
		<span className="step-mark" data-current={current || undefined} aria-label={current ? 'Next' : 'To do'}>
			{number}
		</span>
	);
}

/**
 * The fields a step asks for. Its buttons are left out: one that disables while it works, as Run again does while the
 * checks run, would drop focus again.
 */
const FIELD = 'input:not([disabled]):not([readonly]), select:not([disabled]), textarea:not([disabled])';

/**
 * The step, which takes focus as it becomes current when the step before took it down with it: the control that
 * finished that step unmounts, so focus would fall to the page and the keyboard would lose its place. Its first field
 * takes it, else the step itself, so the next Tab reaches its first control.
 */
function useTakeFocus(current: boolean) {
	const step = useRef<HTMLDivElement>(null);
	const was = useRef(current);

	useEffect(() => {
		const became = current && !was.current;

		was.current = current;

		if (!became || document.activeElement !== document.body) return;

		(step.current?.querySelector<HTMLElement>(FIELD) ?? step.current)?.focus();
	}, [current]);

	return step;
}

/** The row's one line: the fact once done, nothing while current (the body says it), else what the step is about. */
function detailOf(step: Step, current: boolean, hint: string): string | null {
	if (step.done) return step.fact ?? null;

	return current ? null : hint;
}

/** One step of the setup checklist: its mark, its name and one line, its actions, and its body while current. */
export function SetupStep({ name, step, current, hint, code, state, body, open, children }: SetupStepProps) {
	const detail = detailOf(step, current, hint);
	const opened = current || (open ?? false);
	const focusStep = useTakeFocus(current);

	return (
		<div
			ref={focusStep}
			className="setup-step"
			data-current={current || undefined}
			data-done={step.done || undefined}
			tabIndex={-1}
		>
			<SettingsRow
				leading={<StepMark number={STEP_ORDER.indexOf(step.id) + 1} done={step.done} current={current} />}
				name={name}
				detail={
					detail ? (
						<SwapText mode="wait">
							<span className={code && step.done ? 'setup-fact-code' : undefined}>{detail}</span>
						</SwapText>
					) : null
				}
				error={step.error && !opened ? step.error : undefined}
				state={state}
			>
				{children}
			</SettingsRow>
			{opened && body ? <div className="setup-body">{body}</div> : null}
		</div>
	);
}
