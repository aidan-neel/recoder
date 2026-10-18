'use client';

import { prettyModelName, type ReviewMetrics, type TokenAggregate, type TokenStage } from '@recoder/shared';
import {
	Button,
	Meter,
	Modal,
	ModalBody,
	ModalClose,
	ModalContent,
	ModalFooter,
	ModalTitle,
	Skeleton
} from '@recoder/ui';
import { useEffect, useRef, useState, type RefObject } from 'react';

import { failureText } from '@/lib/api/http';
import { reviewsApi } from '@/lib/api/reviews';
import { useReview } from '@/lib/review/review-store';
import { useAction } from '@/lib/shell/use-action';

const NUMBER = new Intl.NumberFormat('en-US');

/** The kinds of agent that spend tokens, as the modal names them. */
const STAGE_LABEL: Record<TokenStage, string> = {
	reviewer: 'Reviewers',
	subagent: 'Subagents',
	'second-look': 'Second look',
	investigator: 'Investigators',
	worker: 'Workers',
	verifier: 'Verifiers',
	repair: 'Repair',
	intent: 'Intent',
	ledger: 'Rule ledger',
	other: 'Other'
};

type Load =
	{ status: 'loading' } | { status: 'ready'; metrics: ReviewMetrics | null } | { status: 'error'; message: string };

/** The review's token counts as a load result; a failed read becomes the error result, never a rejection. */
function readUsage(id: string): Promise<Load> {
	return reviewsApi.metrics(id).then(
		(metrics): Load => ({ status: 'ready', metrics }),
		(error: unknown): Load => ({ status: 'error', message: failureText(error) })
	);
}

/** A count, or a dash when the provider reported none. */
function tokens(count: number | null): string {
	return count === null ? '—' : NUMBER.format(count);
}

/** The total, or input plus output when the provider reports no total. */
function totalOf(aggregate: TokenAggregate): number | null {
	const { totalTokens, inputTokens, outputTokens } = aggregate.usage;

	if (totalTokens !== null) return totalTokens;

	return inputTokens === null && outputTokens === null ? null : (inputTokens ?? 0) + (outputTokens ?? 0);
}

/** "12,340 in · 3,210 out · 1,200 cached · 4 requests". */
function breakdown(aggregate: TokenAggregate): string {
	const { inputTokens, outputTokens, cachedInputTokens } = aggregate.usage;

	return [
		inputTokens !== null && `${NUMBER.format(inputTokens)} in`,
		outputTokens !== null && `${NUMBER.format(outputTokens)} out`,
		cachedInputTokens && `${NUMBER.format(cachedInputTokens)} cached`,
		`${NUMBER.format(aggregate.calls)} request${aggregate.calls === 1 ? '' : 's'}`
	]
		.filter(Boolean)
		.join(' · ');
}

/** One line of the breakdown: a name, its tokens, and an optional share bar and detail under it. */
function UsageRow({ name, aggregate, share }: { name: string; aggregate: TokenAggregate; share?: number | null }) {
	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-baseline justify-between gap-3 text-[13px]">
				<span className="min-w-0 truncate text-fg">{name}</span>
				<span className="shrink-0 font-mono text-[12.5px] text-fg-muted tabular-nums">
					{tokens(totalOf(aggregate))}
				</span>
			</div>
			{share === undefined || share === null ? null : <Meter value={share} aria-label={`${name}: share of tokens`} />}
			<span className="text-[12px] text-fg-subtle">{breakdown(aggregate)}</span>
		</div>
	);
}

/** The counts: the total, then each model with its share, then each kind of agent. */
function Usage({ metrics }: { metrics: ReviewMetrics }) {
	const total = totalOf(metrics.total);
	const models = [...metrics.models].sort((a, b) => (totalOf(b) ?? 0) - (totalOf(a) ?? 0));

	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-col gap-1">
				<p className="text-[15px] text-fg">{tokens(total)} tokens</p>
				<p className="text-[12px] text-fg-subtle">{breakdown(metrics.total)}</p>
			</div>
			<section className="flex flex-col gap-4" aria-label="By model">
				{models.map((model) => (
					<UsageRow
						key={`${model.provider}:${model.model}`}
						name={prettyModelName(model.model)}
						aggregate={model}
						share={total ? (totalOf(model) ?? 0) / total : null}
					/>
				))}
			</section>
			{metrics.stages.length > 0 ? (
				<section className="flex flex-col gap-3">
					<h3 className="text-[12.5px] font-medium text-fg-subtle">By stage</h3>
					{metrics.stages.map((stage) => (
						<UsageRow key={stage.stage} name={STAGE_LABEL[stage.stage]} aggregate={stage} />
					))}
				</section>
			) : null}
		</div>
	);
}

