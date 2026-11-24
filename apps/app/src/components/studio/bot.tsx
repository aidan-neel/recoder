'use client';

import { cn } from '@recoder/ui';
import type { CSSProperties } from 'react';

import type { StudioAgent } from '@/lib/studio/studio-view';

interface BotProps {
	agent: Pick<StudioAgent, 'hue' | 'verb' | 'role'>;
	size?: number;
	/** Only the head, for a chip. */
	face?: boolean;
	walking?: boolean;
	className?: string;
}

/**
 * A reviewer character: a rounded screen with two eyes on a small body, in its
 * colour. Its pose follows its real verb: eyes scan while it reads, the head
 * tilts while it searches, dots rise while it thinks, eyes close while it waits
 * for a model, and it smiles once done. The orchestrator wears an antenna,
 * a verifier a visor. Decoration only: the words beside it
 * carry the status.
 */
export function Bot({ agent, size = 26, face, walking, className }: BotProps) {
	const style = { '--hue': agent.hue, width: size, height: face ? size : (size * 30) / 26 } as CSSProperties;
	const happy = agent.verb === 'done';

	return (
		<span
			className={cn('studio-bot', className)}
			data-verb={agent.verb}
			data-role={agent.role}
			data-walking={walking || undefined}
			style={style}
			aria-hidden
		>
			<svg viewBox={face ? '2 1 22 18' : '0 0 26 30'} width="100%" height="100%" fill="none">
				<g className="studio-bot-whole">
					{face ? null : <rect className="studio-bot-body" x="7" y="19.5" width="12" height="9" rx="4.5" />}
					<g className="studio-bot-head">
						<rect x="3" y="2" width="20" height="16" rx="6" className="studio-bot-face" />
						{happy ? (
							<g className="studio-bot-happy">
								<path d="M7.6 11.2c.8-1.6 2.6-1.6 3.4 0" />
								<path d="M15 11.2c.8-1.6 2.6-1.6 3.4 0" />
							</g>
						) : (
							<g className="studio-bot-eyes">
								<rect x="8" y="7.5" width="3" height="5.5" rx="1.5" />
								<rect x="15" y="7.5" width="3" height="5.5" rx="1.5" />
							</g>
						)}
						{agent.role === 'lead' ? (
							<g className="studio-bot-antenna">
								<path d="M13 2V1.2" />
								<circle cx="13" cy="1" r="1" />
							</g>
						) : null}
						{agent.role === 'verifier' ? (
							<rect className="studio-bot-visor" x="6" y="4.2" width="14" height="1.6" rx=".8" />
						) : null}
					</g>
				</g>
			</svg>
			{agent.verb === 'thinking' && !face ? (
				<span className="studio-bot-dots">
					<i />
					<i />
					<i />
				</span>
			) : null}
		</span>
	);
}
