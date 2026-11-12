'use client';

import { useState, type AnimationEvent } from 'react';

import { GlyphFace, type GlyphKind } from './glyph-face';

export type { GlyphKind };

interface StatusGlyphProps {
	kind: GlyphKind;
	className?: string;
	/** Names the state for assistive tech. Without it the glyph is decorative and hidden. */
	label?: string;
}

/** One face on screen: its kind, a key that changes on every swap, and whether it rests, arrives or leaves. */
interface Face {
	kind: GlyphKind;
	key: number;
	state: 'still' | 'in' | 'out';
}

/** The faces once `ended` has finished its animation: a leaving face goes, an arriving one comes to rest. */
function afterEnd(faces: Face[], ended: Face): Face[] {
	if (ended.state === 'out') return faces.filter((face) => face.key !== ended.key);

	return faces.map((face) => (face.key === ended.key ? { ...face, state: 'still' } : face));
}

/**
 * The faces to draw: the first kind alone and still, then on each change the
 * new face arriving over the one before as it leaves. Only the latest leaving
 * face is kept, so a burst of changes never stacks faces. An arrived face
 * rests, so showing a hidden glyph again never replays its arrival.
 */
function useFaces(kind: GlyphKind): [Face[], (face: Face) => void] {
	const [faces, setFaces] = useState<Face[]>(() => [{ kind, key: 0, state: 'still' }]);
	const current = faces[faces.length - 1];

	if (current.kind === kind) return [faces, (face) => setFaces((list) => afterEnd(list, face))];

	const next: Face[] = [
		{ ...current, state: 'out' },
		{ kind, key: current.key + 1, state: 'in' }
	];

	setFaces(next);

	return [next, () => undefined];
}

/**
 * One 16px glyph for every state an item can be in, so the queue, the rail and
 * the file list read alike. A change of kind morphs the face in place: the new
 * one scales up out of a 2px blur as the old one shrinks and fades (a snap
 * under reduced motion). The first paint never animates. The morph is a CSS
 * animation on transform, opacity and filter, so a list of glyphs costs no
 * animation work until one changes.
 */
export function StatusGlyph({ kind, className, label }: StatusGlyphProps) {
	const [faces, end] = useFaces(kind);

	const ended = (face: Face) => (event: AnimationEvent) => {
		if (event.target === event.currentTarget) end(face);
	};

	return (
		<span
			data-ui="status-glyph"
			data-kind={kind}
			role={label ? 'img' : undefined}
			aria-label={label}
			aria-hidden={label ? undefined : true}
			className={className}
		>
			{faces.map((face) => (
				<span
					key={face.key}
					data-ui="status-glyph-face"
					data-kind={face.kind}
					data-state={face.state}
					onAnimationEnd={face.state === 'still' ? undefined : ended(face)}
				>
					<GlyphFace kind={face.kind} />
				</span>
			))}
		</span>
	);
}