/** Skeleton rows: the model rows carry a share bar, the stage rows do not. */
const SKELETON_MODELS = ['w-[46%]', 'w-[38%]'];

const SKELETON_STAGES = ['w-[30%]', 'w-[26%]', 'w-[34%]'];

/** One skeleton line of the breakdown, the shape of a `UsageRow`. */
function RowSkeleton({ width, meter }: { width: string; meter: boolean }) {
	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex h-5 items-center justify-between gap-3">
				<Skeleton className={`h-[11px] ${width}`} />
				<Skeleton className="h-[11px] w-[72px]" />
			</div>
			{meter ? <Skeleton className="h-[3px] w-full" /> : null}
			<Skeleton className="my-[3px] h-[11px] w-[64%]" />
		</div>
	);
}

/** The loading face, laid out like the counts (total, models with share bars, stages), so the modal holds its size. */
function UsageSkeleton() {
	return (
		<div className="flex flex-col gap-6" aria-busy>
			<div className="flex flex-col gap-1">
				<Skeleton className="my-[6px] h-[13px] w-[32%]" />
				<Skeleton className="my-[3px] h-[11px] w-[58%]" />
			</div>
			<div className="flex flex-col gap-4">
				{SKELETON_MODELS.map((width) => (
					<RowSkeleton key={width} width={width} meter />
				))}
			</div>
			<div className="flex flex-col gap-3">
				<Skeleton className="my-[5px] h-[11px] w-[64px]" />
				{SKELETON_STAGES.map((width) => (
					<RowSkeleton key={width} width={width} meter={false} />
				))}
			</div>
		</div>
	);
}

/**
 * Reads the review's token use as the modal opens; it mounts on every open,
 * so each open reads fresh counts. After a failure, Try again keeps the error
 * on screen with a spinner in the button until the counts answer; once they
 * do, focus moves to `done`, since the button it was on goes away.
 */
function UsageBody({ done }: { done: RefObject<HTMLButtonElement | null> }) {
	const id = useReview((state) => state.review?.id ?? null);
	const sample = useReview((state) => state.sample);
	const [load, setLoad] = useState<Load>({ status: 'loading' });
	const retry = useAction();

	useEffect(() => {
		if (!id || sample) return;

		let live = true;

		void readUsage(id).then((next) => live && setLoad(next));

		return () => {
			live = false;
		};
	}, [id, sample]);

	/** Reads the counts again; a read that fails again rejects, so the button shows its failure face. */
	async function again(): Promise<void> {
		if (!id) return;

		const next = await readUsage(id);

		if (next.status !== 'error') done.current?.focus();

		setLoad(next);

		if (next.status === 'error') throw new Error(next.message);
	}

	if (sample) return <p className="text-[13px] text-fg-muted">The sample review spends no tokens.</p>;

	if (load.status === 'loading') return <UsageSkeleton />;

	if (load.status === 'error') {
		return (
			<div className="flex flex-col items-start gap-3">
				<p className="text-[13px] text-fg-muted">Couldn’t load token usage. {load.message}</p>
				<Button status={retry.status} onClick={() => retry.run(again)}>
					Try again
				</Button>
			</div>
		);
	}

	if (!load.metrics) return <p className="text-[13px] text-fg-muted">No tokens were recorded for this review.</p>;

	return <Usage metrics={load.metrics} />;
}

/** The review's token use, by model and by kind of agent, opened from the review menu. */
export function TokenUsage({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
	const done = useRef<HTMLButtonElement>(null);

	return (
		<Modal open={open} onOpenChange={onOpenChange}>
			<ModalContent size="md">
				<ModalTitle>Token usage</ModalTitle>
				<ModalBody>
					<UsageBody done={done} />
				</ModalBody>
				<ModalFooter>
					<ModalClose>
						<Button ref={done} variant="primary">
							Done
						</Button>
					</ModalClose>
				</ModalFooter>
			</ModalContent>
		</Modal>
	);
}
