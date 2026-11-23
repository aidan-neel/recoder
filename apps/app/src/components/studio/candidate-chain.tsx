'use client';

import { DURATION, EASE_OUT, Icon, Pill, SPRING, Tooltip, type IconName, type PillTone } from '@recoder/ui';
import type { FindingTier, ReviewCandidate } from '@recoder/shared';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { ReactElement } from 'react';

import type { ChainStep, StepKind } from '@/lib/studio/studio-view';
import { clockAt } from '@/lib/studio/use-studio';

import { AgentChip } from './agent-chip';
import { useScene } from './scene';

const STEP: Record<StepKind, { label: string; icon: IconName }> = {
	raised: { label: 'Raised', icon: 'report' },
	traced: { label: 'Traced', icon: 'route' },
	ran: { label: 'Ran', icon: 'terminal' },
	checked: { label: 'Checked', icon: 'fact_check' },
	proven: { label: 'Proven', icon: 'verified_user' },
	dropped: { label: 'Dropped', icon: 'block' },
	merged: { label: 'Merged', icon: 'merge' }
};

const TIER_TONE: Record<FindingTier, PillTone> = { bug: 'high', warning: 'medium', fyi: 'low' };

const VERDICTS: StepKind[] = ['proven', 'dropped', 'merged'];

function toneOf(kind: StepKind, tier: FindingTier): PillTone {
	if (kind === 'proven' || kind === 'raised') return TIER_TONE[tier];
	if (kind === 'dropped' || kind === 'merged') return 'neutral';

	return 'info';
}

/** What a badge's tooltip says: the step, how many calls it folds, when it landed, and the server's words. */
function tipOf(step: ChainStep, startedAt: string | null): string {
	const count = step.count > 1 ? ` · ${step.count} calls` : '';
	const detail = step.detail ? ` · ${step.detail}` : '';

	return `${STEP[step.kind].label}${count} at ${clockAt(step.at, startedAt)}${detail}`;
}

/**
 * Each chip and badge pops in as its event lands; a verdict stamps down on the kit's layout spring, so it reads as a
 * stamp rather than a blink. Reduced motion leaves only the fade.
 */
function useEntrance(verdict: boolean) {
	const reduced = useReducedMotion();

	if (reduced) return { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: DURATION.menuOut } };

	if (verdict) {
		return {
			initial: { opacity: 0, scale: 1.45, rotate: -6 },
			animate: { opacity: 1, scale: 1, rotate: 0 },
			transition: { default: SPRING, opacity: { duration: DURATION.swap, ease: EASE_OUT } }
		};
	}

	return {
		initial: { opacity: 0, scale: 0.8 },
		animate: { opacity: 1, scale: 1 },
		transition: { duration: DURATION.swap, ease: EASE_OUT }
	};
}

/** The arrow between the chain's links: before an agent that takes over, and before the verdict. */
function Arrow() {
	return <Icon name="chevron_right" size={12} className="studio-chain-arrow" />;
}

function Badge({ step, tier, compact }: { step: ChainStep; tier: FindingTier; compact: boolean }) {
	const { startedAt } = useScene();
	const verdict = VERDICTS.includes(step.kind);
	const entrance = useEntrance(verdict);
	const { label, icon } = STEP[step.kind];

	return (
		<motion.li className="studio-chain-step" data-kind={step.kind} {...entrance}>
			{verdict ? <Arrow /> : null}
			<Tooltip content={tipOf(step, startedAt)}>
				<span
					className="studio-badge"
					data-bare={(compact && !verdict) || undefined}
					aria-label={tipOf(step, startedAt)}
				>
					<Pill tone={toneOf(step.kind, tier)} icon={<Icon name={icon} size={12} fill={verdict} />}>
						{compact && !verdict ? null : label}
						{step.count > 1 ? <span className="studio-badge-count">×{step.count}</span> : null}
					</Pill>
				</span>
			</Tooltip>
		</motion.li>
	);
}

function Chip({ agent, pulse, first }: { agent: string; pulse: number; first: boolean }) {
	const entrance = useEntrance(false);

	return (
		<motion.li className="studio-chain-agent" {...entrance}>
			{first ? null : <Arrow />}
			<AgentChip id={agent} pulse={pulse} />
		</motion.li>
	);
}

/**
 * A candidate's history as a short chain on one line: the agent that raised
 * it, `Raised`, the verifier, what it did (`Traced`, `Ran`), then the
 * verdict. Every badge is an event from the stream; its time is in its tooltip.
 * Rows already there when Studio opens show at rest; only steps that land
 * while it shows animate.
 */
interface CandidateChainProps {
	candidate: ReviewCandidate;
	steps: ChainStep[];
	/** In a narrow column every step but the verdict is its icon alone, its name in its tooltip. */
	compact?: boolean;
}

export function CandidateChain({ candidate, steps, compact = false }: CandidateChainProps) {
	const items: ReactElement[] = [];

	for (const [index, step] of steps.entries()) {
		const agent = step.agent;

		if (agent && steps[index - 1]?.agent !== agent) {
			const run = steps.slice(index).findIndex((later) => later.agent !== agent);
			const pulse = run === -1 ? steps.length - index : run;

			items.push(<Chip key={`${step.id}:agent`} agent={agent} pulse={pulse} first={index === 0} />);
		}

		items.push(<Badge key={step.id} step={step} tier={candidate.tier} compact={compact} />);
	}

	return (
		<ol className="studio-chain" aria-label={`History of ${candidate.title}`}>
			<AnimatePresence initial={false}>{items}</AnimatePresence>
		</ol>
	);
}
