import { SkeletonBox } from '@recoder/ui';

/** A picker trigger's place while the repositories load, as tall as the trigger so the composer's foot never moves. */
export function PickerSkeleton({ width }: { width: number }) {
	return (
		<span className="bar-trigger-skeleton" aria-hidden>
			<SkeletonBox style={{ width }} />
		</span>
	);
}
