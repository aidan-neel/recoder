'use client';

import { Button, StatusGlyph } from '@recoder/ui';

import { decisionGlyph, plain, STATE_LABEL } from '@/lib/review/labels';
import { useReview } from '@/lib/review/review-store';
import type { Decision, DecisionState } from '@/lib/review/surface';

/** A decision as a compact card under the line it ends on; pressing it opens the decision. */
export function FileNote({ decision, state }: { decision: Decision; state: DecisionState }) {
	return (
		<Button
			variant="secondary"
			data-state={state}
			className="file-note"
			onClick={() => useReview.getState().select({ kind: 'decision', id: decision.id })}
		>
			<StatusGlyph kind={decisionGlyph(decision, state)} />
			<span className="file-note-title">{plain(decision.title)}</span>
			<span className="shrink-0 text-[12px] text-fg-faint">{STATE_LABEL[state]}</span>
		</Button>
	);
}
