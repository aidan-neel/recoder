'use client';

import { Button } from '@recoder/ui';

import type { BugsView } from '@/lib/bugs/types';
import type { RunView } from '@/lib/run/types';
import { plural } from '@/lib/shell/format';
import { errorToast } from '@/lib/shell/notify';
import { useAction } from '@/lib/shell/use-action';

import { Age } from '@/components/common/age';

interface BugsToolsProps {
	view: BugsView;
	run: RunView;
}

/** Shows why an action did not go through, and keeps the rejection so the button shows it failed. */
function report(fallback: string): (error: unknown) => never {
	return (error) => {
		errorToast(error instanceof Error && error.message ? error.message : fallback);
		throw error;
	};
}

/**
 * The Bugs tab's tools in the tab row: the facts of the review being shown
 * (when, at which commit, with which model, how long it took), posting every
 * open bug at once, and reviewing again.
 */
export function BugsTools({ view, run }: BugsToolsProps) {
	const reviewing = useAction();
	const busy = run.phase === 'queued' || run.phase === 'running';

	if (view.phase !== 'ready') return null;

	return (
		<>
			<span className="meta">
				Reviewed <Age at={view.reviewedAt} form="long" />
				{view.headSha ? (
					<>
						{' at '}
						<span className="mono">{view.headSha.slice(0, 7)}</span>
					</>
				) : null}
				{view.modelLabel ? <span className="meta-sep">{view.modelLabel}</span> : null}
				{view.duration ? <span className="meta-sep">{view.duration}</span> : null}
			</span>
			{view.canPost && view.open.length > 1 ? (
				<Button
					variant="outline"
					status={view.postingAll ? 'pending' : 'idle'}
					onClick={() => view.postAll().catch(report('The bugs were not posted.'))}
				>
					Post all {plural(view.open.length, 'bug').replace(' ', ' ')}
				</Button>
			) : null}
			{!busy ? (
				<Button
					variant="outline"
					status={run.starting ? 'pending' : reviewing.status}
					onClick={() => reviewing.run(() => run.start().catch(report('The review did not start.')))}
				>
					Review again
				</Button>
			) : null}
		</>
	);
}
