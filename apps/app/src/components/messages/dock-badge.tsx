/** A count on a bubble's shoulder or at a row's end; ten and more read as 9+. */
export function DockBadge({ count }: { count: number }) {
	if (count === 0) return null;

	return (
		<span className="dock-badge" aria-hidden>
			{count > 9 ? '9+' : count}
		</span>
	);
}
