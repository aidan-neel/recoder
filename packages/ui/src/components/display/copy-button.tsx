'use client';

import { Copy } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Button, type ButtonSize, type ButtonStatus, type ButtonVariant } from '../button';
import { writeClipboard } from './clipboard';

/** How long the copied or failed face stays before the button returns to idle. */
const RESET_MS = 2000;

interface CopyButtonProps {
	/** The text to copy. */
	value: string;
	label?: ReactNode;
	copiedLabel?: ReactNode;
	/** The label when the browser refuses to copy. */
	failedLabel?: ReactNode;
	variant?: ButtonVariant;
	/** Defaults to `icon` when `iconOnly`, else `md`. */
	size?: ButtonSize;
	/** Show only the icon; the label becomes the accessible name. */
	iconOnly?: boolean;
	className?: string;
}

/** A plain-text name for a label, for `aria-label` and the live announcement. */
function textOf(label: ReactNode, fallback: string): string {
	return typeof label === 'string' ? label : fallback;
}

/**
 * Copies `value` and confirms in place: the copy icon crossfades to a green
 * check (or a red cross when the copy fails) with its label, then returns to
 * idle after two seconds. The button keeps its widest face's width. `Button`
 * announces the labelled faces; an icon-only copy has no face text, so it
 * announces its result through its own status region.
 */
export function CopyButton({
	value,
	label = 'Copy',
	copiedLabel = 'Copied',
	failedLabel = 'Failed',
	variant = 'ghost',
	size,
	iconOnly = false,
	className
}: CopyButtonProps) {
	const [status, setStatus] = useState<ButtonStatus>('idle');
	const timer = useRef(0);

	useEffect(() => () => window.clearTimeout(timer.current), []);

	async function copy() {
		window.clearTimeout(timer.current);

		try {
			await writeClipboard(value);
			setStatus('success');
		} catch {
			setStatus('error');
		}

		timer.current = window.setTimeout(() => setStatus('idle'), RESET_MS);
	}

	const names = {
		idle: textOf(label, 'Copy'),
		pending: textOf(label, 'Copy'),
		success: textOf(copiedLabel, 'Copied'),
		error: textOf(failedLabel, 'Failed')
	};

	return (
		<>
			<Button
				data-copy=""
				variant={variant}
				size={size ?? (iconOnly ? 'icon' : 'md')}
				status={status}
				successLabel={iconOnly ? null : copiedLabel}
				errorLabel={iconOnly ? null : failedLabel}
				aria-label={iconOnly ? names[status] : undefined}
				className={className}
				onClick={copy}
			>
				<Copy />
				{iconOnly ? null : label}
			</Button>
			{iconOnly ? (
				<span role="status" className="sr-only">
					{status === 'idle' ? '' : names[status]}
				</span>
			) : null}
		</>
	);
}
