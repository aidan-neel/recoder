import { formatCost, type Cost } from '@/lib/usage/usage-model';

/**
 * A cost in dollars, or a dash when no call has a known price. A sum that
 * leaves out models with no price ends in a quiet +, since the real cost is
 * higher; the note under the Breakdown names the models it leaves out.
 */
export function CostText({ cost }: { cost: Cost }) {
	return (
		<>
			{formatCost(cost.usd)}
			{cost.usd === null || cost.complete ? null : <span className="usage-plus">+</span>}
		</>
	);
}
