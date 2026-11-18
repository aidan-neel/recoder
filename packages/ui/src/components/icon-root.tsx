'use client';

import { IconContext, type IconProps } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

/**
 * How every icon draws: Phosphor's bold weight, at 24px unless the CSS or the icon's own `size` says otherwise, the
 * size the kit's layouts were drawn around.
 */
const ICON_STYLE: IconProps = { weight: 'bold', size: 24 };

/** Gives every Phosphor icon under it the kit's weight and size. Mount it once at an app's root. */
export function IconRoot({ children }: { children: ReactNode }) {
	return <IconContext.Provider value={ICON_STYLE}>{children}</IconContext.Provider>;
}
