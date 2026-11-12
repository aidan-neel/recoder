'use client';

import { Card, ScrollArea, Skeleton, SkeletonText } from '@recoder/ui';

import type { SetupSteps } from '@/lib/setup/setup-steps';
import { handOffOnLeave } from '@/lib/shell/skeleton-handoff';

/** The headline's lines in the 576px column: the count, "before your first review", and the sentence after it. */
const BRIEF_LINES = 3;

/** The headline's line height: 27px type on a 1.38 line, as `.brief` sets it. */
const BRIEF_LINE = 27 * 1.38;

/** Each step's title and description widths, so the rows don't read as copies. */
const WIDTHS = [
	['48%', '72%'],
	['26%', '44%'],
	['38%', '64%']
] as const;

/**
 * First run while its settings, repositories and forges load: the headline
 * and the three steps, each as tall as the step that replaces it. A step the
 * server already reported done is folded, as it will be. The bars stay
 * invisible for the kit's skeleton delay, so a fast load never shows them.
 * First run's code loads behind one of these and its data behind another, so
 * when one leaves with its bars showing, the next shows at once (`handOffOnLeave`).
 */
export function SetupSkeleton({ steps }: { steps: SetupSteps | null }) {
	const done = [steps?.provider, steps?.model, steps?.repo];

	return (
		<ScrollArea className="min-h-0 flex-1">
			<div ref={handOffOnLeave} className="setup setup-skeleton" aria-busy="true" aria-label="Loading first run">
				<SkeletonText count={BRIEF_LINES} lineHeight={BRIEF_LINE} barHeight={27} widths={['92%', '100%', '58%']} />
				<Card className="setup-card">
					<ol className="setup-steps">
						{WIDTHS.map(([title, description], index) => (
							<li key={title} className="setup-step">
								<Skeleton className="setup-glyph size-4 shrink-0 rounded-full" />
								<div className="setup-step-main">
									<SkeletonText count={1} lineHeight={22} widths={[title]} />
									<SkeletonText count={1} lineHeight={18} barHeight={10} widths={[description]} />
									{done[index] ? null : (
										<div className="setup-step-body">
											<Skeleton className="setup-skeleton-action" />
										</div>
									)}
								</div>
							</li>
						))}
					</ol>
				</Card>
				<Skeleton className="setup-skeleton-sample" />
			</div>
		</ScrollArea>
	);
}
