'use client';

import { Button, Markdown, Pill, SegmentedControl, SkeletonText } from '@recoder/ui';
import { useState } from 'react';

import { useAskView } from '@/lib/ask/use-ask';
import { useBugsView, useSummaryView } from '@/lib/bugs/use-bugs';
import type { GuidePart } from '@/lib/changes/types';
import { useGuide } from '@/lib/changes/use-changes';
import { usePullConversationView } from '@/lib/pull/pull-session';
import { useRunView } from '@/lib/run/use-run';
import { plural } from '@/lib/shell/format';

import { AskSuggestions, AskThread } from '@/components/ask/ask-thread';
import { Composer } from '@/components/ask/composer';
import { RunBanner } from '@/components/pull/run-banner';

import { Conversation } from './conversation';

/** Who the composer writes to: Recoder, or the pull request's conversation on the forge. */
type WriteTo = 'ask' | 'comment';

const WRITE_TO = [
	{ value: 'ask', label: 'Ask Recoder' },
	{ value: 'comment', label: 'Comment' }
];

interface SummaryTabProps {
	repoId: string;
	number: number;
	/** Opens the Changes tab in the guide's reading order. */
	onOpenGuide: () => void;
}

/** The guide as a short list: each part's place, what it is about, its open bugs and its size. */
function GuideList({ parts }: { parts: GuidePart[] }) {
	return (
		<ol className="guide-list">
			{parts.map((part, index) => (
				<li key={part.id} className="guide-list-row" title={part.reason}>
					<span className="guide-number">{index + 1}</span>
					<span className="guide-list-title">{part.title}</span>
					{part.bugs > 0 ? <Pill tone="high">{plural(part.bugs, 'bug')}</Pill> : null}
					<span className="meta">{plural(part.paths.length, 'file')}</span>
				</li>
			))}
		</ol>
	);
}

/**
 * The Summary tab: what the change does in the review's words, the author's
 * own description, the order to read the files in, then the conversation.
 * One composer writes either to Recoder or to the pull request.
 */
export function SummaryTab({ repoId, number, onOpenGuide }: SummaryTabProps) {
	const summary = useSummaryView();
	const guide = useGuide();
	const conversation = usePullConversationView();
	const ask = useAskView({ kind: 'pull' });
	const run = useRunView();
	const bugs = useBugsView();
	const [writeTo, setWriteTo] = useState<WriteTo>('ask');
	const canComment = conversation.phase !== 'off';
	const commenting = canComment && writeTo === 'comment';

	return (
		<div className="reading">
			<div className="reading-column" data-width="narrow">
				{summary.analysis === null && !summary.writing ? (
					<RunBanner
						run={run}
						repoId={repoId}
						number={number}
						bugs={bugs.phase === 'ready' ? bugs.open.length : null}
					/>
				) : null}
				{summary.analysis !== null || summary.writing ? (
					<section className="summary-block summary-analysis" aria-label="What changed">
						<h2 className="section-label">What changed</h2>
						{summary.analysis ? (
							<Markdown streaming={summary.writing}>{summary.analysis}</Markdown>
						) : (
							<SkeletonText count={3} />
						)}
					</section>
				) : null}
				{guide.length > 0 ? (
					<section className="summary-block" aria-label="Read in this order">
						<div className="summary-block-head">
							<h2 className="section-label">Read in this order</h2>
							<Button variant="ghost" size="sm" onClick={onOpenGuide}>
								Open the guide
							</Button>
						</div>
						<GuideList parts={guide} />
					</section>
				) : null}
				{summary.description ? (
					<section className="summary-block" aria-label="Description">
						<h2 className="section-label">Description</h2>
						<div className="summary-description">
							<Markdown>{summary.description}</Markdown>
						</div>
					</section>
				) : null}
				<section className="summary-block" aria-label="Conversation">
					<h2 className="section-label">Conversation</h2>
					<Conversation view={conversation} />
					<AskThread ask={ask} />
					{commenting ? null : <AskSuggestions ask={ask} />}
					<Composer
						key={commenting ? 'comment' : 'ask'}
						rows={2}
						label={commenting ? 'Comment on this pull request' : 'Ask about this pull request'}
						placeholder={commenting ? 'Comment on this pull request' : 'Ask about this pull request'}
						limit={commenting ? undefined : ask.limit}
						busy={commenting ? conversation.posting : ask.replying}
						onStop={commenting ? undefined : ask.stop}
						onSend={commenting ? conversation.post : ask.send}
						tools={
							canComment ? (
								<SegmentedControl
									size="sm"
									aria-label="Write to"
									value={writeTo}
									onValueChange={(value) => setWriteTo(value === 'comment' ? 'comment' : 'ask')}
									options={WRITE_TO}
								/>
							) : null
						}
					/>
				</section>
			</div>
		</div>
	);
}
