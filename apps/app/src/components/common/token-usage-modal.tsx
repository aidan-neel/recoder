'use client';

import {
	AgentMark,
	Button,
	cn,
	formatCompact,
	Meter,
	Modal,
	ModalBody,
	ModalContent,
	ModalTitle,
	SkeletonBox,
	StackedBar,
	StatusNotice
} from '@recoder/ui';
import { CoinsIcon, ArrowCounterClockwiseIcon } from '@phosphor-icons/react';
import { useState } from 'react';

import type { TokenUsageKind, TokenUsageSummary } from '@/lib/metrics/token-usage';
import { useTokenUsage } from '@/lib/metrics/use-token-usage';

interface TokenUsageButtonProps {
	kind: TokenUsageKind;
	id: string;
	className?: string;
}

/**
 * Places Focus on the modal's close button when no error action needs it, so
 * the stacked bar's first segment does not pop its tooltip on the first frame.
 */
function focusCloseOnOpen(event: Event): void {
	const panel = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
	const close = panel?.querySelector<HTMLElement>('[data-slot="close"]');

	if (!close) return;

	event.preventDefault();
	close.focus();
}

/**
 * A quiet page-bar trigger that opens the token usage modal for one pull
 * request review or repository chat.
 */
export function TokenUsageButton({ kind, id, className }: TokenUsageButtonProps) {
	const [open, setOpen] = useState(false);
	const usage = useTokenUsage(kind, id, open);

	return (
		<>
			<Button
				variant="ghost"
				data-state={open ? 'open' : undefined}
				className={cn('token-usage-trigger', className)}
				onClick={() => setOpen(true)}
			>
				<CoinsIcon aria-hidden className="size-3.5" />
				Token usage
			</Button>
			<Modal open={open} onOpenChange={setOpen}>
				<ModalContent
					size="lg"
					className="token-usage-panel"
					onOpenAutoFocus={usage.phase === 'failed' ? undefined : focusCloseOnOpen}
				>
					<ModalTitle>Token usage</ModalTitle>
					<ModalBody>
						{usage.phase === 'loading' ? <TokenUsageSkeleton /> : null}
						{usage.phase === 'failed' ? <TokenUsageFailed error={usage.error} onRetry={usage.retry} /> : null}
						{usage.phase === 'ready' ? (
							usage.summary ? (
								<TokenUsageView summary={usage.summary} />
							) : (
								<TokenUsageEmpty kind={kind} />
							)
						) : null}
					</ModalBody>
				</ModalContent>
			</Modal>
		</>
	);
}

/** Full-layout skeleton matching the populated modal's headline, stacked bar and model rows. */
function TokenUsageSkeleton() {
	return (
		<div className="token-usage-body" aria-busy="true" aria-label="Loading token usage">
			<div className="token-usage-head">
				<SkeletonBox className="h-8 w-36 rounded-md" />
				<SkeletonBox className="h-4 w-28" />
			</div>
			<div className="token-usage-section">
				<SkeletonBox className="h-2 w-full rounded-full" />
				<div className="flex gap-4">
					<SkeletonBox className="h-3.5 w-20" />
					<SkeletonBox className="h-3.5 w-24" />
					<SkeletonBox className="h-3.5 w-20" />
				</div>
			</div>
			<div className="token-usage-section">
				<SkeletonBox className="h-3.5 w-16" />
				<div className="token-usage-models">
					<SkeletonBox className="h-12 w-full" />
					<SkeletonBox className="h-12 w-full" />
				</div>
			</div>
		</div>
	);
}

/** Error notice inside the modal when the server could not return metrics. */
function TokenUsageFailed({ error, onRetry }: { error: string; onRetry: () => void }) {
	return (
		<div className="py-2">
			<StatusNotice
				tone="danger"
				title="Token usage did not load."
				detail={error}
				actions={
					<Button onClick={onRetry}>
						<ArrowCounterClockwiseIcon aria-hidden />
						Try again
					</Button>
				}
			/>
		</div>
	);
}

/** Empty state before any model call has recorded usage for this review or chat. */
function TokenUsageEmpty({ kind }: { kind: TokenUsageKind }) {
	const detail =
		kind === 'chat'
			? 'Send a message in this chat to record model calls and token counts.'
			: 'Token counts appear here once a model call runs on this review.';

	return (
		<div className="py-6">
			<StatusNotice variant="section" title="No token usage recorded yet." detail={detail} />
		</div>
	);
}

/** Populated token usage summary: headline total, token-kind split, models and review stages. */
function TokenUsageView({ summary }: { summary: TokenUsageSummary }) {
	return (
		<div className="token-usage-body tabular">
			<div className="token-usage-head">
				<div className="token-usage-total-row">
					<span className="token-usage-total">{summary.totalLabel}</span>
					<span className="token-usage-unit">tokens</span>
				</div>
				<p className="token-usage-meta">
					<span>{summary.callsLabel}</span>
					{summary.budgetLabel ? <span className="meta-sep">{summary.budgetLabel}</span> : null}
				</p>
			</div>

			{summary.segments.length > 0 ? (
				<StackedBar segments={summary.segments} formatValue={formatCompact} aria-label="Tokens by kind" />
			) : null}

			{summary.models.length > 0 ? (
				<section className="token-usage-section" aria-label="By model">
					<h3 className="section-label">By model</h3>
					<ul className="token-usage-models">
						{summary.models.map((row) => (
							<li key={row.id} className="token-usage-model">
								<div className="token-usage-model-top">
									<div className="token-usage-model-name">
										<AgentMark agent={row.provider} className="size-3.5" />
										<span className="token-usage-model-title">{row.model}</span>
										<span className="meta">{row.providerName}</span>
									</div>
									<div className="token-usage-model-figures">
										{row.shareLabel ? <span className="meta">{row.shareLabel}</span> : null}
										<span className="token-usage-count">{row.tokens}</span>
									</div>
								</div>
								{row.share !== null ? (
									<Meter value={row.share} color={row.color} aria-label={`${row.model} share`} />
								) : null}
								<p className="meta">{row.detail}</p>
							</li>
						))}
					</ul>
				</section>
			) : null}

			{summary.breakdown.length > 0 ? (
				<section className="token-usage-section" aria-label="By stage">
					<h3 className="section-label">By stage</h3>
					<ul className="token-usage-stages">
						{summary.breakdown.map((row) => (
							<li key={row.id} className="token-usage-stage">
								<span className="token-usage-stage-name">{row.label}</span>
								<span className="meta">{row.calls}</span>
								<span className="token-usage-stage-figures">
									{row.share ? <span className="meta">{row.share}</span> : null}
									<span className="token-usage-count">{row.tokens}</span>
								</span>
							</li>
						))}
					</ul>
				</section>
			) : null}

			{summary.notes.length > 0 ? (
				<div className="token-usage-notes">
					{summary.notes.map((note) => (
						<p key={note} className="meta">
							{note}
						</p>
					))}
				</div>
			) : null}
		</div>
	);
}
