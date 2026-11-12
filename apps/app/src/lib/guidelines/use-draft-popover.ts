'use client';

import { MAX_GUIDELINES_PROMPT_CHARS, type GuidelinesDraftRequest } from '@recoder/shared';
import { useState, type KeyboardEvent } from 'react';

/** What a repository draft may read besides the editor's text, each switchable. Findings cost tokens, so they start off. */
export const DRAFT_SOURCES = [
	{ key: 'instructions', label: 'Repo instruction files' },
	{ key: 'global', label: 'Global guidelines' },
	{ key: 'findings', label: 'Recent findings' }
] as const;

/** A draft source's key. */
type DraftSourceKey = (typeof DRAFT_SOURCES)[number]['key'];

/** The sources a repository draft reads, by key. */
type DraftSources = Record<DraftSourceKey, boolean>;

/** Everything the "Draft with Orchestrator" popover shows and does. */
export interface DraftPopoverView {
	open: boolean;
	setOpen: (open: boolean) => void;
	prompt: string;
	setPrompt: (prompt: string) => void;
	sources: DraftSources;
	/** Flips one source; only a repository draft reads them. */
	setSource: (key: DraftSourceKey, on: boolean) => void;
	/** The request field's placeholder, by what the draft will do. */
	placeholder: string;
	/** The request field's character limit. */
	maxLength: number;
	/** What the draft does to the editor's text. */
	hint: string;
	/** Sends the request and closes the popover; a landed draft clears the prompt. */
	submit: () => void;
	/** Enter submits, Shift+Enter breaks the line, and an IME composition never submits. */
	onPromptKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
	/** The trigger's click while a draft streams: it stops the draft instead of opening the popover. */
	onTriggerClick: (event: { preventDefault(): void }) => void;
}

/** The request field's prompt, by what the draft will do. */
function placeholderFor(repoId: string | null, revising: boolean): string {
	if (revising) return 'What should change? For example: stop flagging naming';

	return repoId
		? 'What should reviewers care about in this repo?'
		: 'What should reviewers care about in every review?';
}

/**
 * "Draft with Orchestrator": the request popover for the editor's draft
 * button. `onDraft` is the editor's `startDraft`; `onStop` its `stopDraft`,
 * which the trigger calls while a draft streams so focus never jumps.
 */
export function useDraftPopover({
	repoId,
	revising,
	streaming,
	onDraft,
	onStop
}: {
	/** Set for a repository's file; the global layer drafts from the prompt alone. */
	repoId: string | null;
	/** The editor already holds rules, so the draft revises them instead of starting over. */
	revising: boolean;
	/** A draft is streaming; the trigger stops it. */
	streaming: boolean;
	/** Starts a draft. Resolves true once it landed, which clears the request. */
	onDraft: (request: Omit<GuidelinesDraftRequest, 'current' | 'scope'>) => Promise<boolean>;
	onStop: () => void;
}): DraftPopoverView {
	const [open, setOpen] = useState(false);
	const [prompt, setPrompt] = useState('');
	const [sources, setSources] = useState<DraftSources>({ instructions: true, global: true, findings: false });

	function submit(): void {
		setOpen(false);

		void onDraft({
			prompt: prompt.trim(),
			repoId: repoId ?? undefined,
			include: repoId ? sources : { findings: false }
		}).then((landed) => {
			if (landed) setPrompt('');
		});
	}

	function onPromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
		if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;

		event.preventDefault();
		submit();
	}

	function onTriggerClick(event: { preventDefault(): void }): void {
		if (!streaming) return;

		event.preventDefault();
		onStop();
	}

	return {
		open,
		setOpen,
		prompt,
		setPrompt,
		sources,
		setSource: (key, on) => setSources((now) => ({ ...now, [key]: on })),
		placeholder: placeholderFor(repoId, revising),
		maxLength: MAX_GUIDELINES_PROMPT_CHARS,
		hint: revising ? 'Revises the text in the editor.' : 'Replaces the text in the editor.',
		submit,
		onPromptKeyDown,
		onTriggerClick
	};
}
