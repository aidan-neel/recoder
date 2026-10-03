import { untrack } from 'svelte';
import { findingsStore, mapBackendFinding } from '$lib/findings/findings.svelte';
import { notesStore } from '$lib/findings/notes.svelte';
import { threadsStore } from '$lib/findings/threads.svelte';
import { addModelNotes, finishedReplies, startRequestedFixes } from './model-replies';
import type { SessionReview } from './session-review.svelte';

/** Slack (ms) for clock skew when deciding whether a reply started after the page opened. */
const REPLY_SKEW_MS = 2000;

/**
 * Feeds the findings, threads and notes stores from the session's review and the model's replies.
 * Construct it while a component initializes; it registers its own effects.
 */
export class SessionFindings {
	/**
	 * Findings belong to the current session only: backend reviews get exactly their own findings (synced once, so
	 * local dismiss and accept survive), demo sessions get the local set back. Never accumulate across reviews.
	 */
	#syncedFor = $state<string | null>(null);

	/** Replies whose ```recoder-fix requests already started. */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping read under untrack, not reactive
	readonly #fixedReplies = new Set<string>();

	/** Replies whose ```recoder-note blocks already became diff notes. */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping read under untrack, not reactive
	readonly #notedReplies = new Set<string>();

	/** Only replies started after this page opened can trigger fixes, so history never re-runs them. */
	readonly #openedAt = Date.now();

	constructor(private readonly data: SessionReview) {
		$effect(() => this.#startRequestedFixes());
		$effect(() => this.#addModelNotes());
		$effect(() => this.#syncFindings());
	}

	/** Forgets the previous session's findings, replies and fix batches. */
	reset(): void {
		this.#syncedFor = null;
		this.#notedReplies.clear();
		this.#fixedReplies.clear();
		findingsStore.fixBatches = {};
	}

	#startRequestedFixes(): void {
		const replies = finishedReplies(this.data.stream?.progress.messages, '```recoder-fix').filter(
			(message) => Date.parse(message.at) >= this.#openedAt - REPLY_SKEW_MS
		);

		if (!this.data.review) return;
		untrack(() => startRequestedFixes(replies, this.#fixedReplies));
	}

	#addModelNotes(): void {
		const files = this.data.files;
		const replies = finishedReplies(this.data.stream?.progress.messages, '```recoder-note');

		if (!files || !this.data.review || replies.length === 0) return;
		untrack(() => addModelNotes(replies, files, this.#notedReplies));
	}

	#syncFindings(): void {
		if (!this.data.checked) return;

		const review = this.data.review;

		if (this.data.isBackend && review) {
			threadsStore.reviewId = review.id;
			notesStore.reviewId = review.id;

			const mapped = review.findings.map((f, i) => mapBackendFinding(f, i));
			const terminal = review.status === 'passed' || review.status === 'failed';

			if (terminal) {
				if (this.#syncedFor !== review.id) {
					findingsStore.replaceAll(mapped);
					this.#syncedFor = review.id;
				}
			} else {
				findingsStore.syncRemote(mapped);
				this.#syncedFor = `live:${review.id}`;
			}
		} else {
			threadsStore.reviewId = null;

			if (this.#syncedFor !== 'local') {
				findingsStore.reset();
				this.#syncedFor = 'local';
			}
		}
	}
}
