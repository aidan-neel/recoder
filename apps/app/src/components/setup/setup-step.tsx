import { StatusGlyph, SwapText } from '@recoder/ui';
import type { ReactNode } from 'react';

import type { SaveState } from '@/lib/settings/use-save-state';

import { SettingsRow } from '@/components/settings/settings-group';

interface SetupStepProps {
	name: string;
	/** The step's one line: what to do, why it waits, or what is in place once it is done. */
	detail: string;
	done: boolean;
	/** The first step not done yet: its action is the page's next one. */
	current: boolean;
	/** Where the step's own save stands, when its control saves on change. */
	state?: SaveState;
	/** Under the row: a command to run by hand. */
	below?: ReactNode;
	/** The step's actions, at the end of its row. */
	children?: ReactNode;
}

/** One step of first run: a ring that turns into a check mark, what the step is, and the way to do it. */
export function SetupStep({ name, detail, done, current, state, below, children }: SetupStepProps) {
	return (
		<div className="setup-step" data-current={current || undefined}>
			<SettingsRow
				leading={<StatusGlyph kind={done ? 'ok' : 'idle'} label={done ? 'Done' : 'To do'} />}
				name={name}
				detail={<SwapText mode="wait">{detail}</SwapText>}
				state={state}
			>
				{children}
			</SettingsRow>
			{below}
		</div>
	);
}
