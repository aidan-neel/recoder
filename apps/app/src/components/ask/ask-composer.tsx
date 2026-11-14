'use client';

import type { AskView } from '@/lib/ask/types';

import { AttachFile } from './attach-file';
import { ChatComposer } from './chat-composer';
import { ComposerModels } from './model-menu';

/**
 * The composer under an Ask about a pull request or one of its bugs: send
 * and stop, its "/" commands, a changed file to attach and the models.
 * `label` names what is asked about and doubles as the placeholder.
 */
export function AskComposer({ ask, label }: { ask: AskView; label: string }) {
	return (
		<ChatComposer
			label={label}
			placeholder={label}
			limit={ask.limit}
			busy={ask.replying}
			onStop={ask.stop}
			onSend={ask.send}
			commands={ask.commands}
			tools={(append) => <AttachFile onAttach={append} />}
			trailing={<ComposerModels />}
		/>
	);
}
