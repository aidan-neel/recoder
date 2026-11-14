'use client';

import { CodeBlock, ScrollArea } from '@recoder/ui';
import { useEffect, useRef } from 'react';

import { tailLines } from '@/lib/settings/providers/tail-lines';

/** What an install or sign-in printed, the last lines in a scroll area that follows the end. */
export function SetupOutput({ output }: { output: string }) {
	const viewport = useRef<HTMLDivElement>(null);
	const lines = tailLines(output);

	useEffect(() => {
		if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
	}, [lines]);

	if (!lines) return null;

	return (
		<ScrollArea className="setup-output" viewportRef={viewport}>
			<CodeBlock code={lines} wrap />
		</ScrollArea>
	);
}
