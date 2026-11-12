import { ORCHESTRATOR_ID, type DiscussRequest, type DiscussResponse, type ReviewChatMessage } from '@recoder/shared';

import { bugReply, CHUNK_MS, pullReply, replyPieces, streamReply } from './sample-replies';
import type { SampleWorld } from './sample-world';

/** The sample's conversations: scripted replies streamed the way the server streams real ones. */
export function createSampleChat(world: SampleWorld) {
	const streams = new Map<string, { timer: ReturnType<typeof setTimeout>; finish: () => void }>();
	let sequence = 0;

	function messageId(): string {
		sequence += 1;

		return `sample-message-${sequence}`;
	}

	/** Puts a message in the review's conversation, or replaces it there, and sends the progress on. */
	function putMessage(reviewId: string, message: ReviewChatMessage): void {
		const progress = world.progressOf(reviewId);
		const others = (progress.messages ?? []).filter((item) => item.id !== message.id);

		world.publish(world.findReview(reviewId), { ...progress, messages: [...others, message] });
	}

	/** Streams the reply into the conversation a few words at a time. */
	function streamAnswer(reviewId: string, text: string): void {
		const pieces = replyPieces(text);

		const reply: ReviewChatMessage = {
			id: messageId(),
			assignmentId: ORCHESTRATOR_ID,
			from: 'assistant',
			text: '',
			at: new Date().toISOString(),
			status: 'streaming',
			discussion: true
		};

		let shown = 0;

		const finish = () => {
			streams.delete(reviewId);
			putMessage(reviewId, { ...reply, text: pieces.slice(0, shown).join(''), status: 'done' });
		};

		const next = () => {
			shown += 1;

			if (shown >= pieces.length) {
				finish();

				return;
			}

			putMessage(reviewId, { ...reply, text: pieces.slice(0, shown).join('') });
			streams.set(reviewId, { timer: setTimeout(next, CHUNK_MS), finish });
		};

		putMessage(reviewId, reply);
		streams.set(reviewId, { timer: setTimeout(next, CHUNK_MS), finish });
	}

	return {
		async sendChat(reviewId: string, text: string): Promise<ReviewChatMessage> {
			const message: ReviewChatMessage = {
				id: messageId(),
				assignmentId: ORCHESTRATOR_ID,
				from: 'user',
				text,
				at: new Date().toISOString(),
				status: 'done',
				discussion: true
			};

			putMessage(reviewId, message);
			streamAnswer(reviewId, pullReply(text));

			return message;
		},

		async stopChat(reviewId: string): Promise<void> {
			const stream = streams.get(reviewId);

			if (!stream) return;

			clearTimeout(stream.timer);
			stream.finish();
		},

		/** Answers a question about the finding at the request's file and line. */
		discuss(
			reviewId: string,
			input: DiscussRequest,
			onToken: (text: string) => void,
			signal: AbortSignal
		): Promise<DiscussResponse> {
			const finding = world
				.findReview(reviewId)
				.findings.find((item) => item.file === input.finding.file && (item.line ?? 1) === input.finding.line);

			return streamReply(bugReply(finding?.id ?? '', input.question), onToken, signal);
		}
	};
}
