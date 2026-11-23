'use client';

import type { PullDescription } from '@recoder/shared';
import { REASONING_EFFORTS, effortLabel } from '@recoder/shared';
import {
	Button,
	ClampedText,
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
	Icon,
	Skeleton,
	Spinner,
	Tooltip
} from '@recoder/ui';

import { shortSha } from '@/lib/files/ref-label';

import { AuthorDescription } from './overview';
import { SummaryProse } from './prose';

interface DescriptionLedeProps {
	/** The description, or a stand-in while it loads or is written. */
	description: PullDescription;
	/** `loading`: it is being read. `writing`: a model is writing it. */
	phase: 'loading' | 'writing' | 'ready';
	/** True while the summary is a stand-in, or could still gain a file badge: it stands as a skeleton. */
	standIn: boolean;
	/** The pull request's own description, behind a toggle; null when it has none. */
	author: { text: string; by: string | null } | null;
	onRedescribe: () => void;
}

/**
 * What the change does, as the model wrote it, then who wrote it: the model, its effort and the commit it read. The
 * author's own description opens under it, and the description can be written again.
 */
export function DescriptionLede({ description, phase, standIn, author, onRedescribe }: DescriptionLedeProps) {
	return (
		<Collapsible asChild>
			<section className="summary-overview" aria-label="Description" aria-busy={phase === 'writing'}>
				<Skeleton id="description-lede" loading={standIn}>
					<ClampedText lines={6} className="summary-lede">
						<SummaryProse>{description.summary}</SummaryProse>
					</ClampedText>
				</Skeleton>
				<Skeleton id="description-meta" loading={phase === 'loading' && standIn}>
					<div className="description-meta">
						{phase === 'writing' ? (
							<span className="description-by" role="status">
								<Spinner size={12} />
								Writing the description
							</span>
						) : (
							<WrittenBy description={description} />
						)}
						{author ? (
							<CollapsibleTrigger asChild>
								<Button variant="ghost" className="description-author-toggle">
									Author’s description
									<Icon name="expand_more" />
								</Button>
							</CollapsibleTrigger>
						) : null}
						{phase === 'ready' ? (
							<Tooltip content="Write it again">
								<Button
									variant="ghost"
									size="icon"
									aria-label="Write the description again"
									className="description-redo"
									onClick={onRedescribe}
								>
									<Icon name="refresh" />
								</Button>
							</Tooltip>
						) : null}
					</div>
				</Skeleton>
				{author ? (
					<CollapsibleContent>
						<AuthorDescription text={author.text} by={author.by} />
					</CollapsibleContent>
				) : null}
			</section>
		</Collapsible>
	);
}

/** `AI description · Grok 4.6 · Low · a41c9e2`. */
function WrittenBy({ description }: { description: PullDescription }) {
	const effort = REASONING_EFFORTS.find((known) => known === description.model.effort);

	return (
		<span className="description-by">
			<Icon name="auto_awesome" className="description-by-mark" />
			AI description
			<span className="meta-sep" />
			{description.model.label}
			{effort ? (
				<>
					<span className="meta-sep" />
					{effortLabel(effort)}
				</>
			) : null}
			<span className="meta-sep" />
			<span className="mono">{shortSha(description.headSha)}</span>
		</span>
	);
}
