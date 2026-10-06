import { untrack } from 'svelte';
import { diffPrefs } from '$lib/diff/diff-prefs.svelte';
import { revealDiffLine } from '$lib/diff/reveal-line';
import { findingsStore } from '$lib/findings/findings.svelte';
import { compareSeverity } from '$lib/findings/severity';
import { collapseFileDiff, type DiffLine, type FileDiff } from '@recoder/shared';
import { sessionFile } from './session-file.svelte';
import type { SessionReview } from './session-review.svelte';

/** Every line a finding on this file covers; the trimmed diff keeps them visible. */
export function findingLines(path: string): number[] {
	return findingsStore
		.forFile(path)
		.flatMap((finding) =>
			Array.from({ length: finding.endLine - finding.startLine + 1 }, (_, i) => finding.startLine + i)
		);
}

/** Jumping to a line the trimmed diff hides switches to the full file. */
export function showDiffLine(files: FileDiff[] | null, path: string, line: number | null, side: 'old' | 'new'): void {
	const diff = files?.find((file) => file.path === path);
	const lineOf = (row: DiffLine) => (side === 'old' ? row.oldNo : row.newNo);

	if (line === null || !diff || diffPrefs.fullFile) return;
	if (!collapseFileDiff(diff, findingLines(path)).hunks.some((hunk) => hunk.lines.some((row) => lineOf(row) === line)))
		diffPrefs.setFullFile(true);
}

/**
 * Which file the diff shows. The strongest open finding's file wins over the alphabetic first file,
 * and any explicit pick by the user sticks. Construct it while a component initializes; it registers its own effects.
 */
export class FileFocus {
	userPicked = $state(false);
	#lastAuto = $state<string | null>(null);

	/** The review whose diff already jumped to its first finding during this visit. */
	#firstFindingFor: string | null = null;

	constructor(
		private readonly data: SessionReview,
		private readonly getView: () => 'findings' | 'diff' | null
	) {
		$effect(() => this.#noticeUserPick());
		$effect(() => this.#autoPick());
		$effect(() => this.#openFirstFinding());
	}

	/** Forgets the previous session's picks. */
	reset(): void {
		this.#lastAuto = null;
		this.userPicked = false;
		this.#firstFindingFor = null;
	}

	/** Selects a file as the user's own choice. */
	pick(file: string): void {
		sessionFile.select(file);
		this.userPicked = true;
	}

	/** {@link showDiffLine} on this review's files. */
	showLine(path: string, line: number | null, side: 'old' | 'new' = 'new'): void {
		showDiffLine(this.data.files, path, line, side);
	}

	/** Selections that didn't come from the auto-picker are the user's choice. */
	#noticeUserPick(): void {
		const current = sessionFile.currentId;

		if (this.#lastAuto !== null && current !== this.#lastAuto) this.userPicked = true;
	}

	#autoPick(): void {
		const files = this.data.files;

		if (!this.data.isBackend || !this.data.review || !files || files.length === 0) return;
		if (this.userPicked) return;

		const open = findingsStore.items.filter((f) => f.status !== 'dismissed' && untrack(() => findingsStore.isShown(f)));

		open.sort((a, b) => compareSeverity(a, b) || a.startLine - b.startLine);

		let target = findingsStore.active?.file ?? open[0]?.file ?? files[0].path;

		if (!files.some((f) => f.path === target)) target = files[0].path;

		if (target !== sessionFile.currentId) {
			this.#lastAuto = target;
			sessionFile.select(target);
		} else if (this.#lastAuto === null) {
			this.#lastAuto = target;
		}
	}

	/**
	 * Opening the diff of a finished review lands on its first finding, in the stepper's order (file, then line),
	 * once per visit. Findings load after the review, so it waits for them. A finding the user opened wins.
	 */
	#openFirstFinding(): void {
		const review = this.data.review;
		const files = this.data.files;

		if (!review || this.getView() !== 'diff' || !files?.length || this.#firstFindingFor === review.id) return;
		if (review.status !== 'passed' && review.status !== 'failed') return;

		const first = findingsStore.items
			.filter(
				(f) =>
					f.status !== 'dismissed' &&
					untrack(() => findingsStore.isShown(f)) &&
					files.some((file) => file.path === f.file)
			)
			.sort((a, b) => a.file.localeCompare(b.file) || a.startLine - b.startLine || a.id.localeCompare(b.id))[0];

		if (!first) return;
		this.#firstFindingFor = review.id;

		untrack(() => {
			if (this.userPicked || findingsStore.activeId) return;
			findingsStore.discuss(first.id);
			this.#lastAuto = first.file;
			sessionFile.select(first.file);
			this.showLine(first.file, first.startLine);
			revealDiffLine(first.startLine);
		});
	}
}
