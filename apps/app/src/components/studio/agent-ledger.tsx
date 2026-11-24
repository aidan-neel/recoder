'use client';

import { Pill } from '@recoder/ui';

import type { StudioAgent, StudioVerb } from '@/lib/studio/studio-view';

import { Bot } from './bot';
import { CandidateChain } from './candidate-chain';
import { useScene } from './scene';

const VERB_WORD: Record<StudioVerb, string> = {
	queued: 'Queued',
	waiting: 'Waiting for a model',
	reading: 'Reading',
	searching: 'Searching',
	running: 'Running a command',
	thinking: 'Thinking',
	idle: 'Between steps',
	done: 'Done',
	failed: 'Stopped'
};

/** What an agent is for, in a few words, from the plan. */
function roleOf(agent: StudioAgent, agents: Map<string, StudioAgent>): string {
	if (agent.role === 'lead') return 'Runs the review';
	if (agent.role === 'verifier') return 'Checks candidates';
	if (agent.role === 'subagent') return `Asked by ${agents.get(agent.askedBy ?? '')?.short ?? 'a reviewer'}`;

	return 'Reviewer';
}

/**
 * The ledger behind a character, opened from it or from its chip: what it is
 * doing now, its newest tool calls as the stream recorded them, and the
 * candidates it raised or checked.
 */
export function AgentLedger({ agent }: { agent: StudioAgent }) {
	const { view, agents, calls } = useScene();

	const own = calls
		.filter((call) => agent.owners.includes(call.assignmentId ?? ''))
		.slice(-6)
		.reverse();

	const candidates = view.candidates.filter(
		(candidate) => candidate.raisedBy === agent.id || candidate.verifierId === agent.id
	);

	return (
		<div className="studio-ledger">
			<div className="studio-ledger-head">
				<Bot agent={agent} size={26} />
				<div className="studio-ledger-who">
					<span className="studio-ledger-name">
						{agent.short} · {agent.name}
					</span>
					<span className="meta">{roleOf(agent, agents)}</span>
				</div>
			</div>
			{agent.question ? <p className="studio-ledger-question">{agent.question}</p> : null}
			<div className="studio-ledger-now">
				<Pill>{VERB_WORD[agent.verb]}</Pill>
				{agent.say ? (
					<Pill face="code" title={agent.say}>
						{agent.say}
					</Pill>
				) : null}
			</div>
			{own.length ? (
				<ol className="studio-ledger-calls" aria-label="Newest tool calls">
					{own.map((call) => (
						<li key={call.id} data-status={call.status}>
							<code>{call.command}</code>
							<span className="meta">{call.status === 'running' ? 'running' : (call.summary ?? call.status)}</span>
						</li>
					))}
				</ol>
			) : null}
			{candidates.length ? (
				<ul className="studio-ledger-candidates" aria-label="Candidates">
					{candidates.map((candidate) => (
						<li key={candidate.id}>
							<span className="studio-ledger-title">{candidate.title}</span>
							<CandidateChain candidate={candidate} steps={view.chains.get(candidate.id) ?? []} compact />
						</li>
					))}
				</ul>
			) : null}
		</div>
	);
}
