'use client';

import type { FileDiff } from '@recoder/shared';
import { HoverList, Pill } from '@recoder/ui';
import type { ReactNode } from 'react';

import type { GuidePart } from '@/lib/changes/types';
import { plural } from '@/lib/shell/format';

/** The part that holds the files the review's plan left out, so no file is lost in the guide. */
const REST_ID = 'rest';

/** The guide's parts, with one more at the end for the files none of them names. */
export function partsWithRest(parts: GuidePart[], files: FileDiff[]): GuidePart[] {
	const named = new Set(parts.flatMap((part) => part.paths));
	const rest = files.map((file) => file.path).filter((path) => !named.has(path));

	if (rest.length === 0) return parts;

	return [
		...parts,
		{ id: REST_ID, title: 'Everything else', reason: 'Files the review did not group.', paths: rest, bugs: 0 }
	];
}

interface GuideSideProps {
	parts: GuidePart[];
	onOpenPart: (part: GuidePart) => void;
}

/** The guide beside the diff: the parts in reading order. A click scrolls to the part's first file. */
export function GuideSide({ parts, onOpenPart }: GuideSideProps) {
	return (
		<HoverList as="ol" className="tree" itemSelector="[data-tree-row]">
			{parts.map((part, index) => (
				<li key={part.id}>
					<button type="button" data-tree-row className="tree-row guide-row" onClick={() => onOpenPart(part)}>
						<span className="guide-number">{index + 1}</span>
						<span className="tree-name">{part.title}</span>
						<span className="tree-end">
							{part.bugs > 0 ? <span className="tree-bug" role="img" aria-label={`${part.bugs} open bugs`} /> : null}
							{part.paths.length}
						</span>
					</button>
				</li>
			))}
		</HoverList>
	);
}

interface GuidePartSectionProps {
	part: GuidePart;
	/** The part's place in the reading order, from 1. */
	position: number;
	/** The part's file cards. */
	children: ReactNode;
}

/** One part of the guide in the diff: what it is about and why its files belong together, then the files. */
export function GuidePartSection({ part, position, children }: GuidePartSectionProps) {
	return (
		<section className="guide-part changes-stack" aria-label={part.title}>
			<div className="guide-part-head">
				<span className="guide-number">{position}</span>
				<div className="guide-part-text">
					<h2 className="guide-part-title">{part.title}</h2>
					<p className="guide-part-reason">{part.reason}</p>
				</div>
				{part.bugs > 0 ? <Pill tone="high">{plural(part.bugs, 'bug')}</Pill> : null}
				<span className="meta">{plural(part.paths.length, 'file')}</span>
			</div>
			{children}
		</section>
	);
}
