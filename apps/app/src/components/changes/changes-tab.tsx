'use client';

import type { FileDiff } from '@recoder/shared';
import { Button, Skeleton, StatusNotice } from '@recoder/ui';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';

import { useApi } from '@/lib/api/client';
import type { BugView } from '@/lib/bugs/types';
import { useShowFyi } from '@/lib/bugs/show-fyi';
import { useBugsView } from '@/lib/bugs/use-bugs';
import { useDiffView } from '@/lib/changes/diff-view';
import { hunkBugs, hunkLines, hunkWhere, type Chapter } from '@/lib/changes/chapters';
import { LOADING_DIFF } from '@/lib/changes/loading-diff';
import { moveSpans, type MoveSpan } from '@/lib/changes/moves';
import { placeHash, readPlace } from '@/lib/changes/places';
import type { CardPart, ChangesTarget, GuidePart } from '@/lib/changes/types';
import { useChangesNav, useChapters, useFileTree, useGuide, useViewedFiles } from '@/lib/changes/use-changes';
import { useCurrentFile } from '@/lib/changes/use-current-file';
import { usePinnedHunk } from '@/lib/changes/use-pinned-hunk';
import { useSideOpen } from '@/lib/changes/side-open';
import { withoutWhitespace } from '@/lib/changes/whitespace';
import { usePullDiffView, useSession, useSessionData } from '@/lib/pull/pull-session';
import { useRunView } from '@/lib/run/use-run';
import { replaceAddress } from '@/lib/shell/navigation';
import { pullHref } from '@/lib/shell/routes';
import { useAfterPaint } from '@/lib/shell/use-after-paint';
import { useKeys } from '@/lib/shell/use-keys';

import { ChapterSection } from './chapters';
import type { ChangesMode } from './changes-tools';
import { FileCard } from './file-card';
import { FileSidebar } from './file-sidebar';
import { GuidePartSection, partsWithRest } from './guide';

/** No bugs: one shared empty list, so a file with none never re-renders for another file's bugs. */
const NO_BUGS: BugView[] = [];

/** No moved blocks, shared for the same reason. */
const NO_SPANS: MoveSpan[] = [];

/** How near the top the diff may be scrolled and still count as not yet read, in px: switching order stays there. */
const TOP_SLACK = 40;

/** How many frames a jump waits for its line or finding to be drawn before it settles for the file. */
const REVEAL_FRAMES = 60;

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

/** What one guide hunk's card shows: its file cut down to that hunk, the findings on it, and how it is named. */
interface HunkCard {
	file: FileDiff;
	bugs: BugView[];
	part: CardPart;
}

/** Each guide hunk's card by the hunk's id, built once per guide, diff and set of findings. */
function hunkCards(chapters: Chapter[], files: FileDiff[], byFile: Map<string, BugView[]>): Map<string, HunkCard> {
	const byPath = new Map(files.map((file) => [file.path, file]));

	return new Map(
		chapters.flatMap((chapter) =>
			chapter.hunks.flatMap((hunk): [string, HunkCard][] => {
				const file = byPath.get(hunk.path);
				const shown = hunk.index === null ? undefined : file?.hunks[hunk.index];

				if (!file || (hunk.index !== null && !shown)) return [];

				const part: CardPart = {
					id: hunk.id,
					lines: shown ? hunkLines(shown) : null,
					where: hunkWhere(hunk, file),
					explanation: hunk.explanation,
					moved: hunk.moved,
					note: hunk.note
				};

				return [
					[
						hunk.id,
						{
							file: { ...file, hunks: shown ? [shown] : [] },
							bugs: hunkBugs(byFile.get(file.path) ?? NO_BUGS, file, hunk),
							part
						}
					]
				];
			})
		)
	);
}

/** The files in `order`, leaving out a path the diff does not hold. */
function inOrder(files: FileDiff[], order: string[]): FileDiff[] {
	const byPath = new Map(files.map((file) => [file.path, file]));

	return order.flatMap((path) => byPath.get(path) ?? []);
}

