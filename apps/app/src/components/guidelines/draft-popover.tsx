'use client';

import { MAX_GUIDELINES_PROMPT_CHARS, type GuidelinesDraftRequest } from '@recoder/shared';
import {
	Button,
	Checkbox,
	Keycap,
	Popover,
	PopoverContent,
	PopoverTrigger,
	swapMotion,
	Textarea,
	useMotionVariants
} from '@recoder/ui';
import { Sparkles } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState, type KeyboardEvent } from 'react';

/** What a repository draft may read besides the editor's text. Findings cost tokens, so they start off. */
const SOURCES = [
	{ key: 'instructions', label: 'Repo instruction files' },
	{ key: 'global', label: 'Global guidelines' },
	{ key: 'findings', label: 'Recent findings' }
] as const;

type Sources = Record<(typeof SOURCES)[number]['key'], boolean>;

interface DraftPopoverProps {
	/** Set for a repository's file; the global layer drafts from the prompt alone. */
	repoId: string | null;
	/** The editor already holds rules, so the draft revises them instead of starting over. */
	revising: boolean;
	streaming: boolean;
	/** A save is running, so no draft may start. */
	disabled: boolean;
	/** Starts a draft. Resolves true once it landed, which clears the request. */
	onDraft: (request: Omit<GuidelinesDraftRequest, 'current' | 'scope'>) => Promise<boolean>;
	onStop: () => void;
}

/** The request field's prompt, by what the draft will do. */
function placeholderFor(repoId: string | null, revising: boolean): string {
	if (revising) return 'What should change? For example: stop flagging naming';

	return repoId
		? 'What should reviewers care about in this repo?'
		: 'What should reviewers care about in every review?';
}

/**
 * "Draft with Orchestrator": a popover for the request (and, for a
 * repository, what the draft may read), opening above the editor's bar.
 * While a draft streams, the same button stops it, so focus never jumps.
 */
export function DraftPopover({ repoId, revising, streaming, disabled, onDraft, onStop }: DraftPopoverProps) {
	const swap = useMotionVariants(swapMotion);
	const [open, setOpen] = useState(false);
	const [prompt, setPrompt] = useState('');
	const [sources, setSources] = useState<Sources>({ instructions: true, global: true, findings: false });

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

	function onKey(event: KeyboardEvent<HTMLTextAreaElement>): void {
		if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;

		event.preventDefault();
		submit();
	}

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger>
				<Button
					variant="quiet"
					className="guidelines-draft"
					disabled={disabled}
					aria-label={streaming ? 'Stop the draft' : undefined}
					onClick={(event) => {
						if (!streaming) return;

						event.preventDefault();
						onStop();
					}}
				>
					<AnimatePresence initial={false} mode="popLayout">
						<motion.span
							key={streaming ? 'stop' : 'draft'}
							className="flex items-center gap-1.5"
							variants={swap}
							initial="initial"
							animate="animate"
							exit="exit"
						>
							{streaming ? <span className="guidelines-stop-glyph" aria-hidden /> : <Sparkles aria-hidden />}
							{streaming ? 'Stop' : 'Draft with Orchestrator'}
						</motion.span>
					</AnimatePresence>
				</Button>
			</PopoverTrigger>
			<PopoverContent side="top" align="start" className="guidelines-draft-panel">
				<Textarea
					autosize
					minRows={2}
					maxRows={6}
					value={prompt}
					placeholder={placeholderFor(repoId, revising)}
					aria-label="What the draft should cover"
					maxLength={MAX_GUIDELINES_PROMPT_CHARS}
					onChange={(event) => setPrompt(event.target.value)}
					onKeyDown={onKey}
				/>
				<p className="guidelines-draft-hint">
					{revising ? 'Revises the text in the editor.' : 'Replaces the text in the editor.'}
				</p>
				{repoId ? (
					<fieldset className="guidelines-sources">
						<legend className="guidelines-sources-title">Sources</legend>
						{SOURCES.map((source) => (
							<label key={source.key} className="guidelines-source">
								<Checkbox
									checked={sources[source.key]}
									onCheckedChange={(checked) => setSources((now) => ({ ...now, [source.key]: checked }))}
								/>
								{source.label}
							</label>
						))}
					</fieldset>
				) : null}
				<div className="flex justify-end">
					<Button variant="primary" aria-keyshortcuts="Enter" onClick={submit}>
						Draft <Keycap k="Enter" />
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}
