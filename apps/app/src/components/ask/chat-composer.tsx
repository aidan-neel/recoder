'use client';

import { Composer, ComposerSend, ComposerStop, type ComposerCommand } from '@recoder/ui';
import type { ReactNode } from 'react';

import { useDraft } from '@/lib/ask/use-draft';
import type { ImageDraft } from '@/lib/compose/use-image-draft';
import { useLinkFacts } from '@/lib/pulls/use-link-facts';

import { AttachImages } from '@/components/compose/attach-images';

interface ChatComposerProps {
	/** What the field is for, read out by a screen reader. */
	label: string;
	placeholder: string;
	/** Sends the text. The field empties when it resolves; a rejection keeps the text so nothing typed is lost. */
	onSend: (text: string) => Promise<void>;
	/** True while a reply is arriving: nothing new sends, and with `onStop` the send becomes Stop. */
	busy?: boolean;
	onStop?: () => void;
	/** The longest text the server takes, in characters. */
	limit?: number;
	minRows?: number;
	layout?: 'stack' | 'row';
	/** What sending does, for a screen reader; "Send" by default. */
	sendLabel?: string;
	commands?: readonly ComposerCommand[];
	/** Quiet tools at the bar's start, given a way to add words to what is written. */
	tools?: (append: (words: string) => void) => ReactNode;
	/** Controls before the send: the model menu. */
	trailing?: ReactNode;
	/** The images this conversation takes: an attach tool, paste and drop, their tiles over the text and chips in it. */
	images?: ImageDraft;
}

/**
 * The kit composer with a draft of its own, for a conversation: Enter sends
 * what is written, which empties once it is taken. While a reply arrives the
 * send stops it. Text over the limit, or a refused send, says so in the bar.
 */
export function ChatComposer({
	label,
	placeholder,
	onSend,
	busy = false,
	onStop,
	limit,
	minRows,
	layout,
	sendLabel,
	commands,
	tools,
	trailing,
	images
}: ChatComposerProps) {
	const draft = useDraft({ onSend, limit, busy });
	const linkFacts = useLinkFacts();

	const action =
		busy && onStop ? (
			<ComposerStop onClick={onStop} />
		) : (
			<ComposerSend label={sendLabel} disabled={!draft.ready} pending={draft.sending} onClick={draft.send} />
		);

	return (
		<Composer
			label={label}
			placeholder={placeholder}
			value={draft.text}
			onValueChange={draft.setText}
			onSubmit={draft.send}
			minRows={minRows}
			layout={layout}
			invalid={draft.over}
			linkFacts={linkFacts}
			commands={commands}
			tools={
				<>
					{images ? <AttachImages onAttach={images.add} /> : null}
					{tools?.(draft.append)}
				</>
			}
			images={images?.images}
			onRemoveImage={images?.remove}
			onFiles={images?.add}
			trailing={trailing}
			note={images?.refusal ? { tone: 'danger', text: images.refusal } : draft.note}
			action={action}
		/>
	);
}
