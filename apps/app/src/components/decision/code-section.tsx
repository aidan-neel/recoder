'use client';

import { Button, Skeleton } from '@recoder/ui';
import { useMemo } from 'react';

import { excerpt } from '@/lib/review/excerpt';
import { isNewFile } from '@/lib/review/files';
import { isRunning, useReview } from '@/lib/review/review-store';

import { CodeExcerpt } from './code-frame';
import { DetailSection } from './detail-parts';

interface CodeSectionProps {
	file: string;
	line: number | null;
	endLine: number | null;
	side: 'old' | 'new';
	/** Lines shown either side of the range. */
	radius: number;
	/** Offer "Open file" in the header. */
	openable?: boolean;
}

/**
 * The "Code" part of a detail: the lines around what an item points at. While
 * a live review is still computing its diff, a placeholder holds the place.
 */
export function CodeSection({ file, line, endLine, side, radius, openable = false }: CodeSectionProps) {
	const diff = useReview((state) => state.files.find((item) => item.path === file) ?? null);
	const waiting = useReview((state) => state.files.length === 0 && isRunning(state.review));
	const code = useMemo(() => diff && excerpt(diff, line, endLine, side, radius), [diff, line, endLine, side, radius]);

	if (waiting) {
		return (
			<DetailSection title="Code">
				<Skeleton className="h-[220px] rounded-[10px]" />
			</DetailSection>
		);
	}

	if (!diff || !code || code.lines.length === 0) return null;

	return (
		<DetailSection title="Code">
			<CodeExcerpt
				path={file}
				fresh={isNewFile(diff)}
				lines={code.lines}
				above={code.above}
				below={code.below}
				aside={
					openable ? (
						<Button
							variant="ghost"
							className="h-6 px-2 text-[12px]"
							onClick={() => useReview.getState().select({ kind: 'file', path: file })}
						>
							Open file
						</Button>
					) : null
				}
			/>
		</DetailSection>
	);
}
