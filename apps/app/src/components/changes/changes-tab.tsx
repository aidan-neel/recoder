'use client';

import type { FileDiff } from '@recoder/shared';
import { Button, Skeleton, StatusNotice } from '@recoder/ui';
import { useMemo, useRef } from 'react';

import { useApi } from '@/lib/api/client';
import type { BugView } from '@/lib/bugs/types';
import { useBugsView } from '@/lib/bugs/use-bugs';
import { LOADING_DIFF } from '@/lib/changes/loading-diff';
import type { GuidePart } from '@/lib/changes/types';
import { useFileTree, useGuide, useViewedFiles } from '@/lib/changes/use-changes';
import { scrollToFile, useCurrentFile } from '@/lib/changes/use-current-file';
import { usePullDiffView } from '@/lib/pull/pull-session';
import { useRunView } from '@/lib/run/use-run';
import { pullHref } from '@/lib/shell/routes';
import { useAfterPaint } from '@/lib/shell/use-after-paint';
import { useKeys } from '@/lib/shell/use-keys';

import { PanelResizer } from '@/components/common/panel-resizer';

import type { ChangesMode } from './changes-tools';
import { FileCard } from './file-card';
import { FileTree } from './file-tree';
import { GuidePartSection, GuideSide, partsWithRest } from './guide';

/** No bugs: one shared empty list, so a file with none never re-renders for another file's bugs. */
const NO_BUGS: BugView[] = [];

interface ChangesTabProps {
	repoId: string;
	number: number;
	mode: ChangesMode;
}

/** The open bugs of each file. */
function bugsByFile(bugs: BugView[]): Map<string, BugView[]> {
	const byFile = new Map<string, BugView[]>();

	for (const bug of bugs) byFile.set(bug.file, [...(byFile.get(bug.file) ?? []), bug]);

	return byFile;
}

/** The files in `order`, leaving out a path the diff does not hold. */
function inOrder(files: FileDiff[], order: string[]): FileDiff[] {
	const byPath = new Map(files.map((file) => [file.path, file]));

	return order.flatMap((path) => byPath.get(path) ?? []);
}

function ignore(): void {}

/**
 * Stand-in file cards while the diff loads: the skeleton is measured from them, header and lines of code. They
 * mount a frame after the tab does, so the click that opened the page paints without their cost.
 */
function DiffSkeleton() {
	return (
		<Skeleton loading>
			<div className="changes-stack">
				{LOADING_DIFF.map((file) => (
					<FileCard key={file.path} file={file} viewed={false} onToggleViewed={ignore} bugs={NO_BUGS} bugsHref="#" />
				))}
			</div>
		</Skeleton>
	);
}

/**
 * The Changes tab: the file tree beside every changed file's diff, under one
 * line that says where the review stands. In guide order the diff is grouped
 * into the parts the review planned. `j` and `k` step through the files and
 * `v` marks the one being read as viewed.
 */
export function ChangesTab({ repoId, number, mode }: ChangesTabProps) {
	const { base } = useApi();
	const diff = usePullDiffView();
	const tree = useFileTree();
	const viewed = useViewedFiles();
	const guide = useGuide();
	const run = useRunView();
	const bugs = useBugsView();
	const scroller = useRef<HTMLDivElement | null>(null);
	const painted = useAfterPaint();
	const files = diff.phase === 'ready' ? diff.value.files : null;
	const current = useCurrentFile(scroller, files);
	const byFile = useMemo(() => bugsByFile(bugs.open), [bugs.open]);
	const ordered = useMemo(() => inOrder(files ?? [], tree.order), [files, tree.order]);
	const parts = useMemo(() => partsWithRest(guide, files ?? []), [guide, files]);
	const bugsHref = pullHref(base, repoId, number, 'review');
	const guided = mode === 'guide' && guide.length > 0;

	/** Scrolls the diff to the file `by` places from the one being read. */
	function step(by: 1 | -1): void {
		const at = current ? tree.order.indexOf(current) : -1;
		const next = tree.order[Math.min(tree.order.length - 1, Math.max(0, at + by))];

		if (next) scrollToFile(scroller.current, next);
	}

	useKeys({
		j: () => step(1),
		k: () => step(-1),
		v: () => (current ? viewed.toggle(current) : false)
	});

	/** One file's card. */
	function card(file: FileDiff) {
		return (
			<FileCard
				key={file.path}
				file={file}
				viewed={viewed.isViewed(file.path)}
				onToggleViewed={viewed.toggle}
				bugs={byFile.get(file.path) ?? NO_BUGS}
				bugsHref={bugsHref}
			/>
		);
	}

	/** The cards of a guide part, in the part's own order. */
	function partCards(part: GuidePart) {
		return inOrder(files ?? [], part.paths).map(card);
	}

	return (
		<div className="changes">
			<aside className="changes-side" aria-label="Changed files">
				{guided ? (
					<GuideSide
						parts={parts}
						onOpenPart={(part) => part.paths[0] && scrollToFile(scroller.current, part.paths[0])}
					/>
				) : (
					<FileTree
						tree={tree}
						loading={diff.phase === 'loading'}
						current={current}
						onOpenFile={(path) => scrollToFile(scroller.current, path)}
					/>
				)}
				<PanelResizer panel="changes" label="Resize file tree" />
			</aside>
			<div ref={scroller} className="changes-main">
				<div className="changes-stack">
					{mode === 'guide' && guide.length === 0 ? (
						<div className="strip" data-tone="neutral" role="status">
							<span className="strip-text">
								{run.phase === 'passed'
									? 'This review kept no guide. A guide groups the files in the order to read them.'
									: 'The guide comes with a review: it groups the files in the order to read them.'}
							</span>
						</div>
					) : null}
					{diff.phase === 'loading' && painted ? <DiffSkeleton /> : null}
					{diff.phase === 'failed' ? (
						<div className="page-notice">
							<StatusNotice
								tone="danger"
								title="The diff did not load."
								detail={diff.error}
								actions={<Button onClick={diff.retry}>Try again</Button>}
							/>
						</div>
					) : null}
					{files && files.length === 0 ? (
						<div className="page-notice">
							<StatusNotice title="This pull request changes no files." />
						</div>
					) : null}
					{guided
						? parts.map((part, index) => (
								<GuidePartSection key={part.id} part={part} position={index + 1}>
									{partCards(part)}
								</GuidePartSection>
							))
						: ordered.map(card)}
				</div>
			</div>
		</div>
	);
}
