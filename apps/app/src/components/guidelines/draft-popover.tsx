'use client';

import type { GuidelinesDraftRequest } from '@recoder/shared';
import { Button, Checkbox, Keycap, Popover, PopoverContent, PopoverTrigger, SwapText, Textarea } from '@recoder/ui';
import { Sparkles, Square } from 'lucide-react';
import { useId } from 'react';

import { DRAFT_SOURCES, useDraftPopover, type DraftPopoverView } from '@/lib/guidelines/use-draft-popover';

interface DraftPopoverProps {
	/** Set for a repository's file; the global layer drafts from the request alone. */
	repoId: string | null;
	/** The editor already holds rules, so the draft revises them. */
	revising: boolean;
	/** A draft is streaming; the button stops it. */
	streaming: boolean;
	/** A save is with the server, so no draft may start. */
	disabled: boolean;
	/** Starts a draft. Resolves true once it landed in the editor. */
	onDraft: (request: Omit<GuidelinesDraftRequest, 'current' | 'scope'>) => Promise<boolean>;
	onStop: () => void;
}

/** What a repository draft may read besides the editor's text, each one a checkbox. */
function Sources({ view }: { view: DraftPopoverView }) {
	return (
		<fieldset className="guidelines-sources">
			<legend className="section-label">Sources</legend>
			{DRAFT_SOURCES.map((source) => (
				<label key={source.key} className="guidelines-source">
					<Checkbox
						checked={view.sources[source.key]}
						onCheckedChange={(checked) => view.setSource(source.key, checked)}
					/>
					{source.label}
				</label>
			))}
		</fieldset>
	);
}

/**
 * Draft with AI: a popover for the request (and, for a repository, what the
 * draft may read) that opens above the editor's bar. While a draft streams
 * the same button stops it, so focus never jumps.
 */
export function DraftPopover({ repoId, revising, streaming, disabled, onDraft, onStop }: DraftPopoverProps) {
	const view = useDraftPopover({ repoId, revising, streaming, onDraft, onStop });
	const hintId = useId();

	return (
		<Popover open={view.open} onOpenChange={view.setOpen}>
			<PopoverTrigger>
				<Button
					variant="quiet"
					className="guidelines-quiet guidelines-draft"
					disabled={disabled}
					aria-label={streaming ? 'Stop the draft' : undefined}
					onClick={view.onTriggerClick}
				>
					<SwapText id={streaming ? 'stop' : 'draft'} textClassName="guidelines-draft-face">
						{streaming ? <Square aria-hidden data-glyph="stop" /> : <Sparkles aria-hidden />}
						{streaming ? 'Stop' : 'Draft with AI'}
					</SwapText>
				</Button>
			</PopoverTrigger>
			<PopoverContent side="top" align="start" className="guidelines-draft-panel">
				<Textarea
					autosize
					minRows={3}
					maxRows={8}
					value={view.prompt}
					placeholder={view.placeholder}
					aria-label="What the draft should cover"
					aria-describedby={hintId}
					maxLength={view.maxLength}
					onChange={(event) => view.setPrompt(event.target.value)}
					onKeyDown={view.onPromptKeyDown}
				/>
				{repoId ? <Sources view={view} /> : null}
				<div className="guidelines-draft-end">
					<p id={hintId} className="guidelines-draft-hint">
						{view.hint}
					</p>
					<Button variant="primary" aria-keyshortcuts="Enter" onClick={view.submit}>
						Draft
						<Keycap k="Enter" />
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}
