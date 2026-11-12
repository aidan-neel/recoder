'use client';

import { Button, Keycap, StatusGlyph, SwapText } from '@recoder/ui';
import {
	memo,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type MouseEvent,
	type RefObject,
	type TransitionEvent
} from 'react';
import { useShallow } from 'zustand/react/shallow';

import { focusReadingPane } from '@/components/review/reading-viewport';
import { decideSelected } from '@/components/review/use-review-keys';
import { stateOf } from '@/lib/review/decisions';
import { MAY_RAISE, useUnsavedDismissal } from '@/lib/review/dismissal-sync';
import { decisionGlyph } from '@/lib/review/labels';
import { surfaceOf, useReview, type ReviewStore } from '@/lib/review/review-store';
import type { Decision, Outcome } from '@/lib/review/surface';
import { useLastShown } from '@/lib/shell/use-last-shown';

import { BarNav } from './decision-bar-nav';

/** What each outcome means, said once the item is decided. */
const DONE: Record<Outcome, string> = {
	accepted: 'Accepted. It ships as is.',
	sent: 'Sent back. It goes to the agent in the handoff.',
	dismissed: 'Not an issue. Recoder won’t raise it again.'
};

/** The dismissed line while the server doesn't have the dismissal: it holds here, and the failure toast says the same. */
const DISMISSED_UNSAVED = `Not an issue here. ${MAY_RAISE}`;

/**
 * How long a leaving face may wait for its fade to end, in ms. The fade takes
 * 80ms; this covers one that never runs (a face replaced before it showed),
 * so a leaving face always goes.
 */
const LEAVE_LIMIT_MS = 250;

/**
 * What the bar's face shows: the buttons while the selected decision is
 * open, or what was decided. Open faces do not name their decision, since
 * the buttons decide whichever one is selected, so a step between open
 * decisions of the same kind keeps the same face.
 */
type Face = { state: 'open'; kind: Decision['kind']; send: boolean } | { state: Outcome; id: string };

/**
 * The likely call is the filled button: send back real risks and open
 * questions, accept low and quality findings. Positions never move.
 */
function sendIsLikely(decision: Decision): boolean {
	return !decision.quality && decision.tone !== 'low';
}

/** The face for the selected decision, or null when no decision is selected. Select it with `useShallow`. */
function selectedFace(store: ReviewStore): Face | null {
	const { selection } = store;

	if (selection.kind !== 'decision') return null;

	const decision = surfaceOf(store)?.decisions.find((item) => item.id === selection.id);

	if (!decision) return null;

	const state = stateOf(store.records, decision.id);

	return state === 'open' ? { state, kind: decision.kind, send: sendIsLikely(decision) } : { state, id: decision.id };
}

/**
 * After a click with the pointer, focus goes to the reading pane, so Space
 * and Page Down read on instead of pressing the button again. A key press on
 * a focused button (`detail` 0) keeps focus in the bar.
 */
function readOnAfterClick(event: MouseEvent<HTMLElement>): void {
	if (event.detail > 0 && (event.target as Element).closest('button')) focusReadingPane();
}

/**
 * The three outcomes, the likely one filled; it takes focus when the face
 * swaps in with focus in the bar (`data-takes-focus`). "Not an issue" is for
 * findings; a question can only be settled. Each button is named by its label
 * alone; the keycap it shows is its shortcut. The buttons decide the selected
 * decision, as the keys do.
 */
function Actions({ kind, send }: { kind: Decision['kind']; send: boolean }) {
	return (
		<div className="flex min-w-0 items-center gap-1.5">
			<Button
				data-takes-focus={!send || undefined}
				variant={send ? 'outline' : 'primary'}
				className="gap-2"
				aria-label="Accept"
				aria-keyshortcuts="A"
				onClick={() => decideSelected('accepted')}
			>
				Accept <Keycap k="a" />
			</Button>
			<Button
				data-takes-focus={send || undefined}
				variant={send ? 'primary' : 'outline'}
				className="gap-2"
				aria-label="Send back"
				aria-keyshortcuts="S"
				onClick={() => decideSelected('sent')}
			>
				Send back <Keycap k="s" />
			</Button>
			{kind === 'finding' ? (
				<Button
					variant="ghost"
					className="gap-2"
					aria-label="Not an issue"
					aria-keyshortcuts="X"
					onClick={() => decideSelected('dismissed')}
				>
					Not an issue <Keycap k="x" />
				</Button>
			) : null}
		</div>
	);
}

