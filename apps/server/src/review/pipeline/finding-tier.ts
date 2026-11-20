import { FINDING_TIERS, FINDING_SEVERITIES, findingTier, type FindingTier } from '@recoder/shared';

const ALIASES: Record<string, FindingTier> = {
	high: 'bug',
	critical: 'bug',
	blocker: 'bug',
	major: 'bug',
	medium: 'warning',
	moderate: 'warning',
	warn: 'warning',
	low: 'fyi',
	minor: 'fyi',
	informational: 'fyi',
	nit: 'fyi',
	trivial: 'fyi',
	note: 'fyi',
	suggestion: 'fyi',
	style: 'fyi'
};

/** Model tiers take precedence; aliases remain accepted for older prompts and endpoints. */
export function normalizeFindingTier(finding: Record<string, unknown>): void {
	const value = finding.tier ?? finding.severity;

	if (typeof value !== 'string') return;

	const key = value.trim().toLowerCase();
	const legacy = FINDING_SEVERITIES.find((severity) => severity === key);

	const tier =
		FINDING_TIERS.find((tier) => tier === key) ?? (legacy ? findingTier({ severity: legacy }) : ALIASES[key]);

	if (!tier) return;
	finding.tier = tier;
	finding.severity = ['low', 'medium', 'high'][FINDING_TIERS.indexOf(tier)];
}

/** Normalizes untrusted finding objects before either reviewer schema reads them. */
export function tieredFinding(value: unknown): unknown {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return value;

	const finding = { ...value };

	normalizeFindingTier(finding);

	return finding;
}
