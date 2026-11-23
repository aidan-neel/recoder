'use client';

import { Button, Card, cn, FileChip, Popover, PopoverContent, PopoverTrigger, RowButton } from '@recoder/ui';
import type { ReviewToolCall } from '@recoder/shared';
import { useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useRef, type CSSProperties, type RefObject } from 'react';

import { plural } from '@/lib/shell/format';
import type { StudioAgent, StudioView } from '@/lib/studio/studio-view';
import { useSpots, type Spot } from '@/lib/studio/use-spots';

import { AgentLedger } from './agent-ledger';
import { Bot } from './bot';
import { CandidateChain } from './candidate-chain';
import { SceneContext, type Scene } from './scene';
import { Bench, BENCH_ROW, HelpDesk, Sandbox, Verifier } from './studio-facilities';
import { shownFiles, StudioRooms } from './studio-rooms';

/** The width a character takes on a bench, and the height of a bench row. */
const SEAT = { w: 30, h: BENCH_ROW };

const SETTLED = new Set(['queued', 'waiting', 'done', 'failed']);

/** Where an agent stands: the desk of the file it is in, else the facility its role and state belong to. */
function spotOf(agent: StudioAgent, shown: Set<string>, ended: boolean): string {
	if (ended) return 'commons';
	if (SETTLED.has(agent.verb)) return agent.role === 'verifier' ? 'verifier' : 'commons';
	if (agent.verb === 'running') return 'sandbox';
	if (agent.path) return shown.has(agent.path) ? `desk:${agent.path}` : 'more';
	if (agent.role === 'verifier') return 'verifier';

	return agent.role === 'subagent' ? 'help' : 'commons';
}

/** The rows a bench needs for `count` characters at its measured width. */
function rowsFor(count: number, spot: Spot | undefined): number {
	if (count === 0) return 0;

	const perRow = Math.max(1, Math.floor(((spot?.w ?? 240) - 8) / SEAT.w));

	return Math.ceil(count / perRow);
}

/** A character's place: on a desk it sits at the desk's right end; on a bench it takes the next seat. */
function placeOf(spot: Spot, slot: number, desk: boolean, size: number): { x: number; y: number } {
	if (desk) return { x: spot.x + spot.w - size - 4 - slot * size * 0.6, y: spot.y + spot.h - size * 1.15 - 3 };

	const perRow = Math.max(1, Math.floor((spot.w - 8) / SEAT.w));

	return { x: spot.x + 4 + (slot % perRow) * SEAT.w, y: spot.y + 2 + Math.floor(slot / perRow) * SEAT.h };
}

interface CastProps {
	agents: StudioAgent[];
	where: Map<string, string>;
	spots: Map<string, Spot>;
	selected: string | null;
	select: (id: string | null) => void;
}

/**
 * Focuses the ledger itself rather than its first chip, so the chip's tooltip
 * does not open over it and one Escape closes the ledger.
 */
function focusPanel(event: Event) {
	event.preventDefault();
	if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus();
}

/**
 * The characters, laid over the floor at their spots. Each walks there with a
 * transform transition; while it moves its legs go. A click opens its ledger.
 */
function Cast({ agents, where, spots, selected, select }: CastProps) {
	const seats = new Map<string, number>();

	return (
		<div className="studio-cast">
			{agents.map((agent) => {
				const key = where.get(agent.id) ?? 'commons';
				const spot = spots.get(key);

				if (!spot) return null;

				const slot = seats.get(key) ?? 0;
				const desk = key.startsWith('desk:');
				const size = desk && spot.h < 30 ? 16 : 24;
				const { x, y } = placeOf(spot, slot, desk, size);

				seats.set(key, slot + 1);

				return (
					<Popover key={agent.id} open={selected === agent.id} onOpenChange={(open) => select(open ? agent.id : null)}>
						<PopoverTrigger>
							<RowButton
								className={cn('studio-agent', selected === agent.id && 'is-selected')}
								data-agent={agent.id}
								style={{ transform: `translate(${x}px, ${y}px)`, '--hue': agent.hue } as CSSProperties}
								aria-label={`${agent.short}, ${agent.name}${agent.say ? `: ${agent.say}` : ''}`}
								onTransitionRun={(event) => {
									if (event.target === event.currentTarget) event.currentTarget.dataset.walking = '';
								}}
								onTransitionEnd={(event) => {
									if (event.target === event.currentTarget) delete event.currentTarget.dataset.walking;
								}}
							>
								{agent.say ? <span className="studio-say">{agent.say}</span> : null}
								<Bot agent={agent} size={size} />
								<span className="studio-tag">{agent.short}</span>
							</RowButton>
						</PopoverTrigger>
						<PopoverContent side="bottom" align="start" className="studio-ledger-panel" onOpenAutoFocus={focusPanel}>
							<AgentLedger agent={agent} />
						</PopoverContent>
					</Popover>
				);
			})}
		</div>
	);
}

