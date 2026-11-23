'use client';

import { DURATION, EASE_OUT, Pill, RowButton, Tooltip } from '@recoder/ui';
import { useAnimate, useReducedMotion } from 'motion/react';
import { useEffect, useRef, type CSSProperties } from 'react';

import { Bot } from './bot';
import { useScene } from './scene';

interface AgentChipProps {
	id: string;
	/** Goes up each time this agent's step lands in the row, so the chip hops for it. */
	pulse: number;
}

/**
 * An agent in a history row: its face in its colour and its short name
 * (`R1`). Hover or focus names it; a click picks it in Studio, which lights
 * it up and opens what it has done. It hops when a step of its own lands.
 */
export function AgentChip({ id, pulse }: AgentChipProps) {
	const scene = useScene();
	const agent = scene.agents.get(id);
	const [scope, animate] = useAnimate<HTMLButtonElement>();
	const reduced = useReducedMotion();
	const seen = useRef(pulse);

	useEffect(() => {
		if (pulse === seen.current) return;

		seen.current = pulse;
		if (!reduced) animate(scope.current, { y: [0, -3, 0] }, { duration: DURATION.swap, ease: [EASE_OUT, 'easeIn'] });
	}, [pulse, reduced, animate, scope]);

	if (!agent) return null;

	return (
		<Tooltip content={`${agent.short} · ${agent.name}`}>
			<RowButton
				ref={scope}
				className="studio-chip"
				style={{ '--hue': agent.hue } as CSSProperties}
				data-selected={scene.selected === id || undefined}
				aria-label={`${agent.short}, ${agent.name}`}
				onClick={() => scene.select(id)}
			>
				<Pill icon={<Bot agent={agent} face size={12} />}>{agent.short}</Pill>
			</RowButton>
		</Tooltip>
	);
}
