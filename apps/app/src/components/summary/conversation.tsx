'use client';

import type { PullComment } from '@recoder/shared';
import { Markdown, Pill, SkeletonRows, type PillTone } from '@recoder/ui';

import type { PullConversationView } from '@/lib/pull/types';
import { author } from '@/lib/shell/format';

import { ChatComposer } from '@/components/ask/chat-composer';
import { Age } from '@/components/common/age';
import { Avatar } from '@/components/common/avatar';

const VERDICTS: Record<NonNullable<PullComment['verdict']>, { label: string; tone: PillTone }> = {
	approved: { label: 'Approved', tone: 'ok' },
	'changes-requested': { label: 'Requested changes', tone: 'danger' },
	commented: { label: 'Reviewed', tone: 'neutral' }
};

/** Where an inline comment sits: `lease.ts:20`. */
function place(entry: PullComment): string | null {
	if (!entry.path) return null;

	const file = entry.path.split('/').pop() ?? entry.path;

	return entry.line ? `${file}:${entry.line}` : file;
}

/** One entry of the timeline: who, what kind, where, when, then what they wrote. */
function Entry({ entry }: { entry: PullComment }) {
	const by = author(entry.author.login);
	const verdict = entry.verdict ? VERDICTS[entry.verdict] : null;
	const where = place(entry);

	return (
		<article className="timeline-entry" aria-label={`${by.name} wrote`}>
			<Avatar name={by.name} src={entry.author.avatarUrl} tone={entry.byRecoder ? 'recoder' : 'person'} />
			<div className="timeline-head">
				<span className="timeline-author">{entry.byRecoder ? 'Recoder' : by.name}</span>
				{verdict ? <Pill tone={verdict.tone}>{verdict.label}</Pill> : null}
				{where ? (
					<Pill face="code" title={entry.path}>
						{where}
					</Pill>
				) : null}
				<Age at={entry.createdAt} className="timeline-age" />
			</div>
			{entry.body ? (
				<div className="timeline-body">
					<Markdown>{entry.body}</Markdown>
				</div>
			) : null}
		</article>
	);
}

/** The entries, or why there are none yet. */
function Timeline({ view }: { view: PullConversationView }) {
	if (view.phase === 'loading') return <SkeletonRows count={2} height={56} glyph />;

	if (view.phase === 'failed') {
		return (
			<p className="timeline-note text-danger" role="alert">
				The conversation did not load. {view.error}
			</p>
		);
	}

	if (view.entries.length === 0) return <p className="timeline-note">Nobody has commented yet.</p>;

	return (
		<div className="timeline">
			{view.entries.map((entry) => (
				<Entry key={entry.id} entry={entry} />
			))}
		</div>
	);
}

/**
 * The pull request's conversation on its forge as a quiet timeline, oldest
 * first, with a field at its end that comments on the pull request. Its text
 * is other people's: it renders as markdown with no raw HTML. A forge with no
 * conversation shows nothing.
 */
export function Conversation({ view }: { view: PullConversationView }) {
	if (view.phase === 'off') return null;

	return (
		<section className="summary-section" aria-labelledby="conversation-title">
			<div className="summary-section-head">
				<h2 id="conversation-title" className="summary-section-title">
					Conversation
					{view.entries.length > 0 ? <span className="summary-count">{view.entries.length}</span> : null}
				</h2>
			</div>
			<Timeline view={view} />
			{view.phase === 'ready' ? (
				<div className="timeline-reply">
					<ChatComposer
						layout="row"
						minRows={1}
						label="Comment on this pull request"
						placeholder="Comment on this pull request"
						sendLabel="Comment"
						busy={view.posting}
						onSend={view.post}
					/>
				</div>
			) : null}
		</section>
	);
}
