'use client';

import { useAskView } from '@/lib/ask/use-ask';
import { useFollowEnd } from '@/lib/ask/use-follow-end';

import { AskComposer } from './ask-composer';
import { AskSuggestions, AskThread } from './ask-thread';

/**
 * The conversation with Recoder about the whole pull request, as a pane
 * beside the reading: its thread scrolls and sits on the composer, which stays
 * docked at the pane's foot with the "+" for a changed file, the "/"
 * commands and the models. While the thread is empty, questions to start
 * from stand where the first message will. A sent question and its reply stay
 * in view as the reply arrives.
 */
export function AskPane() {
	const ask = useAskView({ kind: 'pull' });
	const scroller = useFollowEnd(ask.replying);

	return (
		<aside className="ask-pane" aria-labelledby="ask-pane-title">
			<div className="ask-pane-head">
				<h2 id="ask-pane-title" className="ask-pane-title">
					Ask Recoder
				</h2>
			</div>
			<div ref={scroller} className="ask-pane-scroll">
				<div className="ask-pane-thread">
					<AskThread ask={ask} />
					<AskSuggestions ask={ask} />
				</div>
			</div>
			<div className="ask-pane-foot">
				<AskComposer ask={ask} label="Ask about this pull request" />
			</div>
		</aside>
	);
}
