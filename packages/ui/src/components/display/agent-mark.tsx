import { SquareTerminal } from 'lucide-react';
import { useId } from 'react';

import { cn } from '../../lib/cn';
import { AGENT_MARKS, type AgentMarkSpec } from './agent-paths';

interface AgentMarkProps {
	/** The server's agent id: `claude-code`, `codex`, `opencode`… */
	agent: string;
	/** What a screen reader hears; leave it out where the CLI's name is beside the mark. */
	label?: string;
	className?: string;
}

/** Renders the interior SVG elements for a multi-tone, gradient, or masked-mesh brand mark. */
function MarkContent({ spec, uid }: { spec: AgentMarkSpec; uid: string }) {
	if (spec.kind === 'paths') {
		return (
			<>
				{spec.paths.map((path, index) => (
					<path key={index} d={path.d} fill={path.fill} />
				))}
			</>
		);
	}

	if (spec.kind === 'gradient') {
		const gradId = `${uid}-grad`;

		return (
			<>
				<path d={spec.d} fill={`url(#${gradId})`} />
				<defs>
					<linearGradient id={gradId} x1="12" x2="12" y1="0" y2="24" gradientUnits="userSpaceOnUse">
						{spec.stops.map((stop, index) => (
							<stop key={index} offset={stop.offset} stopColor={stop.color} />
						))}
					</linearGradient>
				</defs>
			</>
		);
	}

	const maskId = `${uid}-mask`;

	return (
		<>
			<mask id={maskId} maskUnits="userSpaceOnUse" x={-2} y={0} width={28} height={25}>
				<path d={spec.mask} fill="#ffffff" />
			</mask>
			<g mask={`url(#${maskId})`}>
				{spec.blobs.map((blob, index) => (
					<g key={index} filter={`url(#${uid}-f${index})`}>
						<path d={blob.d} fill={blob.fill} />
					</g>
				))}
			</g>
			<defs>
				{spec.blobs.map((blob, index) => (
					<filter
						key={index}
						id={`${uid}-f${index}`}
						x={blob.x}
						y={blob.y}
						width={blob.width}
						height={blob.height}
						filterUnits="userSpaceOnUse"
						colorInterpolationFilters="sRGB"
					>
						<feFlood floodOpacity={0} result="BackgroundImageFix" />
						<feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
						<feGaussianBlur stdDeviation={blob.stdDeviation} />
					</filter>
				))}
			</defs>
		</>
	);
}

/**
 * An agent CLI's brand mark in its real colors, or a terminal for a CLI
 * without one, such as a custom command. 16px unless sized.
 */
export function AgentMark({ agent, label, className }: AgentMarkProps) {
	const uid = useId();
	const spec = AGENT_MARKS[agent];
	const classes = cn('size-4 shrink-0', className);
	const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true };

	if (!spec) return <SquareTerminal data-ui="agent-mark" className={classes} {...a11y} />;

	return (
		<svg
			viewBox={spec.viewBox}
			fill="none"
			fillRule="evenodd"
			data-ui="agent-mark"
			data-agent={agent}
			className={classes}
			{...a11y}
		>
			<MarkContent spec={spec} uid={uid} />
		</svg>
	);
}
