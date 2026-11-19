import type { ComponentProps, ReactNode } from 'react';

interface RefChipProps extends ComponentProps<'button'> {
	/** The mark before the name: a file's language mark or a glyph. */
	icon: ReactNode;
}

/**
 * A reference in a line of text as a small chip: a mark and a short name in the code face. It passes on the props
 * a hover card trigger gives it, so a card can hang from it. A link takes the same look from the `ref-chip` class.
 */
export function RefChip({ icon, children, ...button }: RefChipProps) {
	return (
		<button type="button" className="ref-chip" {...button}>
			{icon}
			{children}
		</button>
	);
}
