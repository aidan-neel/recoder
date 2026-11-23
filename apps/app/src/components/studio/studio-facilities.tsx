'use client';

import { Card, Icon, Pill, ScrollArea, SPRING } from '@recoder/ui';
import type { ReviewCandidate } from '@recoder/shared';
import { motion, useReducedMotion } from 'motion/react';

import { plural } from '@/lib/shell/format';

import { AgentChip } from './agent-chip';
import { CandidateChain } from './candidate-chain';
import { useScene } from './scene';

/** How many waiting and settled candidates the verifier's tray lists before it counts the rest. */
const TRAY = { waiting: 2, settled: 6 };

/** The height of one row of characters on a bench. */
export const BENCH_ROW = 36;

/** A facility's bench: the strip its characters stand on, as tall as the rows they fill. */
export function Bench({ spot, rows }: { spot: string; rows: number }) {
	return <div className="studio-bench" data-spot={spot} style={{ height: rows * BENCH_ROW }} />;
}

/** A candidate in the tray; when it settles and changes place, it glides there. */
function TrayRow({ candidate }: { candidate: ReviewCandidate }) {
	const { view } = useScene();
	const reduced = useReducedMotion();

	return (
		<motion.li className="studio-tray-row" data-state={candidate.state} layout={!reduced} transition={SPRING}>
			<span className="studio-tray-title">{candidate.title}</span>
			<CandidateChain candidate={candidate} steps={view.chains.get(candidate.id) ?? []} compact />
		</motion.li>
	);
}

/**
 * The verifier's desk: what it checks now, the next few that wait for it, and
 * the newest verdicts, each with its history, in the order they were raised so
 * a row keeps its place while its verdict lands. The counts in its header are
 * the candidates' own states.
 */
export function Verifier({ rows }: { rows: number }) {
	const { view } = useScene();
	const waiting = view.candidates.filter((candidate) => candidate.state === 'raised');

	const settled = view.candidates
		.filter((candidate) => !['raised', 'verifying'].includes(candidate.state))
		.sort((a, b) => (b.settledAt ?? '').localeCompare(a.settledAt ?? ''));

	const listed = new Set([...waiting.slice(0, TRAY.waiting), ...settled.slice(0, TRAY.settled)]);
	const tray = view.candidates.filter((candidate) => candidate.state === 'verifying' || listed.has(candidate));
	const proven = settled.filter((candidate) => candidate.state === 'proven').length;
	const earlier = Math.max(0, settled.length - TRAY.settled);
	const later = Math.max(0, waiting.length - TRAY.waiting);
	const rest = [earlier && `+${earlier} earlier`, later && `${later} more waiting`].filter(Boolean).join(' · ');

	return (
		<Card as="section" className="studio-facility" aria-label="Verifier">
			<header className="studio-facility-head">
				<span className="studio-facility-name">Verifier</span>
				<span className="meta tabular">
					{proven} proven · {settled.length - proven} dropped
				</span>
			</header>
			<Bench spot="verifier" rows={rows} />
			{tray.length ? (
				<ScrollArea className="studio-tray-scroll">
					<ul className="studio-tray">
						{tray.map((candidate) => (
							<TrayRow key={candidate.id} candidate={candidate} />
						))}
					</ul>
				</ScrollArea>
			) : null}
			{rest ? <p className="meta studio-tray-rest">{rest}</p> : null}
		</Card>
	);
}

/**
 * The help desk: the questions reviewers handed to subagents, who asked and
 * who took it. Once every question is answered it folds to its header.
 */
export function HelpDesk({ rows }: { rows: number }) {
	const { agents } = useScene();
	const asked = [...agents.values()].filter((agent) => agent.role === 'subagent');

	if (asked.length === 0) return null;

	const open = asked.filter((agent) => agent.verb !== 'done' && agent.verb !== 'failed');

	return (
		<Card as="section" className="studio-facility" aria-label="Help desk" data-settled={open.length ? undefined : ''}>
			<header className="studio-facility-head">
				<span className="studio-facility-name">Help desk</span>
				<span className="meta tabular">
					{open.length ? `${plural(open.length, 'question')} open` : `${plural(asked.length, 'question')} answered`}
				</span>
			</header>
			{open.length ? (
				<>
					<Bench spot="help" rows={rows} />
					<ul className="studio-questions">
						{open.map((agent) => (
							<li key={agent.id}>
								{agent.askedBy ? <AgentChip id={agent.askedBy} pulse={0} /> : null}
								<Icon name="chevron_right" size={12} className="studio-arrow" />
								<AgentChip id={agent.id} pulse={0} />
								<span className="studio-question">{agent.question ?? agent.name}</span>
							</li>
						))}
					</ul>
				</>
			) : null}
		</Card>
	);
}

/** The sandbox: the command running there now, from the stream's newest running `run` call; one line while idle. */
export function Sandbox({ rows }: { rows: number }) {
	const { view } = useScene();
	const command = view.running?.input?.command ?? null;

	return (
		<Card as="section" className="studio-facility" aria-label="Sandbox" data-settled={command ? undefined : ''}>
			<header className="studio-facility-head">
				<span className="studio-facility-name">Sandbox</span>
				{command ? null : <span className="meta">Idle</span>}
			</header>
			{command ? (
				<>
					<Bench spot="sandbox" rows={rows} />
					<Pill face="code" title={command}>
						$ {command}
					</Pill>
				</>
			) : null}
		</Card>
	);
}
