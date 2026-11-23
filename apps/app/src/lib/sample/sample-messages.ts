import {
	MESSAGE_PAGE,
	type Conversation,
	type DirectMessage,
	type InboxEvent,
	type PersonSummary,
	type SendMessageInput
} from '@recoder/shared';

import type { StreamHandlers } from '../api/event-stream';
import { ApiError } from '../api/http';
import type { MessagesApi } from '../api/messages';
import { sampleTime } from './sample-clock';
import { SAMPLE_PEOPLE, SAMPLE_SELF_ID } from './sample-people';

interface SampleThread {
	id: string;
	with: PersonSummary;
	messages: DirectMessage[];
	readSequence: number;
	theirReadSequence: number;
	createdAt: string;
}

/** What each person answers the first message they get from the visitor, so the sample shows a reply arriving. */
const ANSWERS: Record<string, string> = {
	'sample-ana': 'Thanks, I’ll look after lunch.',
	'sample-jonas': 'On it. I’ll run the review again once the fix is up.',
	'sample-mira': 'Sounds good to me.',
	'sample-tomas': 'Noted, I’ll check it on the GitLab side.'
};

/** How long a sample person takes to read a message, then to answer it. */
const READ_MS = 1200;
const ANSWER_MS = 2600;

function person(accountId: string): PersonSummary {
	const found = SAMPLE_PEOPLE.find((candidate) => candidate.accountId === accountId);

	if (!found) throw new ApiError('That person can’t be messaged.', 409);

	return found;
}

/** The sample's story: Ana asked something an hour ago, Mira and the visitor talked about #214, Jonas has the visitor's last word. */
function seedThreads(): SampleThread[] {
	const thread = (
		accountId: string,
		lines: [string, string, string][],
		read: number,
		theirRead: number
	): SampleThread => {
		const id = `dm-${accountId}`;

		return {
			id,
			with: person(accountId),
			messages: lines.map(([author, at, body], index) => ({
				id: `${id}-${index + 1}`,
				conversationId: id,
				sequence: index + 1,
				authorId: author,
				clientId: `${id}-seed-${index + 1}`,
				body,
				attachments: [],
				createdAt: sampleTime(at)
			})),
			readSequence: read,
			theirReadSequence: theirRead,
			createdAt: sampleTime(lines[0][1])
		};
	};

	return [
		thread(
			'sample-ana',
			[
				[
					'sample-ana',
					'2026-10-13T09:44:00.000Z',
					'Is the edge cache change safe to ship today? The review left one warning.'
				]
			],
			0,
			0
		),
		thread(
			'sample-mira',
			[
				[SAMPLE_SELF_ID, '2026-10-13T08:42:00.000Z', 'Can you look at the tenant header bug before I merge?'],
				[
					'sample-mira',
					'2026-10-13T08:51:00.000Z',
					'The review is right: requests without x-tenant-id all land in one bucket. Pushing a fix in 10.'
				],
				['sample-mira', '2026-10-13T08:51:30.000Z', 'The refill one is fine, the window is per minute on purpose.'],
				[SAMPLE_SELF_ID, '2026-10-13T08:52:00.000Z', 'Great, I’ll review it again once it’s up.']
			],
			4,
			4
		),
		thread(
			'sample-jonas',
			[[SAMPLE_SELF_ID, '2026-10-12T16:10:00.000Z', 'Can you re-run the billing review when you get a minute?']],
			1,
			0
		)
	];
}

/** The sample's direct messages, in memory, with a reply arriving a moment after the visitor writes to someone. */
export function createSampleMessages(): MessagesApi {
	const threads = seedThreads();
	const followers = new Set<StreamHandlers<InboxEvent>>();
	const answered = new Set<string>();
	let cursor = 0;

	function view(thread: SampleThread): Conversation {
		const last = thread.messages.at(-1) ?? null;

		return structuredClone({
			id: thread.id,
			with: thread.with,
			open: true,
			lastMessage: last,
			lastSequence: last?.sequence ?? 0,
			readSequence: thread.readSequence,
			theirReadSequence: thread.theirReadSequence,
			unread: thread.messages.filter((m) => m.sequence > thread.readSequence && m.authorId !== SAMPLE_SELF_ID).length,
			createdAt: thread.createdAt,
			updatedAt: last?.createdAt ?? thread.createdAt
		});
	}

	function find(id: string): SampleThread {
		const thread = threads.find((candidate) => candidate.id === id);

		if (!thread) throw new ApiError('Conversation not found.', 404);

		return thread;
	}

	function emit(event: InboxEvent): void {
		for (const handlers of followers) handlers.onMessage(structuredClone(event));
	}

	function append(thread: SampleThread, authorId: string, input: SendMessageInput): DirectMessage {
		const message: DirectMessage = {
			id: `${thread.id}-${thread.messages.length + 1}`,
			conversationId: thread.id,
			sequence: thread.messages.length + 1,
			authorId,
			clientId: input.clientId,
			body: input.body.trim(),
			attachments: input.attachments,
			createdAt: new Date().toISOString()
		};

		thread.messages.push(message);

		if (authorId === SAMPLE_SELF_ID) thread.readSequence = message.sequence;

		cursor += 1;
		emit({ type: 'message', cursor, conversation: view(thread), message });

		return message;
	}

	/** The other person reads the visitor's message, then answers it once. */
	function playAnswer(thread: SampleThread): void {
		setTimeout(() => {
			thread.theirReadSequence = thread.messages.length;
			cursor += 1;
			emit({ type: 'read', cursor, conversation: view(thread) });
		}, READ_MS);

		if (answered.has(thread.id)) return;

		answered.add(thread.id);

		setTimeout(() => {
			append(thread, thread.with.accountId, {
				clientId: `${thread.id}-answer`,
				body: ANSWERS[thread.with.accountId],
				attachments: []
			});
		}, ANSWER_MS);
	}

	const sorted = () => [...threads].sort((a, b) => view(b).updatedAt.localeCompare(view(a).updatedAt)).map(view);

	return {
		list: async () => sorted(),

		async start(accountId) {
			const existing = threads.find((thread) => thread.with.accountId === accountId);

			if (existing) return view(existing);

			const thread: SampleThread = {
				id: `dm-${accountId}`,
				with: person(accountId),
				messages: [],
				readSequence: 0,
				theirReadSequence: 0,
				createdAt: new Date().toISOString()
			};

			threads.push(thread);

			return view(thread);
		},

		async page(id, before) {
			const thread = find(id);
			const older = thread.messages.filter((m) => before === undefined || m.sequence < before);
			const messages = older.slice(-MESSAGE_PAGE);

			return {
				conversation: view(thread),
				messages: structuredClone(messages),
				before: older.length > messages.length ? messages[0].sequence : null
			};
		},

		async send(id, input) {
			const thread = find(id);
			const repeated = thread.messages.find((m) => m.authorId === SAMPLE_SELF_ID && m.clientId === input.clientId);

			if (repeated) return structuredClone(repeated);

			const message = append(thread, SAMPLE_SELF_ID, input);

			playAnswer(thread);

			return structuredClone(message);
		},

		async read(id, through) {
			const thread = find(id);

			if (through > thread.readSequence) {
				thread.readSequence = Math.min(through, thread.messages.length);
				cursor += 1;
				emit({ type: 'read', cursor, conversation: view(thread) });
			}

			return view(thread);
		},

		follow(handlers) {
			followers.add(handlers);
			handlers.onConnection('live');
			handlers.onMessage({ type: 'snapshot', cursor, conversations: sorted() });

			return () => {
				followers.delete(handlers);
				handlers.onConnection('closed');
			};
		}
	};
}
