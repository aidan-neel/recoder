import { agentTools } from '../env.js';

/** The id the evidence store gives its `seq`th record. */
export function evidenceId(seq: number): string {
	return `ev_${seq}`;
}

const EVIDENCE_ID = /^ev_\d+$/;

/** Citations one finding keeps. */
const MAX_CITATIONS = 12;

/**
 * The evidence a finding cites, from what the model wrote in `evidenceIds`. An agent on its CLI's own tools
 * (`RECODER_AGENT_TOOLS=cli`) has no id for what it read or ran, and writes a path or a command there. Those are
 * left out, so the finding is not dropped for citing evidence that was never provided.
 */
export function findingCitations(ids: unknown[]): string[] {
	const cited = ids.filter((id): id is string => typeof id === 'string' && id !== '');

	return (agentTools() === 'cli' ? cited.filter((id) => EVIDENCE_ID.test(id)) : cited).slice(0, MAX_CITATIONS);
}
