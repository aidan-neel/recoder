import type { SVGProps } from 'react';

import { FILLED, GLYPHS } from './icon-glyphs';

/** A Material Symbol the kit carries. `bun run icons <name>` in packages/ui adds one. */
export type IconName = keyof typeof GLYPHS;

/**
 * The sizes an icon is drawn at, in px. 24 is the box the kit's layouts were drawn around, and most slots (a menu row, a
 * pill, a button) set their icon's size in CSS, so pass a size only where no slot does.
 */
type IconSize = 10 | 11 | 12 | 13 | 14 | 16 | 20 | 24;

type IconProps = Omit<SVGProps<SVGSVGElement>, 'name' | 'fill' | 'width' | 'height'> & {
	name: IconName;
	size?: IconSize;
	/** Draws the filled face, which marks an active state (a vote cast); a symbol without one stays outlined. */
	fill?: boolean;
};

/**
 * A symbol's frame, 12% inside Google's 960-unit box. Material Symbols leave wide padding around their glyphs, so in a
 * kit slot drawn for the old set they read a size too small and a weight too light; cropping the frame brings them back
 * to that size and stroke. The few symbols that reach past it (a sun's rays) overflow by a hairline, which shows.
 */
const FRAME = '52 -908 856 856';

/** Every UI icon: one Material Symbol in the text's color, hidden from assistive tech unless it is labelled. */
export function Icon({ name, size = 24, fill = false, ...props }: IconProps) {
	return (
		<svg
			viewBox={FRAME}
			overflow="visible"
			width={size}
			height={size}
			fill="currentColor"
			aria-hidden={props['aria-label'] ? undefined : true}
			focusable="false"
			{...props}
		>
			<path d={(fill && FILLED[name]) || GLYPHS[name]} />
		</svg>
	);
}
