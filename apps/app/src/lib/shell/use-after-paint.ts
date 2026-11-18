'use client';

import { useEffect, useState } from 'react';

/**
 * False until the first frame after mount has painted, then true. A screen
 * holds back work that frame can go without, such as laying out the stand-in
 * a skeleton is measured from: the skeleton stays unseen for its first 120ms
 * in any case, so the click's own frame paints sooner and nothing looks
 * different.
 */
export function useAfterPaint(): boolean {
	const [painted, setPainted] = useState(false);

	useEffect(() => {
		const frame = requestAnimationFrame(() => setPainted(true));

		return () => cancelAnimationFrame(frame);
	}, []);

	return painted;
}
