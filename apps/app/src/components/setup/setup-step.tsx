'use client';

import { Collapsible, CollapsibleContent, StatusGlyph, SwapText } from '@recoder/ui';
import type { ReactNode } from 'react';

interface SetupStepProps {
	done: boolean;
	/** The first step not done yet: it takes the tint and the region's one primary button. */
	current: boolean;
	title: string;
	/** One line under the title. A new line replaces the old one after it fades out, so the two never overlap. */
	description: string;
	/** What gets the step done; it folds away once the step is. */
	children: ReactNode;
}

/**
 * One step of first run. Its glyph morphs from an empty ring to a check when
 * the step is done, the line under the title changes to what was set up, and
 * the actions fold away.
 */
export function SetupStep({ done, current, title, description, children }: SetupStepProps) {
	return (
		<li data-ui="setup-step" data-state={done ? 'done' : current ? 'current' : 'pending'} className="setup-step">
			<StatusGlyph kind={done ? 'ok' : 'idle'} label={done ? 'Done' : 'To do'} className="setup-glyph" />
			<div className="setup-step-main">
				<h2 className="setup-step-title">{title}</h2>
				<SwapText mode="wait" className="setup-step-desc">
					{description}
				</SwapText>
				<Collapsible open={!done}>
					<CollapsibleContent className="setup-step-body">{children}</CollapsibleContent>
				</Collapsible>
			</div>
		</li>
	);
}
