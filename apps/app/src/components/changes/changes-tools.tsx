'use client';

import { Button, Meter, SegmentedControl, StatusGlyph, Tooltip } from '@recoder/ui';
import {
	ArrowDownIcon,
	ArrowsInLineVerticalIcon,
	ArrowsOutLineVerticalIcon,
	ArrowUpIcon,
	ColumnsIcon,
	ListIcon,
	ParagraphIcon,
	RowsIcon,
	TreeViewIcon
} from '@phosphor-icons/react';
import { useMemo, useState } from 'react';

import { useBugsView } from '@/lib/bugs/use-bugs';
import { useDiffView } from '@/lib/changes/diff-view';
import { readingOrder } from '@/lib/changes/places';
import { useSideOpen } from '@/lib/changes/side-open';
import { useChangesNav, useFileTree, useGuide, useViewedFiles } from '@/lib/changes/use-changes';
import { useSessionData } from '@/lib/pull/pull-session';
import { useKeys } from '@/lib/shell/use-keys';

import { FyiToggle } from '@/components/bugs/fyi-toggle';

import { FilesMenu } from './files-menu';
import { partsWithRest } from './guide';

/** How the Changes tab orders the diff: the file tree's order, or the review's reading order. */
export type ChangesMode = 'files' | 'guide';

const MODES = [
	{ value: 'files', label: 'Files' },
	{ value: 'guide', label: 'Guide' }
];

const LAYOUTS = [
	{ value: 'unified', label: <span className="changes-tool-label">Unified</span>, icon: <RowsIcon aria-hidden /> },
	{ value: 'split', label: <span className="changes-tool-label">Split</span>, icon: <ColumnsIcon aria-hidden /> }
];

interface ChangesToolsProps {
	mode: ChangesMode;
	onModeChange: (mode: ChangesMode) => void;
}

/**
 * The Changes tab's tools in the tab row: showing or hiding the file sidebar,
 * the file menu (`t`) where the sidebar is not, a stepper
 * through the open findings in reading order (`n` and `p`), how far
 * through the files you are, the diff's layout (unified or split) and whether
 * whitespace-only changes show, the order to read them in, and collapse or
 * expand every file.
 */
