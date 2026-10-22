import type { FindingClaim } from '@recoder/shared';

import { where } from '@/lib/review/labels';

import { InlineText } from '@/components/common/inline-text';

/**
 * How a finding breaks, as a path down a thin rail: the trigger, each step
 * through the code, the consequence (a red node), then the rule it breaks and
 * the guard that should have caught it.
 */
export function ClaimSteps({ claim }: { claim: FindingClaim }) {
	return (
		<>
			<ol className="claim">
				<li className="claim-step" data-end="start">
					<span className="claim-label">When</span>
					<span className="claim-text">
						<InlineText text={claim.trigger} />
					</span>
				</li>
				{claim.executionPath.map((step, index) => (
					<li key={index} className="claim-step">
						<span className="claim-label font-mono text-[11.5px]">{where(step.file, step.line, null, true)}</span>
						<span className="claim-text">{step.note ? <InlineText text={step.note} /> : null}</span>
					</li>
				))}
				<li className="claim-step" data-end="end">
					<span className="claim-label">Then</span>
					<span className="claim-text">
						<InlineText text={claim.consequence} />
					</span>
				</li>
			</ol>
			<p className="claim-contract">
				<span>Breaks</span> <InlineText text={claim.violatedContract} />
			</p>
			{claim.existingGuard ? (
				<p className="claim-contract">
					<span>Not caught by</span> <InlineText text={claim.existingGuard} />
				</p>
			) : null}
		</>
	);
}
