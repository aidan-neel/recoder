import {
	ORCHESTRATOR_ID,
	type ReviewAssignment,
	type ReviewChatMessage,
	type ReviewReasoningEntry,
	type ReviewTask
} from '@recoder/shared';
import { countFailedSpecialists, footerLabel, isLive } from './reviewing-view';

/** The review snapshot the reviewing view renders. */
export interface ReviewingInput {
	assignments: ReviewAssignment[];
	messages: ReviewChatMessage[];
	reasoning: ReviewReasoningEntry[];
	tasks: ReviewTask[];
	orchestratorModel?: string;
	active: boolean;
	failed: boolean;
	awaitingPrompt: boolean;
	paused: boolean;
	stage: number;
	stageLabel: string;
	stageDetail?: string;
}

/** What a review's live state means for the conversation page: who is working, which stage shows, and what to say. */
export class ReviewingState {
	readonly #source: ReviewingInput;

	/** `input` exposes the props as getters, so each derived value tracks only the props it reads. */
	constructor(input: ReviewingInput) {
		this.#source = input;
	}

	/** Read lazily, as derived values are, after the constructor has run. */
	get #input(): ReviewingInput {
		return this.#source;
	}

	/** A new session opens on a card with Run full review until the developer says something. */
	readonly showIntro = $derived.by(() => {
		const { awaitingPrompt, messages } = this.#input;

		return (
			awaitingPrompt &&
			!messages.some(
				(message) => (message.assignmentId ?? ORCHESTRATOR_ID) === ORCHESTRATOR_ID && message.from === 'user'
			)
		);
	});

	readonly specialists = $derived(this.#input.assignments.filter((assignment) => assignment.id !== ORCHESTRATOR_ID));

	readonly failedSpecialists = $derived(countFailedSpecialists(this.specialists));

	/** The orchestrator as a conversation of its own, with the model it last ran on. */
	readonly orchestrator = $derived.by((): ReviewAssignment => {
		const { awaitingPrompt, active, failed, orchestratorModel, assignments, messages, reasoning } = this.#input;

		return {
			id: ORCHESTRATOR_ID,
			role: 'orchestrator',
			title: 'Orchestrator',
			reason: '',
			scope: [],
			status: awaitingPrompt ? 'waiting' : active ? 'running' : failed ? 'error' : 'done',
			model:
				orchestratorModel ??
				assignments.find((item) => item.id === ORCHESTRATOR_ID)?.model ??
				messages.findLast((item) => item.assignmentId === ORCHESTRATOR_ID && item.model)?.model ??
				reasoning.findLast((item) => (!item.assignmentId || item.assignmentId === ORCHESTRATOR_ID) && item.model)?.model
		};
	});

	readonly finished = $derived(!this.#input.active && !this.#input.failed && !this.#input.awaitingPrompt);

	readonly showSteps = $derived(!this.#input.awaitingPrompt && (this.#input.active || this.#input.failed));

	/** When the first specialist was queued, where the plan's specialists sit in the transcript. */
	readonly specialistsAt = $derived(
		this.specialists
			.map((item) => item.queuedAt ?? item.startedAt)
			.filter((at): at is string => !!at)
			.sort()[0]
	);

	readonly running = $derived(this.specialists.filter((item) => isLive(item.status)));

	/** Specialists a model is actually working for; queued ones are waiting on the stage before them. */
	readonly working = $derived(
		this.specialists.filter((item) => item.status === 'running' || item.status === 'waiting')
	);

	readonly finalization = $derived(this.#input.tasks.find((task) => task.id === 'consolidation'));

	/** The orchestrator's thinking since finalization started; it shows in the finalize step, not the chat. */
	readonly finalReasoning = $derived.by(() => {
		const startedAt = this.finalization?.startedAt;

		return this.#input.reasoning.filter(
			(entry) =>
				(entry.assignmentId ?? ORCHESTRATOR_ID) === ORCHESTRATOR_ID &&
				startedAt &&
				Date.parse(entry.at) >= Date.parse(startedAt)
		);
	});

	readonly chatReasoning = $derived(
		this.#input.reasoning.filter((entry) => !this.finalReasoning.some((item) => item.id === entry.id))
	);

	/** Verifiers work in the threads of the specialists whose findings they check; here they show as one live step. */
	readonly verifying = $derived(this.#input.active && this.#input.stage === 4);

	readonly verifications = $derived(this.#input.tasks.filter((task) => task.kind === 'verification'));

	readonly currentStep = $derived(!this.#input.active && !this.#input.failed ? 6 : Math.min(this.#input.stage, 5));

	/** Early stages (checkout, inventory, planning) have nothing to open, and the live thinking and tool rows already show the work. */
	readonly showProgress = $derived(
		!this.#input.active || this.running.length > 0 || this.verifying || !!this.finalization
	);

	/** Checkout and dependency install have no transcript of their own; until the orchestrator speaks, a loading card stands in. */
	readonly setupTask = $derived(this.#input.tasks.find((task) => task.id === 'setup' && task.status === 'running'));

	readonly orchestratorSpoke = $derived(
		this.#input.messages.some(
			(message) => (message.assignmentId ?? ORCHESTRATOR_ID) === ORCHESTRATOR_ID && message.from === 'assistant'
		) || this.#input.reasoning.some((entry) => entry.assignmentId === ORCHESTRATOR_ID)
	);

	/** Whether the orchestrator's transcript shows the checkout or setup card. */
	readonly preparing = $derived.by(() => {
		const { active, awaitingPrompt, failed, stage } = this.#input;

		return active && !awaitingPrompt && !failed && (stage === 0 || (!!this.setupTask && !this.orchestratorSpoke));
	});

	readonly progressLabel = $derived.by(() => {
		const { paused, stage, stageLabel, stageDetail } = this.#input;

		return footerLabel({
			paused,
			stage,
			stageLabel,
			stageDetail,
			verifying: this.verifying,
			verifications: this.verifications,
			working: this.working,
			running: this.running
		});
	});
}