/**
 * What was decided, in a sentence that swaps in wait mode when it changes,
 * with Undo at the end, which takes focus when the face swaps in with focus
 * in the bar. A dismissal the server doesn't have (its write failed) says
 * Recoder may still raise it, as the Not saved note and the toast do, and
 * the line swaps back once the write lands. A finding's decision has the
 * finding's id. Undo reopens this decision; its keycap shows only while it
 * was also the last change, since u undoes the last change wherever it was
 * made.
 */
function Done({ id, state }: { id: string; state: Outcome }) {
	const lastChange = useReview((store) => store.history.at(-1)?.id === id);
	const reviewId = useReview((store) => store.review?.id);
	const unsaved = useUnsavedDismissal(reviewId, id, state) !== null;
	const line = state === 'dismissed' && unsaved ? DISMISSED_UNSAVED : DONE[state];

	const glyph = useReview((store) => {
		const decision = surfaceOf(store)?.decisions.find((item) => item.id === id);

		return decision ? decisionGlyph(decision, state) : null;
	});

	return (
		<div className="flex min-w-0 items-center gap-2.5 pl-0.5">
			{glyph ? <StatusGlyph kind={glyph} /> : null}
			<SwapText mode="wait" className="flex-1" textClassName="truncate text-[13px] text-fg-secondary">
				{line}
			</SwapText>
			<Button
				data-takes-focus
				variant="ghost"
				className="gap-2"
				aria-label="Undo"
				aria-keyshortcuts={lastChange ? 'U' : undefined}
				onClick={() => useReview.getState().reopen(id)}
			>
				Undo {lastChange ? <Keycap k="u" /> : null}
			</Button>
		</div>
	);
}

/** The bar's two faces. A step within one changes it in place; a step across swaps them. */
type FaceKind = 'actions' | 'done';

/**
 * One face drawn in the bar: `still` when it was there from the start (or
 * came while the bar was hidden), `in` when it arrived by a swap, `out` while
 * it leaves.
 */
interface FaceLayer {
	kind: FaceKind;
	face: Face;
	state: 'still' | 'in' | 'out';
}

/** The faces drawn, one per kind at most, and whether the bar was hidden when they were set. */
interface FaceSwap {
	layers: FaceLayer[];
	hidden: boolean;
}

function kindOf(face: Face): FaceKind {
	return face.state === 'open' ? 'actions' : 'done';
}

/**
 * The layers once `face` is on show. A face of the kind on show takes its
 * place. A face of the other kind arrives as the one on show leaves; if its
 * kind is still leaving, that layer comes back, so a fast run of j or k never
 * mounts a face twice. A face that comes while the bar is hidden replaces the
 * old one at once, since the bar's own fade brings it in.
 */
function swapTo(layers: FaceLayer[], face: Face, instant: boolean): FaceLayer[] {
	const kind = kindOf(face);

	if (instant) return [{ kind, face, state: 'still' }];

	const next = layers.map((layer): FaceLayer =>
		layer.kind === kind ? { kind, face, state: layer.state === 'out' ? 'in' : layer.state } : { ...layer, state: 'out' }
	);

	return next.some((layer) => layer.kind === kind) ? next : [...next, { kind, face, state: 'in' }];
}

/** An update that drops the leaving layer of `kind`, unless it came back. */
function withoutLeaving(kind: FaceKind) {
	return (swap: FaceSwap): FaceSwap => {
		const layers = swap.layers.filter((layer) => layer.kind !== kind || layer.state !== 'out');

		return layers.length === swap.layers.length ? swap : { ...swap, layers };
	};
}

/**
 * Tracks the bar's faces for `face`, and returns them with the call that
 * drops a leaving one once its fade ends. State changes only when the face or
 * the bar's visibility does, or a leave ends; a leave that never fades (its
 * face was replaced before it showed) ends after {@link LEAVE_LIMIT_MS}.
 */
function useFaceSwap(face: Face, hidden: boolean): [FaceLayer[], (kind: FaceKind) => void] {
	const [swap, setSwap] = useState<FaceSwap>(() => ({
		layers: [{ kind: kindOf(face), face, state: 'still' }],
		hidden
	}));

	const shown = swap.layers.find((layer) => layer.state !== 'out');
	const leaving = swap.layers.find((layer) => layer.state === 'out')?.kind;

	useEffect(() => {
		if (!leaving) return;

		const timer = setTimeout(() => setSwap(withoutLeaving(leaving)), LEAVE_LIMIT_MS);

		return () => clearTimeout(timer);
	}, [leaving]);

	const left = (kind: FaceKind) => setSwap(withoutLeaving(kind));

	if (shown?.face !== face || swap.hidden !== hidden) {
		const updated = { layers: swapTo(swap.layers, face, swap.hidden), hidden };

		setSwap(updated);

		return [updated.layers, left];
	}

	return [swap.layers, left];
}

