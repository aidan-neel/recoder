'use client';

import { FileChip, HoverList, RowButton, StatusGlyph } from '@recoder/ui';
import type { ReactNode } from 'react';

import { chapterNumber, type Chapter } from '@/lib/changes/chapters';
import { useDiffGuide } from '@/lib/changes/use-changes';
import { useRunView } from '@/lib/run/use-run';
import { plural } from '@/lib/shell/format';

interface ChapterSectionProps {
	chapter: Chapter;
	/** The chapter's hunk cards. */
	children: ReactNode;
}

/** One chapter of the guide in the diff: its number and title, why its hunks belong together, then the hunks. */
export function ChapterSection({ chapter, children }: ChapterSectionProps) {
	return (
		<section className="chapter changes-stack" data-chapter={chapter.id} aria-label={chapter.title}>
			<div className="chapter-head">
				<span className="chapter-number">{chapterNumber(chapter.number)}</span>
				<div className="chapter-text">
					<h2 className="chapter-title">{chapter.title}</h2>
					{chapter.explanation ? <p className="chapter-why">{chapter.explanation}</p> : null}
				</div>
			</div>
			{children}
		</section>
	);
}

/**
 * Where the guide stands: refining while the review still writes it, refined once the model reordered it. A guide
 * from the diff's structure alone, once the review is done, says nothing.
 */
function GuideStatus() {
	const guide = useDiffGuide();
	const run = useRunView();
	const busy = run.phase === 'running' || run.phase === 'queued';

	if (guide?.source === 'model') {
		return (
			<span className="chapter-outline-status">
				<StatusGlyph kind="ok" label="Refined" />
				Refined
			</span>
		);
	}

	if (!busy) return null;

	return (
		<span className="chapter-outline-status" role="status">
			<StatusGlyph kind="spinner" label="Refining" />
			Refining
		</span>
	);
}

interface ChapterOutlineProps {
	chapters: Chapter[];
	/** Narrows the hunks to those whose path holds it. */
	query: string;
	/** The id of the hunk being read. */
	current: string | null;
	onOpen: (hunkId: string) => void;
}

/** The chapters narrowed to the hunks whose path holds `query`, dropping a chapter left with none. */
export function outlineMatches(chapters: Chapter[], query: string): Chapter[] {
	const needle = query.trim().toLowerCase();

	if (!needle) return chapters;

	return chapters
		.map((chapter) => ({ ...chapter, hunks: chapter.hunks.filter((hunk) => hunk.path.toLowerCase().includes(needle)) }))
		.filter((chapter) => chapter.hunks.length > 0);
}

/**
 * The guide's outline in the file sidebar: how many chapters and hunks, each chapter by number and title with its
 * hunks under it, the file and the line each starts on. The chapter being read is marked as the diff scrolls, and
 * pressing a chapter or a hunk brings it to the top.
 */
export function ChapterOutline({ chapters, query, current, onOpen }: ChapterOutlineProps) {
	const shown = outlineMatches(chapters, query);
	const hunks = chapters.reduce((total, chapter) => total + chapter.hunks.length, 0);

	return (
		<nav className="chapter-outline" aria-label="Chapters">
			<div className="chapter-outline-head">
				<span className="meta">
					{plural(chapters.length, 'chapter')} · {plural(hunks, 'hunk')}
				</span>
				<GuideStatus />
			</div>
			{shown.length === 0 ? <p className="changes-filter-empty">No file matches.</p> : null}
			<HoverList as="ol" className="chapter-list" itemSelector="[data-outline-row]" selectedSelector="[data-current]">
				{shown.map((chapter) => (
					<li key={chapter.id} className="chapter-entry">
						<RowButton
							data-outline-row
							data-current={chapter.hunks.some((hunk) => hunk.id === current) || undefined}
							className="chapter-row"
							onClick={() => onOpen(chapter.hunks[0].id)}
						>
							<span className="chapter-number">{chapterNumber(chapter.number)}</span>
							<span className="chapter-row-title">{chapter.title}</span>
						</RowButton>
						<ol className="chapter-hunks">
							{chapter.hunks.map((hunk) => (
								<li key={hunk.id}>
									<RowButton
										data-outline-row
										aria-current={hunk.id === current ? 'location' : undefined}
										className="chapter-hunk-row"
										onClick={() => onOpen(hunk.id)}
									>
										<FileChip path={hunk.path} line={hunk.moved ? null : hunk.line} />
										{hunk.moved ? <span className="meta">moved</span> : null}
										{hunk.index === null ? <span className="meta">renamed</span> : null}
									</RowButton>
								</li>
							))}
						</ol>
					</li>
				))}
			</HoverList>
		</nav>
	);
}
