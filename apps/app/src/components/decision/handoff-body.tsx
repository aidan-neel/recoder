'use client';

import {
	Button,
	CodeBlock,
	Keycap,
	ModalBody,
	ModalClose,
	ModalFooter,
	ModalTitle,
	StatusGlyph,
	Textarea
} from '@recoder/ui';
import { useMemo, type ReactNode } from 'react';

import { handoffPrompt, sentItems } from '@/lib/review/handoff';
import { plain, where } from '@/lib/review/labels';
import { surfaceOf, useReview } from '@/lib/review/review-store';
import type { Decision } from '@/lib/review/surface';

import { useNote } from './decision-state';

/** What the button that copies the prompt says, before and after the copy. */
export const COPY_PROMPT = { label: 'Copy prompt', copiedLabel: 'Copied' } as const;

/** One sent-back item: its tone, title and place, and a note that rides along in the prompt. */
function HandoffItem({ decision }: { decision: Decision }) {
	const [note, setNote] = useNote(decision.id);

	return (
		<li className="flex gap-3">
			<StatusGlyph kind={decision.tone} className="mt-0.5" />
			<div className="flex min-w-0 flex-1 flex-col gap-[3px]">
				<span className="text-[13.5px] text-fg">{plain(decision.title)}</span>
				<span className="truncate font-mono text-[11.5px] text-fg-faint">
					{where(decision.file, decision.line, decision.endLine)}
				</span>
				<Textarea
					autosize
					minRows={1}
					maxRows={6}
					className="handoff-note mt-1.5"
					placeholder="Add a note for the agent"
					aria-label={`Note for ${plain(decision.title)}`}
					value={note}
					onChange={(event) => setNote(event.target.value)}
				/>
			</div>
		</li>
	);
}

/** Everything sent back, in rail order, and the prompt that hands it to the author agent. */
function useHandoff() {
	const surface = useReview(surfaceOf);
	const records = useReview((store) => store.records);
	const review = useReview((store) => store.review);
	const pull = useReview((store) => store.pull);
	const items = useMemo(() => sentItems(surface?.decisions ?? [], records), [surface, records]);

	const prompt = handoffPrompt(
		{
			number: review?.prNumber ?? pull?.number ?? 0,
			title: review?.prTitle ?? pull?.title ?? '',
			branch: pull?.headRef ?? null
		},
		items
	);

	return { items, prompt };
}

interface HandoffBodyProps {
	/** The control that copies the prompt, shown once something is sent back. */
	copy: (prompt: string) => ReactNode;
}

/**
 * The handoff: its title, each sent-back item with its note, the prompt,
 * then Close and the copy control. It sits inside a kit `Modal`, which names
 * it; the app's modal panel frames it, and so does the site's demo window.
 */
export function HandoffBody({ copy }: HandoffBodyProps) {
	const { items, prompt } = useHandoff();

	return (
		<>
			<ModalTitle>Hand off to the agent</ModalTitle>
			<ModalBody>
				{items.length === 0 ? (
					<p className="text-[13.5px] leading-[1.6] text-fg-subtle">
						<span className="text-fg">Nothing is sent back yet.</span> Send back a decision with{' '}
						<Keycap k="s" aria-hidden={false} /> and it lands here with your note.
					</p>
				) : (
					<>
						<ol className="flex flex-col gap-3.5">
							{items.map(({ decision }) => (
								<HandoffItem key={decision.id} decision={decision} />
							))}
						</ol>
						<div className="handoff-prompt">
							<div className="flex items-baseline justify-between gap-3 border-b border-line-divider px-3 py-[9px] text-[12px] font-medium text-fg-muted">
								<span>Prompt</span>
								<span className="truncate font-normal text-fg-faint">
									Paste it into the agent that opened the pull request.
								</span>
							</div>
							<CodeBlock
								code={prompt}
								wrap
								className="rounded-none bg-transparent text-[12px] leading-[1.6] shadow-none"
							/>
						</div>
					</>
				)}
			</ModalBody>
			<ModalFooter>
				<ModalClose>
					<Button
						variant={items.length === 0 ? 'outline' : 'ghost'}
						data-close=""
						className={items.length ? 'mr-auto' : ''}
					>
						Close
					</Button>
				</ModalClose>
				{items.length > 0 ? copy(prompt) : null}
			</ModalFooter>
		</>
	);
}
