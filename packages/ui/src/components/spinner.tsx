import { cn } from '../lib/cn';

interface SpinnerProps {
	size?: number;
	className?: string;
	label?: string;
}

/** A thin ring that turns at `--dur-spinner`. Spinners keep turning under reduced motion. */
export function Spinner({ size = 14, className, label }: SpinnerProps) {
	return (
		<svg
			data-ui="spinner"
			viewBox="0 0 16 16"
			width={size}
			height={size}
			fill="none"
			role={label ? 'status' : undefined}
			aria-label={label}
			aria-hidden={label ? undefined : true}
			className={cn('shrink-0 animate-spin [animation-duration:var(--dur-spinner)]', className)}
		>
			<circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeOpacity="0.22" strokeWidth="1.5" />
			<path d="M14.25 8A6.25 6.25 0 0 0 8 1.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
		</svg>
	);
}
