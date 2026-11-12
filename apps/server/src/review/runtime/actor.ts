import { setTimeout as delay } from 'node:timers/promises';
import { REVIEW_CANCELLED, settleAssignments } from '@recoder/shared';
import { coordinator, settingsOperation } from '../../storage/backend';
import { db, reviewProgress, settlePipelineStreams } from '../../store';
import { runReviewPipeline, touch } from '../../commands/pipeline';
import { cancelReviewChats, stopReviewChat, waitReviewChat, recordChatMessage } from '../chat/chat-replies';
import { startReviewChat } from '../chat/review-chat';
import { prepareDraftSession } from '../chat/draft-session';
import { emitReviewEvent, flushReviewEvents, settleReviewTasks } from '../session/events';
import { getReviewControl } from '../session/review-control';
import { withChatCommand } from './chat-context';
import { isRecoverableExit } from './execution';
import type { ReviewLease } from './ownership';
import type { ReviewCommand } from './commands';
import { recoverCompletion } from '../../commands/recover-completion';
import { progressWrites, metricWrites } from '../../storage/persistence-queue';
import { publishPullComment } from '../../forge/publish/pull-comment';
import { PublishConflictError } from '../../forge/publish/forge';

export async function executeReviewActor(lease: ReviewLease, signal: AbortSignal): Promise<void> {
	if (!coordinator) throw new Error('Shared review coordination is not configured.');

	const coordination = coordinator;

	progressWrites.delete(lease.reviewId);
	metricWrites.delete(lease.reviewId);

	const conversations = new Map<string, Promise<void>>();
	let pipeline: Promise<void> | undefined;
	let pipelineRunning = false;
	let failure: unknown;

	const interrupt = () => {
		getReviewControl(lease.reviewId)?.cancel(signal.reason instanceof Error ? signal.reason.message : undefined);
		cancelReviewChats(lease.reviewId, signal.reason);
	};

	signal.addEventListener('abort', interrupt, { once: true });

	const launchPipeline = () => {
		pipelineRunning = true;

		pipeline = settingsOperation(() => runReviewPipeline(lease.reviewId, signal))
			.catch((error: unknown) => {
				failure = error;
			})
			.finally(() => {
				pipelineRunning = false;
			});
	};

	const synchronize = async () => {
		const state = await coordination.state(lease);
		const control = getReviewControl(lease.reviewId);

		if (state === 'cancelled') {
			const reason = (await coordination.readCancellationReason(lease)) ?? REVIEW_CANCELLED;

			control?.cancel(reason);
			cancelReviewChats(lease.reviewId);

			const review = await db.reviews.get(lease.reviewId);

			if (!pipelineRunning && review && (review.status === 'queued' || review.status === 'running')) {
				await reviewProgress.update(lease.reviewId, (snapshot) =>
					snapshot
						? {
								...snapshot,
								paused: false,
								outcome: 'failed',
								assignments: settleAssignments(snapshot.assignments ?? [], reason)
							}
						: undefined
				);

				await settleReviewTasks(lease.reviewId, reason);

				const settled = await settlePipelineStreams(lease.reviewId);

				await touch(lease.reviewId, { status: 'failed', summary: reason });

				emitReviewEvent(lease.reviewId, {
					type: 'error',
					message: reason,
					data: {
						paused: false,
						...(settled ? { settled: { messages: settled.messages, reasoning: settled.reasoning } } : {})
					}
				});
			}
		} else {
			if (state === 'paused') control?.pause();
			else control?.resume();

			const snapshot = await reviewProgress.get(lease.reviewId);

			if ((snapshot?.paused ?? false) !== (state === 'paused')) {
				emitReviewEvent(lease.reviewId, {
					type: 'step',
					step: 'review',
					message: state === 'paused' ? 'Review paused' : 'Review resumed',
					data: { paused: state === 'paused' }
				});
			}
		}

		await flushReviewEvents(lease.reviewId);

		return state;
	};

	const startConversation = async (command: Extract<ReviewCommand, { kind: 'chat' | 'prepare-draft' }>) => {
		let accepted: () => void = () => undefined;
		let refused: (error: unknown) => void = () => undefined;

		const ready = new Promise<void>((resolve, reject) => {
			accepted = resolve;
			refused = reject;
		});

		const generation = settingsOperation(async () => {
			if (command.kind === 'prepare-draft') {
				accepted();
				await prepareDraftSession(lease.reviewId, command.opener);
			} else {
				await withChatCommand(command, () =>
					startReviewChat(lease.reviewId, command.assignmentId, command.text, command.codeContext)
				);

				accepted();
				await waitReviewChat(lease.reviewId, command.assignmentId);
			}

			await flushReviewEvents(lease.reviewId);
		})
			.catch(async (error: unknown) => {
				refused(error);
				if (isRecoverableExit(error) || signal.aborted) throw error;

				if (command.kind === 'chat') {
					emitReviewEvent(lease.reviewId, {
						type: 'message',
						message: '',
						data: {
							chatMessage: {
								id: `reply_${command.messageId}`,
								assignmentId: command.assignmentId,
								from: 'assistant',
								text: 'The model could not finish this reply. Check the reviewer model settings and try again.',
								at: new Date().toISOString(),
								status: 'error',
								discussion: true
							}
						}
					});

					await flushReviewEvents(lease.reviewId);
				}
			})
			.then(() => coordination.acknowledge(lease, command.id))
			.catch((error: unknown) => {
				failure = error;
			})
			.finally(() => {
				conversations.delete(command.id);
			});

		conversations.set(command.id, generation);
		await ready;
	};

	try {
		while (!signal.aborted) {
			if (failure) throw failure;

			const review = await db.reviews.get(lease.reviewId);
			const commands = await coordination.readCommands(lease);

			if (!review) {
				for (const { command } of commands) await coordination.acknowledge(lease, command.id);
				interrupt();

				return;
			}

			const state = await synchronize();

			if (
				pipeline === undefined &&
				(review.status === 'queued' || review.status === 'running') &&
				state !== 'cancelled'
			)
				launchPipeline();

			for (const { command, cancelled } of commands) {
				if (signal.aborted) break;

				if (cancelled && command.kind === 'chat') {
					stopReviewChat(lease.reviewId, command.assignmentId);
					if (conversations.has(command.id)) continue;

					const snapshot = await reviewProgress.get(lease.reviewId);
					const id = `reply_${command.messageId}`;
					const reply = snapshot?.messages?.find((message) => message.id === id);
					const text = reply?.text ?? '';

					recordChatMessage(lease.reviewId, {
						...reply,
						id,
						assignmentId: command.assignmentId,
						from: 'assistant',
						at: reply?.at ?? new Date().toISOString(),
						text: text.endsWith('Reply stopped.') ? text : `${text}${text ? '\n\n' : ''}Reply stopped.`,
						status: 'error',
						discussion: true
					});

					const reasoning = snapshot?.reasoning?.find((entry) => entry.id === `reason_${id}`);

					if (reasoning?.status === 'streaming') {
						emitReviewEvent(lease.reviewId, {
							type: 'reasoning',
							message: '',
							data: { reasoning: { ...reasoning, status: 'error' } }
						});
					}

					await flushReviewEvents(lease.reviewId);
					await coordination.acknowledge(lease, command.id);
					continue;
				}

				if (conversations.has(command.id)) continue;

				if (command.kind === 'chat' || command.kind === 'prepare-draft') {
					await startConversation(command);
					continue;
				}

				if (command.kind === 'stop-chat') stopReviewChat(lease.reviewId, command.assignmentId);

				if (['start', 'continue', 'rerun', 'replay'].includes(command.kind)) {
					const latest = await db.reviews.get(lease.reviewId);

					if (latest?.status === 'queued') {
						if (pipelineRunning) continue;
						launchPipeline();
					}
				}

				await coordination.acknowledge(lease, command.id);
			}

			if (!pipelineRunning && !conversations.size) {
				const current = await db.reviews.get(lease.reviewId);

				if (current?.status !== 'queued' && current?.status !== 'running') {
					if (current) await recoverCompletion(current);

					if (
						(current?.status === 'passed' || current?.status === 'failed') &&
						current.pullComment?.state === 'posting'
					) {
						try {
							await settingsOperation(() => publishPullComment(lease.reviewId));
						} catch (error) {
							const saved = await db.reviews.get(lease.reviewId);

							if (!(error instanceof PublishConflictError) && saved?.pullComment?.state !== 'failed') throw error;
						}
					}

					return;
				}
			}

			await delay(100, undefined, { signal }).catch((error: unknown) => {
				if (!signal.aborted) throw error;
			});
		}

		throw signal.reason;
	} finally {
		signal.removeEventListener('abort', interrupt);
		if (signal.aborted) interrupt();
		await Promise.allSettled([...(pipeline ? [pipeline] : []), ...conversations.values()]);
	}
}