export function ChangesTools({ mode, onModeChange }: ChangesToolsProps) {
	const viewed = useViewedFiles();
	const tree = useFileTree();
	const guide = useGuide();
	const bugs = useBugsView();
	const nav = useChangesNav();
	const target = useSessionData((data) => data.changesTarget);
	const current = useSessionData((data) => data.changesCurrent);
	const fold = useSessionData((data) => data.changesFold);
	const [menuOpen, setMenuOpen] = useState(false);
	const side = useSideOpen();
	const diffView = useDiffView();
	const findings = useMemo(() => readingOrder(bugs.open, tree.order), [bugs.open, tree.order]);
	const at = target?.findingId ? findings.findIndex((bug) => bug.id === target.findingId) : -1;
	const shut = fold?.open === false;
	const guided = mode === 'guide' && guide.length > 0;

	/** Goes to the finding `by` places on from the one last gone to, wrapping; the first or last when none was. */
	function stepFinding(by: 1 | -1): false | void {
		if (findings.length === 0) return false;

		const from = at === -1 ? (by === 1 ? -1 : 0) : at;
		const next = findings[(from + by + findings.length) % findings.length];

		nav.goTo(next.file, null, next.id);
	}

	/** `t`: focuses the sidebar's filter where the sidebar shows, else opens the file menu. */
	function goToFile(): false | void {
		if (viewed.total === 0) return false;

		const filter = document.querySelector<HTMLInputElement>('.changes-filter input');

		if (filter && filter.offsetParent !== null) filter.focus();
		else setMenuOpen(true);
	}

	useKeys({
		t: goToFile,
		n: () => stepFinding(1),
		p: () => stepFinding(-1)
	});

	return (
		<>
			{viewed.total > 0 ? (
				<Tooltip content={side.open ? 'Hide the file sidebar' : 'Show the file sidebar'}>
					<Button
						variant="quiet"
						size="icon"
						className="changes-side-toggle"
						aria-label={side.open ? 'Hide the file sidebar' : 'Show the file sidebar'}
						aria-pressed={side.open}
						onClick={side.toggle}
					>
						<TreeViewIcon aria-hidden />
					</Button>
				</Tooltip>
			) : null}
			{viewed.total > 0 ? (
				<Tooltip content="Go to a file" shortcut="t">
					<Button
						variant="quiet"
						size="sm"
						className="changes-files"
						data-beside={side.open || undefined}
						onClick={() => setMenuOpen(true)}
					>
						<ListIcon aria-hidden />
						Files
						<span className="meta tabular">{viewed.total}</span>
					</Button>
				</Tooltip>
			) : null}
			{findings.length > 0 ? (
				<div className="changes-findings" role="group" aria-label="Findings in the diff">
					<span className="changes-findings-label">
						<StatusGlyph kind={(findings[at] ?? findings[0]).tone} label={(findings[at] ?? findings[0]).tierLabel} />
						Findings
						<span className="meta tabular">{at === -1 ? findings.length : `${at + 1}/${findings.length}`}</span>
					</span>
					<Tooltip content="Previous finding" shortcut="p">
						<Button variant="quiet" size="icon" aria-label="Previous finding" onClick={() => stepFinding(-1)}>
							<ArrowUpIcon aria-hidden />
						</Button>
					</Tooltip>
					<Tooltip content="Next finding" shortcut="n">
						<Button variant="quiet" size="icon" aria-label="Next finding" onClick={() => stepFinding(1)}>
							<ArrowDownIcon aria-hidden />
						</Button>
					</Tooltip>
				</div>
			) : null}
			<FyiToggle count={bugs.fyi.length} />
			{viewed.total > 0 ? (
				<span className="changes-viewed">
					<span className="meta tabular">
						{viewed.count} of {viewed.total} viewed
					</span>
					<Meter value={viewed.count} max={viewed.total} tone="ok" aria-label="Files viewed" />
				</span>
			) : null}
			<SegmentedControl
				size="sm"
				aria-label="Layout of the diff"
				value={diffView.layout}
				onValueChange={(value) => diffView.setLayout(value === 'split' ? 'split' : 'unified')}
				options={LAYOUTS}
			/>
			<Tooltip content="Hide whitespace">
				<Button
					variant="quiet"
					size="sm"
					className="changes-whitespace"
					aria-pressed={diffView.hideWhitespace}
					onClick={diffView.toggleWhitespace}
				>
					<ParagraphIcon aria-hidden />
					<span className="changes-tool-label">Hide whitespace</span>
				</Button>
			</Tooltip>
			<SegmentedControl
				size="sm"
				aria-label="Order of the diff"
				value={mode}
				onValueChange={(value) => onModeChange(value === 'guide' ? 'guide' : 'files')}
				options={MODES}
			/>
			{viewed.total > 0 ? (
				<Tooltip content={shut ? 'Expand every file' : 'Collapse every file'}>
					<Button
						variant="quiet"
						size="icon"
						className="changes-fold"
						aria-label={shut ? 'Expand every file' : 'Collapse every file'}
						onClick={() => nav.foldAll(shut)}
					>
						{shut ? <ArrowsOutLineVerticalIcon aria-hidden /> : <ArrowsInLineVerticalIcon aria-hidden />}
					</Button>
				</Tooltip>
			) : null}
			<FilesMenu
				open={menuOpen}
				onOpenChange={setMenuOpen}
				groups={tree.groups}
				parts={guided ? partsWithRest(guide, tree.order) : null}
				current={current}
				onOpen={(path) => nav.goTo(path)}
			/>
		</>
	);
}
