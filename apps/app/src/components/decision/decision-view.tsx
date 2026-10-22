'use client';

import { parseUnifiedDiff } from '@recoder/shared';
import { Markdown, Pill } from '@recoder/ui';
import { CircleDashed, FlaskConical, Route, ShieldCheck } from 'lucide-react';
import { useMemo } from 'react';

import { stateOf } from '@/lib/review/decisions';
import { fileHunks } from '@/lib/review/excerpt';
import { categoryLabel, plain, PROOF_LABEL, TONE_LABEL } from '@/lib/review/labels';
import { surfaceOf, useReview } from '@/lib/review/review-store';
import type { Decision, Proof } from '@/lib/review/surface';

import { ClaimSteps } from './claim-steps';
import { HunkCode } from './code-frame';
import { CodeSection } from './code-section';
import { SentNote, StateLine } from './decision-state';
import { DetailArticle, DetailSection, Kicker, KickerText, WhereButton } from './detail-parts';
import { EvidenceBlock } from './evidence-block';
import { InlineText } from '@/components/common/inline-text';

const PROOF_ICON: Record<Proof, typeof FlaskConical> = {
	reproduced: FlaskConical,
	traced: Route,
	checked: ShieldCheck,
	unproven: CircleDashed
};

/** How the finding was proven, with its icon; reproduced and traced read green. Questions are unanswered. */
function ProofLabel({ decision }: { decision: Decision }) {
	const Icon = PROOF_ICON[decision.proof];
	const proven = decision.proof === 'reproduced' || decision.proof === 'traced';

	return (
		<KickerText
			className={proven ? 'inline-flex items-center gap-[5px] text-ok' : 'inline-flex items-center gap-[5px]'}
		>
			<Icon className="size-[13px]" aria-hidden="true" />
			{decision.kind === 'question' ? 'Unanswered' : PROOF_LABEL[decision.proof]}
		</KickerText>
	);
}

/** The fix: a checked patch with the checks it passed, or the reviewer's description when there is no patch. */
function FixSection({ decision }: { decision: Decision }) {
	const patch = useMemo(
		() => (decision.patch ? (parseUnifiedDiff(decision.patch)[0] ?? null) : null),
		[decision.patch]
	);

	const checks = decision.finding?.patch?.checks ?? [];

	if (patch && patch.hunks.length > 0) {
		return (
			<DetailSection title="Suggested fix">
				<HunkCode
					path={patch.path}
					fresh={false}
					hunks={fileHunks(patch, [])}
					aside={
						checks.length > 0 ? (
							<span className="inline-flex min-w-0 items-center gap-[5px] font-mono text-[11px] text-ok">
								<ShieldCheck className="size-3 shrink-0" aria-hidden="true" />
								<span className="truncate">{checks.join(' · ')}</span>
							</span>
						) : null
					}
				/>
			</DetailSection>
		);
	}

	const text = decision.suggestion ?? decision.patch;

	if (!text) return null;

	return (
		<DetailSection title="Suggested fix">
			<Markdown className="text-[14px] leading-[1.55] text-fg-secondary">{text}</Markdown>
		</DetailSection>
	);
}

/** One decision, mounted per item so moving between decisions swaps content with no animation. */
function DecisionDetail({ decision }: { decision: Decision }) {
	const state = useReview((store) => stateOf(store.records, decision.id));

	return (
		<DetailArticle label={plain(decision.title)}>
			<header className="mb-[18px]">
				<Kicker>
					<Pill tone={decision.tone}>{TONE_LABEL[decision.tone]}</Pill>
					{decision.category ? <KickerText>{categoryLabel(decision.category)}</KickerText> : null}
					<ProofLabel decision={decision} />
					<StateLine decision={decision} state={state} />
				</Kicker>
				<h2 className="detail-title">
					<InlineText text={decision.title} />
				</h2>
				<WhereButton file={decision.file} line={decision.line} endLine={decision.endLine} symbol={decision.symbol} />
			</header>

			<Markdown variant="ai" className="detail-body">
				{decision.body}
			</Markdown>

			<SentNote id={decision.id} sent={state === 'sent'} />

			{decision.claim ? (
				<DetailSection title="How it breaks">
					<ClaimSteps claim={decision.claim} />
				</DetailSection>
			) : null}

			{decision.evidence ? (
				<DetailSection title="Evidence">
					<EvidenceBlock evidence={decision.evidence} />
				</DetailSection>
			) : decision.proofNote ? (
				<DetailSection title={decision.proof === 'unproven' ? 'Why it isn’t proven' : 'How it was checked'}>
					<Markdown className="text-[14px] leading-[1.55] text-fg-secondary">{decision.proofNote}</Markdown>
				</DetailSection>
			) : null}

			<CodeSection
				file={decision.file}
				line={decision.line}
				endLine={decision.endLine}
				side={decision.side}
				radius={4}
				openable
			/>
			<FixSection decision={decision} />
		</DetailArticle>
	);
}

/** One decision: what is wrong, how it breaks, the proof and the code. */
export function DecisionView({ id }: { id: string }) {
	const decision = useReview((state) => surfaceOf(state)?.decisions.find((item) => item.id === id) ?? null);

	if (!decision) return null;

	return <DecisionDetail key={decision.id} decision={decision} />;
}
