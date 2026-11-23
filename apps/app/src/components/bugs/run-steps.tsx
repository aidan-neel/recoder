'use client';

import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
	Icon,
	Meter,
	Pill,
	StatusGlyph,
	type GlyphKind
} from '@recoder/ui';
import { useState, type ReactNode } from 'react';

import type { RunActivity } from '@/lib/run/run-activity';
import type { RunFact, RunLine, RunMark, RunStage, RunView } from '@/lib/run/types';

/** The glyph before a line: a dot for a bug found, a spinner at work, a check once cleared. */
const LINE_GLYPHS: Record<RunMark, GlyphKind> = {
	waiting: 'idle',
	working: 'spinner',
	found: 'high',
	settled: 'ok',
	unsure: 'question',
	stopped: 'failed'
};

/** The glyph before a step: a check once done, a spinner while it runs (a ring while paused), a ring while it waits. */
function stepGlyph(state: RunStage['state'], paused: boolean): GlyphKind {
	if (state === 'done') return 'ok';

	return state === 'active' && !paused ? 'spinner' : 'idle';
}

/** One badge of a step: a count at work in the accent, what was found in the high tone, a duration with its timer. */
function FactPill({ fact }: { fact: RunFact }) {
	if (fact.tone === 'found') {
		return (
			<Pill tone="high" icon={<span aria-hidden className="pill-dot" />}>
				{fact.text}
			</Pill>
		);
	}

	return (
		<Pill
			face={fact.kind === 'code' ? 'code' : 'text'}
			icon={fact.kind === 'time' ? <Icon name="timer" /> : undefined}
			className={fact.tone === 'progress' ? 'run-fact-progress' : undefined}
		>
			{fact.text}
		</Pill>
	);
}

interface StepHeadProps {
	stage: RunStage;
	paused: boolean;
	/** The chevron of a step that opens. */
	chevron?: ReactNode;
}

/** A step's head, laid out as a bug row's: the glyph, the name, the chevron, and the badges under the name. */
function StepHead({ stage, paused, chevron }: StepHeadProps) {
	return (
		<>
			<StatusGlyph kind={stepGlyph(stage.state, paused)} className="run-step-glyph" />
			<span className="run-step-title">{stage.label}</span>
			{chevron}
			{stage.facts.length ? (
				<span className="bug-facts run-step-facts">
					{stage.facts.map((fact) => (
						<FactPill key={fact.text} fact={fact} />
					))}
				</span>
			) : null}
		</>
	);
}

/** One claim or part of the plan: its glyph, its title and the word for where it stands. */
function Line({ line }: { line: RunLine }) {
	return (
		<li className="run-line" data-mark={line.mark}>
			<StatusGlyph kind={LINE_GLYPHS[line.mark]} />
			<span className="run-line-title">{line.title}</span>
			<span className="run-line-word">{line.word}</span>
		</li>
	);
}

/** What the review does right now, as a plain verb with its file, search or command in the code face. */
function Activity({ activity }: { activity: RunActivity }) {
	return (
		<p className="run-activity">
			{activity.verb}
			{activity.subject ? (
				<Pill face="code" title={activity.subject}>
					{activity.subject}
				</Pill>
			) : null}
		</p>
	);
}

interface StepBodyProps {
	stage: RunStage;
	/** What the review does now; only the active step has it. */
	activity: RunActivity | null;
}

/** An open step: how far it is and what it does now while it runs, then its lines and what they leave out. */
function StepBody({ stage, activity }: StepBodyProps) {
	return (
		<div className="run-step-body">
			{stage.state === 'active' && stage.share !== null ? (
				<Meter value={stage.share} color="var(--accent)" className="run-step-meter" aria-label={stage.label} />
			) : null}
			{activity ? <Activity activity={activity} /> : null}
			{stage.lines.length ? (
				<ul className="run-lines">
					{stage.lines.map((line) => (
						<Line key={line.id} line={line} />
					))}
				</ul>
			) : null}
			{stage.rest ? <p className="run-rest">{stage.rest}</p> : null}
		</div>
	);
}

interface StepRowProps {
	stage: RunStage;
	activity: RunActivity | null;
	paused: boolean;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

/**
 * One step as a row of the list. A step with lines, or the active one with
 * something to show, opens like a bug row; the rest is its head alone.
 */
function StepRow({ stage, activity, paused, open, onOpenChange }: StepRowProps) {
	const active = stage.state === 'active';
	const opens = stage.lines.length > 0 || (active && (stage.share !== null || activity !== null));

	if (!opens) {
		return (
			<li className="run-step" data-state={stage.state} aria-current={active ? 'step' : undefined}>
				<div className="run-step-head">
					<StepHead stage={stage} paused={paused} />
				</div>
			</li>
		);
	}

	return (
		<li className="run-step" data-state={stage.state} aria-current={active ? 'step' : undefined}>
			<Collapsible open={open} onOpenChange={onOpenChange}>
				<CollapsibleTrigger className="run-step-head">
					<StepHead stage={stage} paused={paused} chevron={<Icon name="expand_more" className="run-step-chevron" />} />
				</CollapsibleTrigger>
				<CollapsibleContent>
					<StepBody stage={stage} activity={activity} />
				</CollapsibleContent>
			</Collapsible>
		</li>
	);
}

/** A queued review's row above its steps: it waits to start, and why. */
function QueuedRow({ waiting }: { waiting: string | null }) {
	return (
		<div className="run-step" data-state="queued" role="status">
			<div className="run-step-head">
				<StatusGlyph kind="idle" className="run-step-glyph" />
				<span className="run-step-title">Waiting to start</span>
				{waiting ? (
					<span className="bug-facts run-step-facts">
						<Pill>{waiting}</Pill>
					</span>
				) : null}
			</div>
		</div>
	);
}

/**
 * A review in progress on the Review tab: its four steps as rows, in the
 * bugs' row language. A done step folds to its badges; the active step opens
 * to how far it is, what it does now and the claims under check; a waiting
 * step is its name alone. A step a person opened or shut stays that way; the
 * rest follow the review, so the step at work is the open one. A queued
 * review says why it waits above them.
 */
export function RunSteps({ run }: { run: RunView }) {
	const [chosen, setChosen] = useState<Partial<Record<RunStage['id'], boolean>>>({});
	const paused = run.phase === 'paused';

	return (
		<section className="run-steps" aria-label="Review in progress">
			{run.phase === 'queued' ? <QueuedRow waiting={run.waiting} /> : null}
			<ol className="run-step-list">
				{run.stages.map((stage) => (
					<StepRow
						key={stage.id}
						stage={stage}
						activity={stage.state === 'active' ? run.activity : null}
						paused={paused}
						open={chosen[stage.id] ?? stage.state === 'active'}
						onOpenChange={(open) => setChosen((current) => ({ ...current, [stage.id]: open }))}
					/>
				))}
			</ol>
		</section>
	);
}
