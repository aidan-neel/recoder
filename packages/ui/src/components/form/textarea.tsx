'use client';

import { useComposedRefs } from 'radix-ui/internal';
import { useLayoutEffect, useState, type CSSProperties, type Ref, type TextareaHTMLAttributes } from 'react';

import { cn } from '../../lib/cn';
import { useFieldControl } from './field-context';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
	/** Grow with the text, between `minRows` and `maxRows`, instead of showing a resize handle. */
	autosize?: boolean;
	/** The rows the field shows when empty. Defaults to 3. */
	minRows?: number;
	/** With `autosize`, the rows it grows to before it scrolls. Unset, it grows without limit. */
	maxRows?: number;
	invalid?: boolean;
	className?: string;
	ref?: Ref<HTMLTextAreaElement>;
}

/** True where CSS sizes the field to its content (`field-sizing: content`). */
function sizesItself(): boolean {
	return typeof CSS !== 'undefined' && CSS.supports('field-sizing', 'content');
}

/** Sets the height from the content where `field-sizing` is missing; CSS min and max heights still clamp it. */
function fit(node: HTMLTextAreaElement) {
	if (sizesItself()) return;

	node.style.height = 'auto';
	node.style.height = `${node.scrollHeight}px`;
}

/**
 * A multi-line field with the same ring, fill and focus halo as `Input`. With
 * `autosize` it grows as the text grows (CSS `field-sizing`, with a script
 * fallback where the browser lacks it).
 */
export function Textarea({
	autosize = false,
	minRows = 3,
	maxRows,
	invalid,
	className,
	style,
	id,
	'aria-describedby': describedBy,
	onInput,
	ref,
	...props
}: TextareaProps) {
	const field = useFieldControl({ id, describedBy, invalid });
	const [node, setNode] = useState<HTMLTextAreaElement | null>(null);
	const composed = useComposedRefs(ref, setNode);

	const rows = {
		'--textarea-min-rows': minRows,
		'--textarea-max-rows': autosize && maxRows ? maxRows : undefined
	} as CSSProperties;

	useLayoutEffect(() => {
		if (autosize && node) fit(node);
	}, [autosize, node, props.value]);

	return (
		<textarea
			ref={composed}
			id={field.id}
			rows={minRows}
			aria-describedby={field.describedBy}
			aria-invalid={field.invalid || undefined}
			data-ui="textarea"
			data-autosize={autosize ? '' : undefined}
			data-max-rows={autosize && maxRows ? '' : undefined}
			data-invalid={field.invalid ? '' : undefined}
			className={cn(className)}
			style={{ ...rows, ...style }}
			onInput={(event) => {
				if (autosize) fit(event.currentTarget);

				onInput?.(event);
			}}
			{...props}
		/>
	);
}
