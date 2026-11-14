'use client';

import { cn } from '../../lib/cn';
import { Tooltip } from '../overlay/tooltip';
import { ChartTip } from './chart-tip';
import { formatShare } from './chart-math';

/** One part of a whole, in the bar and in the legend under it. */
export interface BarSegment {
	id: string;
	label: string;
	value: number;
	/** Any CSS color; a token such as `var(--chart-1)` follows the theme. */
	color: string;
}

interface StackedBarProps {
	segments: readonly BarSegment[];
	/** How the legend and each segment's tooltip write a value. */
	formatValue: (value: number) => string;
	'aria-label': string;
	className?: string;
}

/**
 * One thin bar split in proportion to its segments, with a legend of square
 * swatches and values under it. Hovering or focusing a segment names it with
 * its value and share. A segment of nothing is in the legend only.
 */
export function StackedBar({ segments, formatValue, 'aria-label': label, className }: StackedBarProps) {
	const total = segments.reduce((sum, segment) => sum + segment.value, 0);

	return (
		<div data-ui="stacked-bar" className={cn(className)}>
			<div data-part="track" role="group" aria-label={label}>
				{segments
					.filter((segment) => segment.value > 0)
					.map((segment) => (
						<Tooltip
							key={segment.id}
							side="top"
							content={
								<ChartTip
									heading={segment.label}
									value={formatValue(segment.value)}
									rows={[{ id: 'share', label: 'Share', value: formatShare(segment.value / total) }]}
								/>
							}
						>
							<span
								data-part="segment"
								tabIndex={0}
								aria-label={`${segment.label}, ${formatValue(segment.value)}, ${formatShare(segment.value / total)}`}
								style={{ flexGrow: segment.value, background: segment.color }}
							/>
						</Tooltip>
					))}
			</div>
			<ul data-part="legend">
				{segments.map((segment) => (
					<li key={segment.id}>
						<span data-part="swatch" style={{ background: segment.color }} />
						<span data-part="label">{segment.label}</span>
						<span data-part="value">{formatValue(segment.value)}</span>
					</li>
				))}
			</ul>
		</div>
	);
}
