import { cn } from '../lib/cn';

interface SkeletonProps {
	className?: string;
}

/**
 * A shimmering placeholder. It stays invisible for `--skeleton-delay`, so data
 * that arrives fast never flashes a skeleton; content then swaps in place with
 * no entrance animation.
 */
export function Skeleton({ className }: SkeletonProps) {
	return <div data-ui="skeleton" aria-hidden className={cn('h-3 rounded-[5px]', className)} />;
}
