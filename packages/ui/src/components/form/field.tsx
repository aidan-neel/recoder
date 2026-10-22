'use client';

import { AnimatePresence, motion } from 'motion/react';
import { Label } from 'radix-ui';
import { useId, useMemo, type ReactNode } from 'react';

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
 * control inside (Input, Textarea, Switch, Checkbox) picks up the field's id,
 * description and invalid state, so it needs no wiring of its own.
 */
export function Field({ label, hint, error, htmlFor, children, className }: FieldProps) {
	const generated = useId();
	const id = htmlFor ?? generated;
	const messageId = `${id}-message`;
	const failed = filled(error);
	const hasMessage = failed || filled(hint);

	const control = useMemo(
		() => ({ id, describedBy: hasMessage ? messageId : undefined, invalid: failed }),
		[id, messageId, hasMessage, failed]
	);

	return (
		<div data-ui="field" data-invalid={failed ? '' : undefined} className={cn(className)}>
			<Label.Root htmlFor={id} data-ui="field-label">
				{label}
			</Label.Root>
			<FieldContext value={control}>{children}</FieldContext>
			<FieldMessage id={messageId} text={failed ? error : hint} failed={failed} />
		</div>
	);
}
