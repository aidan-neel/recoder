'use client';

import { AnimatePresence, motion } from 'motion/react';
import { Label } from 'radix-ui';
import { useId, useMemo, type MouseEvent, type ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { swapMotion } from '../../motion/presets';
import { useMotionVariants } from '../../motion/reduced';
import { FieldContext } from './field-context';

interface FieldProps {
	label: ReactNode;
	hint?: ReactNode;
	/** Replaces the hint while set, and marks the control inside as invalid. */
	error?: ReactNode;
	/** The control's id. Leave it out and the field gives the control inside an id of its own. */
	htmlFor?: string;
	children: ReactNode;
	className?: string;
}

interface MessageProps {
	id: string;
	text: ReactNode;
	failed: boolean;
}

/** True when a slot holds something to render (`0` counts; `false`, `null` and `''` do not). */
function filled(node: ReactNode): boolean {
	return node !== undefined && node !== null && node !== false && node !== '';
}

/** Finds a child control whose `aria-labelledby` token list names `labelId`. */
function findLabelledControl(container: ParentNode | null, labelId: string): HTMLElement | null {
	if (!container) return null;

	for (const element of container.querySelectorAll<HTMLElement>('[aria-labelledby]')) {
		const tokens = element.getAttribute('aria-labelledby')?.split(/\s+/) ?? [];

		if (tokens.includes(labelId)) return element;
	}

	return null;
}

/** Focuses a control that HTML `<label for>` cannot label itself (such as a `role="textbox"` element). */
export function focusFieldControl(event: MouseEvent<HTMLLabelElement>, id: string, labelId: string): void {
	const label = event.currentTarget;

	if (event.defaultPrevented || label.control) return;

	if (
		typeof Element !== 'undefined' &&
		event.target instanceof Element &&
		event.target.closest('a, button, input, select, textarea')
	) {
		return;
	}

	const target = label.ownerDocument.getElementById(id) ?? findLabelledControl(label.parentElement, labelId);

	if (target && target.getAttribute('aria-disabled') !== 'true') target.focus();
}

/**
 * The line under the control. Hint and error swap in place: the old line
 * leaves before the new one rises in, so two sentences never overlap.
 */
function FieldMessage({ id, text, failed }: MessageProps) {
	const key = failed ? `error:${typeof text === 'string' ? text : ''}` : 'hint';
	const variants = useMotionVariants(swapMotion);

	return (
		<div id={id} data-ui="field-message" aria-live="polite">
			<AnimatePresence initial={false} mode="wait">
				{filled(text) ? (
					<motion.p
						key={key}
						data-ui={failed ? 'field-error' : 'field-hint'}
						variants={variants}
						initial="initial"
						animate="animate"
						exit="exit"
					>
						{text}
					</motion.p>
				) : null}
			</AnimatePresence>
		</div>
	);
}

/**
 * A label above a control, with an optional hint or error under it. The
 * control inside (Input, Textarea, LinkField, Switch, Checkbox) picks up the
 * field's id, label, description and invalid state, so it needs no wiring of
 * its own.
 */
export function Field({ label, hint, error, htmlFor, children, className }: FieldProps) {
	const generated = useId();
	const id = htmlFor ?? generated;
	const labelId = `${id}-label`;
	const messageId = `${id}-message`;
	const failed = filled(error);
	const hasMessage = failed || filled(hint);

	const control = useMemo(
		() => ({ id, labelId, describedBy: hasMessage ? messageId : undefined, invalid: failed }),
		[id, labelId, messageId, hasMessage, failed]
	);

	return (
		<div data-ui="field" data-invalid={failed ? '' : undefined} className={cn(className)}>
			<Label.Root
				id={labelId}
				htmlFor={id}
				data-ui="field-label"
				onClick={(event) => focusFieldControl(event, id, labelId)}
			>
				{label}
			</Label.Root>
			<FieldContext value={control}>{children}</FieldContext>
			<FieldMessage id={messageId} text={failed ? error : hint} failed={failed} />
		</div>
	);
}
