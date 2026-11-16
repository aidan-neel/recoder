'use client';

import { Card, RowButton } from '@recoder/ui';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';

import type { StartedReview } from '@/lib/ask/types';

import { PullMark } from '@/components/common/pull-mark';
import { StatusPill } from '@/components/pulls/pull-status';

/** The review a reply started: its pull request and how the review stands, the whole card (its status pill too) opening its Review tab. */
export function ReviewCard({ review }: { review: StartedReview }) {
	return (
		<Card as="article" className="chat-review" aria-label={`Review of #${review.prNumber}`}>
			<PullMark />
			<span className="chat-review-text">
				<RowButton asChild cover className="chat-review-title">
					<Link href={review.href}>{review.title}</Link>
				</RowButton>
				<span className="chat-review-meta">
					{review.repo} <span className="tabular">#{review.prNumber}</span>
				</span>
			</span>
			<StatusPill status={review.status} />
			<ChevronRight aria-hidden className="chat-review-chevron" />
		</Card>
	);
}
