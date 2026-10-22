'use client';

import { Button } from '@recoder/ui';
import type { ReactNode } from 'react';

import { useAction } from '@/lib/shell/use-action';

interface ActionButtonProps {
	/** The action; a rejection shows the failure face (the action has already toasted why). */
	run: () => Promise<unknown>;
	children: ReactNode;
}

/** An outline button for one async lifecycle action: idle, then a spinner at the same width, then back or "Try again". */
export function ActionButton({ run, children }: ActionButtonProps) {
	const action = useAction();

	return (
		<Button variant="outline" status={action.status} onClick={() => action.run(run)}>
			{children}
		</Button>
	);
}
