'use client';

import type { ComposerMenuItem } from '@recoder/ui';

import type { AskView } from '@/lib/ask/types';

import { AttachFile } from './attach-file';
import { ChatComposer } from './chat-composer';
import { ComposerModels } from './model-menu';

/**
 * The composer under an Ask about a pull request or one of its bugs: send
 * and stop, its "/" commands, a changed file to attach and the models, and
 * with `skills` the skills "/" offers beside the commands. `label` names what is asked about
 * and doubles as the placeholder.
 */
export function AskComposer({
	ask,
	label,
	skills
}: {
	ask: AskView;
	label: string;
	skills?: readonly ComposerMenuItem[];
}) {
	return (
		<ChatComposer
			label={label}
			placeholder={label}
			limit={ask.limit}
			busy={ask.replying}
			onStop={ask.stop}
			onSend={ask.send}
			commands={ask.commands}
			skills={skills}
			tools={(append) => <AttachFile onAttach={append} />}
			trailing={<ComposerModels />}
		/>
	);
}
