'use client';

import type { FileDiff } from '@recoder/shared';
import { Button, Skeleton, StatusNotice } from '@recoder/ui';
import { useEffect, useMemo, useRef } from 'react';

import { useApi } from '@/lib/api/client';
import type { BugView } from '@/lib/bugs/types';
import { useBugsView } from '@/lib/bugs/use-bugs';
import { LOADING_DIFF } from '@/lib/changes/loading-diff';
import { placeHash, readPlace } from '@/lib/changes/places';
import type { ChangesTarget, GuidePart } from '@/lib/changes/types';
import { useChangesNav, useFileTree, useGuide, useViewedFiles } from '@/lib/changes/use-changes';
import { useCurrentFile } from '@/lib/changes/use-current-file';
import { useSideOpen } from '@/lib/changes/side-open';
import { usePullDiffView, useSession, useSessionData } from '@/lib/pull/pull-session';
import { useRunView } from '@/lib/run/use-run';
import { replaceAddress } from '@/lib/shell/navigation';
import { pullHref } from '@/lib/shell/routes';
import { useAfterPaint } from '@/lib/shell/use-after-paint';
import { useKeys } from '@/lib/shell/use-keys';

import type { ChangesMode } from './changes-tools';
import { FileCard } from './file-card';
import { FileSidebar } from './file-sidebar';
import { GuidePartSection, partsWithRest } from './guide';

/** No bugs: one shared empty list, so a file with none never re-renders for another file's bugs. */
const NO_BUGS: BugView[] = [];

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
	if (target.line !== null) return `${file} [data-new-line="${target.line}"]`;

	return file;
}

/** The shareable hash of a jump. */
function targetHash(target: ChangesTarget): string {
	return placeHash(
		target.findingId
			? { kind: 'finding', id: target.findingId }
			: { kind: 'file', path: target.path, line: target.line }
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
		<Skeleton loading>
			<div className="changes-stack">
				{LOADING_DIFF.map((file) => (
					<FileCard
						key={file.path}
						file={file}
						viewed={false}
						onToggleViewed={ignore}
						bugs={NO_BUGS}
						bugsHref="#"
						target={null}
						fold={null}
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
	const files = diff.phase === 'ready' ? diff.value.files : null;
	const byFile = useMemo(() => bugsByFile(bugs.open), [bugs.open]);
	const ordered = useMemo(() => inOrder(files ?? [], tree.order), [files, tree.order]);
	const parts = useMemo(() => partsWithRest(guide, tree.order), [guide, tree.order]);
	const bugsHref = pullHref(base, repoId, number, 'review');
	const guided = mode === 'guide' && guide.length > 0;
	const current = useCurrentFile(scroller, guided ? parts : ordered);

	/** Goes to the file `by` places from the one being read. */
	function step(by: 1 | -1): void {
		const at = current ? tree.order.indexOf(current) : -1;
		const next = tree.order[Math.min(tree.order.length - 1, Math.max(0, at + by))];

		if (next) nav.goTo(next);
	}

	/** Opens or shuts the file being read, as its header's toggle does; focus inside the file moves to the toggle so it is not lost. */
	function toggleCurrent(): false | void {
		const card = current ? scroller.current?.querySelector<HTMLElement>(`[data-file="${CSS.escape(current)}"]`) : null;
		const toggle = card?.querySelector<HTMLElement>('.file-toggle');

		if (!card || !toggle) return false;

		if (card.contains(document.activeElement)) toggle.focus({ preventScroll: true });

		toggle.click();
	}

	useEffect(() => {
		session.state.setState({ changesCurrent: current });
	}, [session, current]);

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
			} else if (place) nav.goTo(place.path, place.line);

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
				viewed={viewed.isViewed(file.path)}
				onToggleViewed={viewed.toggle}
				bugs={byFile.get(file.path) ?? NO_BUGS}
				bugsHref={bugsHref}
				target={target?.path === file.path ? target : null}
				fold={fold}
			/>
		);
	}

	/** The cards of a guide part, in the part's own order. */
	function partCards(part: GuidePart) {
		return inOrder(files ?? [], part.paths).map(card);
	}

	return (
		<div className="changes">
			{sideOpen ? <FileSidebar current={current} onOpen={(path) => nav.goTo(path)} /> : null}
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