/** Brings the bot `id` into view, once a chip or a click picked it. */
function useFollow(floor: RefObject<HTMLDivElement | null>, id: string | null) {
	const reduced = useReducedMotion();

	useEffect(() => {
		if (!id) return;

		floor.current
			?.querySelector(`[data-agent="${CSS.escape(id)}"]`)
			?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
	}, [floor, id, reduced]);
}

/** The first finding card below, focused, so the ending hands over to the cards. */
function openFindings(): void {
	const head = document.querySelector<HTMLElement>('.bug-item > .bug-head');

	head?.scrollIntoView({ block: 'start' });
	head?.focus({ preventScroll: true });
}

function Commons({ view, ended, rows }: { view: StudioView; ended: boolean; rows: number }) {
	const proven = view.candidates.filter((candidate) => candidate.state === 'proven');

	return (
		<Card as="section" className="studio-facility studio-commons" aria-label="Commons" data-ended={ended || undefined}>
			<header className="studio-facility-head">
				<span className="studio-facility-name">{ended ? 'Everyone is back' : 'Commons'}</span>
				{ended ? <span className="meta tabular">{plural(proven.length, 'finding')} on the table</span> : null}
			</header>
			<Bench spot="commons" rows={Math.max(rows, ended ? 1 : 0)} />
			{ended && proven.length ? (
				<ul className="studio-table">
					{proven.map((candidate) => (
						<li key={candidate.id}>
							<span className="studio-table-title">{candidate.title}</span>
							<FileChip path={candidate.path} line={candidate.line} className="studio-table-where" />
							<CandidateChain candidate={candidate} steps={view.chains.get(candidate.id) ?? []} />
						</li>
					))}
				</ul>
			) : null}
			{ended && proven.length ? (
				<div className="studio-table-end">
					<Button variant="primary" onClick={openFindings}>
						Open findings
					</Button>
				</div>
			) : null}
		</Card>
	);
}

interface StudioProps {
	view: StudioView;
	calls: ReviewToolCall[];
	startedAt: string | null;
	/** The review finished while Studio showed: everyone gathers in the commons with the findings. */
	ended: boolean;
	selected: string | null;
	onSelect: (id: string | null) => void;
}

/**
 * Studio: the review as an office. Rooms are folders and desks are files; the
 * reviewers walk to the file their newest tool call is in, verifiers take
 * candidates at their desk, subagents answer at the help desk, commands run in
 * the sandbox, and everyone ends in the commons with the findings. Status
 * comes from the stream; the characters' poses and walks are decoration.
 */
export function Studio({ view, calls, startedAt, ended, selected, onSelect }: StudioProps) {
	const floor = useRef<HTMLDivElement>(null);
	const shown = useMemo(() => shownFiles(view.rooms), [view.rooms]);
	const where = new Map(view.agents.map((agent) => [agent.id, spotOf(agent, shown, ended)]));
	const crowd = new Map<string, number>();

	for (const spot of where.values()) crowd.set(spot, (crowd.get(spot) ?? 0) + 1);

	const layout = [...crowd.entries(), view.rooms.length, view.candidates.length, ended, view.running?.id].join();
	const spots = useSpots(floor, layout);
	const rows = (spot: string) => rowsFor(crowd.get(spot) ?? 0, spots.get(spot));
	const agents = useMemo(() => new Map(view.agents.map((agent) => [agent.id, agent])), [view.agents]);

	const scene: Scene = { view, agents, calls, startedAt, selected, select: onSelect };

	useFollow(floor, selected);

	return (
		<SceneContext value={scene}>
			<section className="studio" aria-label="Studio" data-ended={ended || undefined}>
				<div className="studio-floor" ref={floor}>
					<div className="studio-main">
						<StudioRooms rooms={view.rooms} ended={ended} moreRows={rows('more')} />
						<Commons view={view} ended={ended} rows={rows('commons')} />
					</div>
					<div className="studio-side">
						<Verifier rows={rows('verifier')} />
						<HelpDesk rows={rows('help')} />
						<Sandbox rows={rows('sandbox')} />
					</div>
					<Cast agents={view.agents} where={where} spots={spots} selected={selected} select={onSelect} />
				</div>
			</section>
		</SceneContext>
	);
}
