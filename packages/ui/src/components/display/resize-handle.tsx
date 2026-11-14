'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

import { cn } from '../../lib/cn';
import { clampWidth, draggedWidth, keyWidth, rootScale } from './resize-math';

interface ResizeHandleProps {
	/** Names the panel the handle resizes, for assistive tech. */
	label: string;
	/** The panel's width in CSS px at the base font scale. */
	width: number;
	min: number;
	max: number;
	/** The width a double click restores. */
	defaultWidth: number;
	/** How far an arrow key moves the width, in CSS px. */
	step?: number;
	/** Called with every width the pointer or a key asks for, so the panel follows live. */
	onResize: (width: number) => void;
	/** Called once a drag, key press or reset settles on a width: the place to save it. */
	onResizeEnd: (width: number) => void;
	className?: string;
}

/** A drag in progress: where the pointer and the panel started, and the width last reported. */
interface Drag {
	pointerId: number;
	startX: number;
	startWidth: number;
	scale: number;
	width: number;
}

/**
 * The drag handle on a panel's right edge: a thin hit area inside the edge of
 * the nearest positioned ancestor, with a line that shows on hover, focus and
 * drag. It owns no width. The caller holds it, applies each `onResize` value
 * and saves the `onResizeEnd` one. Widths are CSS px at the base font scale, so
 * a drag turns screen px into them through the root font size. Arrow keys step,
 * Home and End go to the ends and a double click restores `defaultWidth`.
 */
export function ResizeHandle({
	label,
	width,
	min,
	max,
	defaultWidth,
	step = 16,
	onResize,
	onResizeEnd,
	className
}: ResizeHandleProps) {
	const drag = useRef<Drag | null>(null);
	const [dragging, setDragging] = useState(false);
	const range = { min, max };

	useEffect(() => endCursorLock, []);

	function startDrag(event: PointerEvent<HTMLDivElement>): void {
		const panel = event.currentTarget.parentElement;

		if (event.button !== 0 || !panel) return;

		event.preventDefault();

		const scale = rootScale();
		const startWidth = clampWidth(panel.getBoundingClientRect().width / scale, range);

		event.currentTarget.setPointerCapture(event.pointerId);
		drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth, scale, width: startWidth };
		document.documentElement.dataset.resizing = '';
		setDragging(true);
	}

	function moveDrag(event: PointerEvent<HTMLDivElement>): void {
		const current = drag.current;

		if (current?.pointerId !== event.pointerId) return;

		const next = draggedWidth(current.startWidth, event.clientX - current.startX, current.scale, range);

		if (next === current.width) return;

		current.width = next;
		onResize(next);
	}

	function finishDrag(event: PointerEvent<HTMLDivElement>): void {
		const current = drag.current;

		if (current?.pointerId !== event.pointerId) return;

		drag.current = null;
		endCursorLock();
		setDragging(false);
		onResizeEnd(current.width);
	}

	function pressKey(event: KeyboardEvent<HTMLDivElement>): void {
		const next = keyWidth(event.key, width, range, step);

		if (next === null) return;

		event.preventDefault();
		onResize(next);
		onResizeEnd(next);
	}

	function reset(): void {
		onResize(defaultWidth);
		onResizeEnd(defaultWidth);
	}

	return (
		<div
			role="separator"
			aria-orientation="vertical"
			aria-label={label}
			aria-valuenow={Math.round(width)}
			aria-valuemin={min}
			aria-valuemax={max}
			tabIndex={0}
			data-ui="resize-handle"
			data-dragging={dragging ? '' : undefined}
			className={cn(className)}
			onPointerDown={startDrag}
			onPointerMove={moveDrag}
			onPointerUp={finishDrag}
			onPointerCancel={finishDrag}
			onKeyDown={pressKey}
			onDoubleClick={reset}
		/>
	);
}

/** Lifts the page-wide col-resize cursor and the text-selection lock that a drag sets. */
function endCursorLock(): void {
	delete document.documentElement.dataset.resizing;
}
