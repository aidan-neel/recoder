import { AgentMark } from '@recoder/ui';

/** The tile before an agent CLI's name: its logo, or a terminal for a CLI without one. */
export function ProviderMark({ agent }: { agent: string }) {
	return (
		<span className="provider-mark">
			<AgentMark agent={agent} />
		</span>
	);
}
