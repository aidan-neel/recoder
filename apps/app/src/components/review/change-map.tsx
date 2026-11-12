'use client';

import { cn } from '@recoder/ui';
import { useRef, useState } from 'react';

import type { FileClass } from '@/lib/review/files';
import { CLASS_LABEL } from '@/lib/review/labels';
import type { Attention } from '@/lib/review/surface';

import { useSegmentMove } from './segment-move';

const SEGMENTS: { cls: FileClass; note: string }[] = [
	{ cls: 'read', note: 'Hunks with an open decision, or no reviewer' },
	{ cls: 'checked', note: 'Examined by reviewers, nothing open' },
	{ cls: 'tests', note: 'Test code: evidence, not behavior' },
	{ cls: 'skim', note: 'Lockfiles, docs, generated output' }
];

interface ChangeMapProps {
	attention: Attention;
	/** Draw the legend under the bar. */
	legend?: boolean;
	className?: string;
}

/**
 * Every changed line in one bar, split into Read, Checked, Tests and Skim.
 * Deciding an item moves its lines from Read to Checked, so the segments
 * ease to their new widths. Hovering a legend key dims the other segments.
 */
export function ChangeMap({ attention, legend = true, className }: ChangeMapProps) {
	const [focus, setFocus] = useState<FileClass | null>(null);
	const bar = useRef<HTMLDivElement>(null);

	useSegmentMove(bar, SEGMENTS.map(({ cls }) => attention[cls]).join(','));

	return (
		<div data-ui="change-map" className={cn('change-map', className)}>
			<div
				ref={bar}
				className="change-bar"
				role="img"
				aria-label={`${attention.read} of ${attention.total} changed lines need reading`}
			>
				{SEGMENTS.map(({ cls }) => (
					<span
						key={cls}
						className="change-seg"
						data-cls={cls}
						data-dim={focus !== null && focus !== cls}
						data-empty={attention[cls] === 0}
						style={{ flexGrow: attention[cls] }}
					/>
				))}
			</div>
			{legend ? (
				<ul className="change-legend">
					{SEGMENTS.map(({ cls, note }) => (
						<li
							key={cls}
							className="change-key"
							data-cls={cls}
							data-empty={attention[cls] === 0}
							title={note}
							onPointerEnter={() => setFocus(cls)}
							onPointerLeave={() => setFocus(null)}
						>
							<span className="change-swatch" aria-hidden />
							{CLASS_LABEL[cls]}
							<span className="change-count mono tabular">{attention[cls]}</span>
						</li>
					))}
				</ul>
			) : null}
		</div>
	);
}
