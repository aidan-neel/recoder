'use client';

import type { RepoGuidelines } from '@recoder/shared';
import { Pill, Tooltip } from '@recoder/ui';
import { ArrowUpRight } from 'lucide-react';

import { activeSource } from '@/lib/guidelines/rules';

/**
 * Where a repository's file stands, beside its row: the branch reviews read
 * it from when the default branch has it, and a link to the pull request when
 * a change waits for review.
 */
export function RepoStatus({ data }: { data: RepoGuidelines }) {
	if (data.content === null && !data.pending) return null;

	return (
		<div className="guidelines-status">
			{data.content === null ? null : (
				<Tooltip content={activeSource(data)}>
					<span className="guidelines-pill">
						<Pill>On {data.ref}</Pill>
					</span>
				</Tooltip>
			)}
			{data.pending ? (
				<a
					href={data.pending.url}
					target="_blank"
					rel="noopener noreferrer"
					aria-label={`Pending in #${data.pending.number}, opens in a new tab`}
					className="guidelines-pill"
				>
					<Pill tone="medium">
						Pending in #{data.pending.number}
						<ArrowUpRight aria-hidden />
					</Pill>
				</a>
			) : null}
		</div>
	);
}