function ignore(): void {}

/** The selector of what a jump brings into view: the finding, the marked line, or the file's card. */
function targetSelector(target: ChangesTarget): string {
	const file = `[data-file="${CSS.escape(target.path)}"]`;

	if (target.findingId) return `${file} [data-finding="${CSS.escape(target.findingId)}"]`;
	if (target.line !== null) return `${file} [data-${target.side}-line="${target.line}"]`;

	return file;
}

/** The shareable hash of a jump. */
function targetHash(target: ChangesTarget): string {
	return placeHash(
		target.findingId
			? { kind: 'finding', id: target.findingId }
			: { kind: 'file', path: target.path, line: target.line, side: target.side }
	);
}

/**
 * Brings what a jump names into view. The file's card goes to the top first, so its diff mounts; then each frame,
 * until it is drawn, it looks for the line or finding and centres it, once more a frame later as the cards above
 * it settle. A file alone stays at the top. `onDone` gets the element, or null when it never came.
 */
function reveal(host: HTMLElement, target: ChangesTarget, onDone: (element: HTMLElement | null) => void): () => void {
	const selector = targetSelector(target);
	const block = target.findingId || target.line !== null ? 'center' : 'start';
	let frame = 0;
	let tries = 0;

	host.querySelector(`[data-file="${CSS.escape(target.path)}"]`)?.scrollIntoView({ block: 'start' });

	function look(): void {
		const element = host.querySelector<HTMLElement>(selector);

		if (element) {
			element.scrollIntoView({ block });
			frame = requestAnimationFrame(() => element.scrollIntoView({ block }));
			onDone(element);

			return;
		}

		tries += 1;

		if (tries < REVEAL_FRAMES) frame = requestAnimationFrame(look);
		else onDone(null);
	}

	frame = requestAnimationFrame(look);

	return () => cancelAnimationFrame(frame);
}

/**
 * Stand-in file cards while the diff loads: the skeleton is measured from them, header and lines of code. They
 * mount a frame after the tab does, so the click that opened the page paints without their cost.
 */
function DiffSkeleton() {
	return (
		<Skeleton loading waited>
			<div className="changes-stack">
				{LOADING_DIFF.map((file) => (
					<FileCard
						key={file.path}
						file={file}
						layout="unified"
						viewed={false}
						onToggleViewed={ignore}
						bugs={NO_BUGS}
						bugsHref="#"
						target={null}
						fold={null}
						spans={NO_SPANS}
					/>
				))}
			</div>
		</Skeleton>
	);
}

/**
 * The Changes tab: every changed file's diff in one reading column, with the
 * findings under the lines they name, and the files as a tree beside it
 * unless the person shut the sidebar or the page is too narrow for it. In guide order the diff is grouped into
 * the parts the review planned. The file menu, the finding stepper and
 * collapse all sit in the tab row (`ChangesTools`) and move this tab
 * through the session. `j` and `k` step through the files, `o` opens or
 * shuts the one being read and `v` marks it viewed. The address follows each
 * jump (`#file=…&line=…`, `#finding=…`), and opening one goes there.
 */
