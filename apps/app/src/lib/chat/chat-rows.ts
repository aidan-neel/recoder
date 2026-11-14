import type { ImageUpload, RepoChatMessage, StoredImage } from '@recoder/shared';
import type { ImageChip } from '@recoder/ui';

import { API_BASE } from '../api/http';

import { chatText } from '../ask/chat-text';
import type { AskMessageView } from '../ask/types';

/** A message sent from this page, shown at once and kept until the chat's events carry the server's copy. */
export interface Outgoing {
	key: string;
	text: string;
	state: 'pending' | 'sent' | 'failed';
	/** How many messages the chat had when this one was sent; its copy can only come after them. */
	after: number;
	/** The server's id for the message, once it accepted it. */
	serverId?: string;
	/** Why the server refused it. */
	error?: string;
	/** The images sent with it. */
	images?: ImageUpload[];
}

/** What an empty reply the person stopped says. */
const STOPPED_EMPTY = '_Stopped before it answered._';

/** What a reply that failed without a reason says. */
const NO_REASON = 'The reply stopped before it finished.';

const ROW_STATE: Record<RepoChatMessage['status'], AskMessageView['state']> = {
	streaming: 'writing',
	done: 'done',
	error: 'failed'
};

/**
 * The chat's messages as the thread shows them: the server's in order, then
 * what this page sent that the server's copy has not replaced yet. A copy is
 * the message with the id the send returned, or, while the send is still on
 * its way, the first later person's message with the same text, since the
 * server saves the message before it answers the send.
 */
export function chatRows(
	messages: readonly RepoChatMessage[],
	outbox: readonly Outgoing[],
	pullHref: (prNumber: number) => string
): AskMessageView[] {
	const claimed = new Set<string>();

	const waiting = outbox.filter((outgoing) => {
		const copy = messages.find(
			(message, index) =>
				!claimed.has(message.id) &&
				(message.id === outgoing.serverId ||
					(!outgoing.serverId &&
						outgoing.state !== 'failed' &&
						index >= outgoing.after &&
						message.from === 'user' &&
						message.text === outgoing.text))
		);

		if (copy) claimed.add(copy.id);

		return !copy;
	});

	return [
		...messages.map((message) => serverRow(message, pullHref)),
		...waiting.map((outgoing) => outgoingRow(outgoing))
	];
}

/**
 * True while a reply streams in, or a message is on its way and its reply has
 * not reached the thread yet: Send becomes Stop, and stays Stop between the
 * send's answer and the event that carries the reply.
 */
export function isReplying(messages: readonly RepoChatMessage[], outbox: readonly Outgoing[]): boolean {
	const isWaiting = (outgoing: Outgoing) =>
		outgoing.state === 'pending' ||
		(outgoing.state === 'sent' && !messages.some((message) => message.id === outgoing.serverId));

	return (
		messages.some((message) => message.from === 'assistant' && message.status === 'streaming') || outbox.some(isWaiting)
	);
}

/** The person's question before the message at `index` of the thread, to ask again. */
export function questionBefore(rows: readonly AskMessageView[], index: number): string | null {
	return rows.slice(0, index).findLast((row) => row.from === 'person')?.text ?? null;
}

function serverRow(message: RepoChatMessage, pullHref: (prNumber: number) => string): AskMessageView {
	if (message.from === 'user')
		return {
			id: message.id,
			from: 'person',
			text: message.text,
			state: 'done',
			error: null,
			at: message.at,
			images: message.images?.map(storedChip)
		};

	const state = ROW_STATE[message.status];

	return {
		id: message.id,
		from: 'recoder',
		text: replyText(message, pullHref),
		state,
		error: state === 'failed' ? (message.failure?.reason ?? NO_REASON) : null,
		at: message.at,
		trail: message.trail ?? [],
		citations: message.citations
	};
}

/** A reply as a person reads it: the model's Markdown repaired, a link to a review it started, or that it was stopped. */
function replyText(message: RepoChatMessage, pullHref: (prNumber: number) => string): string {
	if (message.stopped && !message.text.trim()) return STOPPED_EMPTY;

	const text = chatText(message.text, message.status !== 'streaming');

	if (!message.review) return text;

	return `${text}\n\n[Open #${message.review.prNumber}](${pullHref(message.review.prNumber)})`;
}

function outgoingRow(outgoing: Outgoing): AskMessageView {
	return {
		id: outgoing.key,
		from: 'person',
		text: outgoing.text,
		state: outgoing.state === 'failed' ? 'failed' : 'done',
		error: outgoing.error ?? null,
		at: null,
		images: outgoing.images?.map((image, index) => uploadChip(image, `${outgoing.key}-${index}`))
	};
}

/** A kept image as a chip: its thumbnail and full size both load from the API. */
function storedChip(image: StoredImage): ImageChip {
	const src = `${API_BASE}${image.url}`;

	return { id: image.id, name: image.name, src, href: src };
}

/** An image still on its way, shown from its own bytes until the server's copy replaces the message. */
function uploadChip(image: ImageUpload, id: string): ImageChip {
	return { id, name: image.name, src: `data:${image.type};base64,${image.data}` };
}