/**
 * When the bar swaps faces with focus inside it, focus moves to the new
 * face's first choice (`data-takes-focus`: the likely button, or Undo). The
 * face going out is still in the page while it fades, so focus never drops
 * to the page and Enter keeps working.
 */
function useFocusFollowsFace(bar: RefObject<HTMLDivElement | null>, kind: FaceKind): void {
	useLayoutEffect(() => {
		const face = bar.current?.querySelector(`[data-bar-face="${kind}"]`);
		const active = document.activeElement;

		if (!face || !active || !bar.current?.contains(active) || face.contains(active)) return;

		face.querySelector<HTMLElement>('[data-takes-focus]')?.focus({ preventScroll: true });
	}, [bar, kind]);
}

/** Calls `done` when the element's own opacity transition ends, not one inside it. */
function onFadeEnd(done: () => void) {
	return (event: TransitionEvent) => {
		if (event.target === event.currentTarget && event.propertyName === 'opacity') done();
	};
}

/** A face's content, memoized on the face, so a leave ending renders none of it again. */
const FaceView = memo(function FaceView({ face }: { face: Face }) {
	return face.state === 'open' ? (
		<Actions kind={face.kind} send={face.send} />
	) : (
		<Done id={face.id} state={face.state} />
	);
});

/**
 * The floating bar with its face. It renders again only when the face or its
 * visibility changes (memoized on the face, which `useShallow` keeps as one
 * object while it stays the same), so a step between decisions renders only
 * the position in `BarNav`. A swap between the buttons and what was decided
 * is a wait swap in CSS (decision.css): the old face fades out and the new
 * one fades in after it, so the two never show at once. A button's own click
 * runs before the bar's, so a pointer decision is made before focus moves to
 * the reading pane.
 */
const Bar = memo(function Bar({ face, hidden }: { face: Face; hidden: boolean }) {
	const [layers, left] = useFaceSwap(face, hidden);
	const bar = useRef<HTMLDivElement>(null);

	useFocusFollowsFace(bar, kindOf(face));

	return (
		<>
			<div aria-hidden="true" className="decide-fade" />
			<div
				ref={bar}
				role="group"
				aria-label="Decide"
				data-ui="decide-bar"
				className="decide-bar"
				onClick={readOnAfterClick}
			>
				<div className="relative grid min-w-0 flex-1">
					{layers.map((layer) => (
						<div
							key={layer.kind}
							data-bar-face={layer.kind}
							data-state={layer.state}
							className="decide-face"
							onTransitionEnd={layer.state === 'out' ? onFadeEnd(() => left(layer.kind)) : undefined}
						>
							<FaceView face={layer.face} />
						</div>
					))}
				</div>
				<BarNav />
			</div>
		</>
	);
});

/** When the bar starts to hide with focus inside it, focus moves to the reading pane instead of the page. */
function useHandFocusOnHide(layer: RefObject<HTMLDivElement | null>, shown: boolean): void {
	useLayoutEffect(() => {
		if (!shown && layer.current?.contains(document.activeElement)) focusReadingPane();
	}, [shown, layer]);
}

/**
 * Accept, send back or dismiss the selected decision. Deciding advances the
 * review at once and the bar stays where it is. The bar stays mounted once
 * a decision has been selected: it fades in with a small rise when a
 * decision is selected and fades away, keeping the face it had, when none
 * is (decision.css, on `data-state`), so moving in and out of decisions
 * costs a style change and a render of the bar's frame, not a mount. The
 * review page binds the keys the keycaps name.
 */
export function DecisionBar() {
	const selected = useReview(useShallow(selectedFace));
	const face = useLastShown(selected);
	const layer = useRef<HTMLDivElement>(null);
	const shown = selected !== null;

	useHandFocusOnHide(layer, shown);

	return (
		<div
			ref={layer}
			data-ui="decide-layer"
			data-state={shown ? 'shown' : 'hidden'}
			className="decide-layer pointer-events-none absolute inset-x-0 bottom-0 z-[5]"
		>
			{face ? <Bar face={face} hidden={!shown} /> : null}
		</div>
	);
}