export function ChangesTab({ repoId, number, mode }: ChangesTabProps) {
	const { base } = useApi();
	const session = useSession();
	const diff = usePullDiffView();
	const tree = useFileTree();
	const viewed = useViewedFiles();
	const guide = useGuide();
	const run = useRunView();
	const bugs = useBugsView();
	const nav = useChangesNav();
	const target = useSessionData((data) => data.changesTarget);
	const fold = useSessionData((data) => data.changesFold);
	const sideOpen = useSideOpen((state) => state.open);
	const scroller = useRef<HTMLDivElement | null>(null);
	const followed = useRef<string | null>(null);
	const painted = useAfterPaint();
	const layout = useDiffView((state) => state.layout);
	const hideWhitespace = useDiffView((state) => state.hideWhitespace);
	const loaded = diff.phase === 'ready' ? diff.value.files : null;

	const files = useMemo(
		() => (loaded && hideWhitespace ? loaded.map(withoutWhitespace) : loaded),
		[loaded, hideWhitespace]
	);

	const fyiShown = useShowFyi((state) => state.shown);
	const byFile = useMemo(() => bugsByFile(fyiShown ? [...bugs.open, ...bugs.fyi] : bugs.open), [bugs, fyiShown]);
	const ordered = useMemo(() => inOrder(files ?? [], tree.order), [files, tree.order]);
	const spans = useMemo(() => moveSpans(files ?? []), [files]);
	const parts = useMemo(() => partsWithRest(guide, tree.order), [guide, tree.order]);
	const chapters = useChapters();
	const bugsHref = pullHref(base, repoId, number, 'review');
	const chaptered = mode === 'guide' && chapters.length > 0;
	const guided = mode === 'guide' && !chaptered && guide.length > 0;

	const reading = useCurrentFile(
		scroller,
		chaptered ? chapters : guided ? parts : ordered,
		chaptered ? 'hunk' : 'file'
	);

	const hunkIds = useMemo(() => chapters.flatMap((chapter) => chapter.hunks.map((hunk) => hunk.id)), [chapters]);

	const hunkPaths = useMemo(
		() => new Map(chapters.flatMap((chapter) => chapter.hunks.map((hunk) => [hunk.id, hunk.path]))),
		[chapters]
	);

	const cards = useMemo(
		() => (chaptered && files ? hunkCards(chapters, files, byFile) : null),
		[chaptered, chapters, files, byFile]
	);

	const current = chaptered ? (hunkPaths.get(reading ?? '') ?? null) : reading;
	const lastPath = useRef<string | null>(null);
	const switched = useRef(chaptered);

	usePinnedHunk(scroller, chapters, chaptered);

	/** Brings a guide hunk's card to the top of the diff and moves the focus to its header. */
	const openHunk = useCallback((id: string) => {
		const card = scroller.current?.querySelector<HTMLElement>(`[data-hunk="${CSS.escape(id)}"]`);

		card?.scrollIntoView({ block: 'start' });
		card?.querySelector<HTMLElement>('.file-toggle')?.focus({ preventScroll: true });
	}, []);

	/** Goes to the file `by` places from the one being read; in the guide, to the hunk `by` places on. */
	function step(by: 1 | -1): void {
		if (chaptered) {
			const next = hunkIds[Math.min(hunkIds.length - 1, Math.max(0, (reading ? hunkIds.indexOf(reading) : -1) + by))];

			if (next) openHunk(next);

			return;
		}

		const at = current ? tree.order.indexOf(current) : -1;
		const next = tree.order[Math.min(tree.order.length - 1, Math.max(0, at + by))];

		if (next) nav.goTo(next);
	}

	/** Opens or shuts the file being read, as its header's toggle does; focus inside the file moves to the toggle so it is not lost. */
	function toggleCurrent(): false | void {
		const selector = chaptered
			? `[data-hunk="${CSS.escape(reading ?? '')}"]`
			: `[data-file="${CSS.escape(current ?? '')}"]`;

		const card = current ? scroller.current?.querySelector<HTMLElement>(selector) : null;
		const toggle = card?.querySelector<HTMLElement>('.file-toggle');

		if (!card || !toggle) return false;

		if (card.contains(document.activeElement)) toggle.focus({ preventScroll: true });

		toggle.click();
	}

	useEffect(() => {
		session.state.setState({ changesCurrent: current });
		lastPath.current = current;
	}, [session, current]);

	useLayoutEffect(() => {
		const host = scroller.current;
		const path = lastPath.current;

		if (switched.current === chaptered) return;

		switched.current = chaptered;

		if (!host || !path || host.scrollTop < TOP_SLACK) return;

		const selector = chaptered ? '[data-hunk][data-file="$"]' : '[data-file="$"]';

		host.querySelector(selector.replace('$', CSS.escape(path)))?.scrollIntoView({ block: 'start' });
	}, [chaptered]);

	useEffect(() => {
		const open = bugs.open;

		/** Goes to the place the address names, once per address; a finding waits until the review has it. */
		function follow(): void {
			const hash = window.location.hash;

			if (!files || hash === followed.current) return;

			const place = readPlace(hash);

			if (place?.kind === 'finding') {
				const bug = open.find((candidate) => candidate.id === place.id);

				if (!bug) return;

				nav.goTo(bug.file, null, bug.id);
			} else if (place) nav.goTo(place.path, place.line, null, place.side);

			followed.current = hash;
		}

		follow();
		window.addEventListener('hashchange', follow);

		return () => window.removeEventListener('hashchange', follow);
	}, [files, bugs.open, nav]);

	useEffect(() => {
		const host = scroller.current;

		if (!host || !files || !target || target.done) return;

		return reveal(host, target, (element) => {
			const hash = targetHash(target);

			if (element?.matches('button')) element.focus({ preventScroll: true });

			followed.current = hash;
			replaceAddress(`${window.location.pathname}${window.location.search}${hash}`);
			session.state.setState({ changesTarget: { ...target, done: true } });
		});
	}, [files, target, session]);

	useKeys({
		j: () => step(1),
		k: () => step(-1),
		o: toggleCurrent,
		v: () => (current ? viewed.toggle(current) : false)
	});

	/** One file's card. */
	function card(file: FileDiff) {
		return (
			<FileCard
				key={file.path}
				file={file}
				layout={layout}
				viewed={viewed.isViewed(file.path)}
				onToggleViewed={viewed.toggle}
				bugs={byFile.get(file.path) ?? NO_BUGS}
				bugsHref={bugsHref}
				target={target?.path === file.path ? target : null}
				fold={fold}
				spans={spans.get(file.path) ?? NO_SPANS}
			/>
		);
	}

	/** One guide hunk's card: its file cut down to the hunk, under a header that names its lines. */
	function hunkCard(hunk: Chapter['hunks'][number]) {
		const shown = cards?.get(hunk.id);

		if (!shown) return null;

		return (
			<FileCard
				key={hunk.id}
				file={shown.file}
				layout={layout}
				viewed={viewed.isViewed(hunk.path)}
				onToggleViewed={viewed.toggle}
				bugs={shown.bugs}
				bugsHref={bugsHref}
				target={target?.path === hunk.path ? target : null}
				fold={fold}
				spans={spans.get(hunk.path) ?? NO_SPANS}
				part={shown.part}
			/>
		);
	}

	/** The cards of a guide part, in the part's own order. */
	function partCards(part: GuidePart) {
		return inOrder(files ?? [], part.paths).map(card);
	}

	return (
		<div className="changes" data-layout={layout}>
			{sideOpen ? (
				<FileSidebar
					current={current}
					onOpen={(path) => nav.goTo(path)}
					outline={chaptered ? { chapters, current: reading, onOpen: openHunk } : null}
				/>
			) : null}
			<div ref={scroller} className="changes-main">
				<div className="changes-stack">
					{mode === 'guide' && !chaptered && guide.length === 0 ? (
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
					{chaptered && cards
						? chapters.map((chapter) => (
								<ChapterSection key={chapter.id} chapter={chapter}>
									{chapter.hunks.map(hunkCard)}
								</ChapterSection>
							))
						: null}
					{guided
						? parts.map((part, index) => (
								<GuidePartSection key={part.id} part={part} position={index + 1}>
									{partCards(part)}
								</GuidePartSection>
							))
						: null}
					{chaptered || guided ? null : ordered.map(card)}
				</div>
			</div>
		</div>
	);
}
