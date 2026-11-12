import { GUIDELINES_PATHS } from '@recoder/shared';
import { INSTRUCTION_PATHS } from '../../pipeline/harness/understand.js';
import { effectiveRuleScope, nestedFolderOf } from './glob.js';
import { EXTRA_ROOT_PATHS, GLOBAL_SOURCE } from './sources.js';
import { ruleSummary, type MechanicalCheck, type RepoRule } from './types.js';

const ROOT_ORDER = [...INSTRUCTION_PATHS, ...EXTRA_ROOT_PATHS];

const DIRECTIVE_STOPWORDS = new Set([
	'a',
	'all',
	'allow',
	'allowed',
	'always',
	'an',
	'and',
	'any',
	'are',
	'avoid',
	'ban',
	'banned',
	'be',
	'can',
	'code',
	'disallow',
	'disallowed',
	'do',
	'dont',
	'each',
	'every',
	'file',
	'files',
	'for',
	'forbid',
	'forbidden',
	'from',
	'in',
	'instead',
	'into',
	'is',
	'keep',
	'may',
	'must',
	'never',
	'no',
	'not',
	'of',
	'ok',
	'on',
	'only',
	'or',
	'over',
	'permit',
	'permitted',
	'prefer',
	'preferred',
	'put',
	'rather',
	'repo',
	'repository',
	'require',
	'required',
	'should',
	'than',
	'that',
	'the',
	'their',
	'this',
	'to',
	'under',
	'use',
	'using',
	'when',
	'with',
	'without',
	'write'
]);

const FORBID_RE = /\b(?:never|do\s+not|don't|forbid\w*|disallow\w*|avoid|ban\w*|without|no\s+[a-z])/i;
const ALLOW_RE = /\b(?:allow\w*|permit\w*|may\b|can\b|ok\s+to|acceptable)\b/i;
const LIMIT_RE = /\b(\d+)\s*(lines?|characters?|chars?|columns?|cols?|parameters?|params?|arguments?|args?)\b/i;

const CHOICE_GROUPS: ReadonlyArray<ReadonlySet<string>> = [
	new Set(['tab', 'space']),
	new Set(['single', 'double']),
	new Set(['sivir', 'radix', 'mui', 'chakra', 'antd']),
	new Set(['interface', 'type']),
	new Set(['named', 'default'])
];

interface SourceRank {
	tier: 0 | 1 | 2 | 3;
	rank: number;
	folder?: string;
}

function sourceRank(path: string): SourceRank {
	const guidelineIndex = GUIDELINES_PATHS.findIndex((entry) => entry === path);

	if (guidelineIndex >= 0) return { tier: 0, rank: guidelineIndex };
	if (path === GLOBAL_SOURCE) return { tier: 1, rank: 0 };

	const folder = nestedFolderOf(path);

	if (folder !== undefined) {
		return { tier: 2, rank: path.endsWith('/AGENTS.md') ? 0 : 1, folder };
	}

	const rootIndex = ROOT_ORDER.indexOf(path);

	return { tier: 3, rank: rootIndex >= 0 ? rootIndex : ROOT_ORDER.length };
}

/**
 * Compares two guideline sources by precedence: negative when `pathA` wins over
 * `pathB`, positive when `pathB` wins, and `0` when equal or in disjoint nested
 * folders that never govern the same path.
 *
 * Order: repo `RECODER.md` (else `.recoder/REVIEW.md`) > global `Recoder guidelines`
 * > nested folder `AGENTS.md` / `CLAUDE.md` (deeper folder wins within its subtree,
 * `AGENTS.md` over `CLAUDE.md`) > root instruction files in loader order.
 */
export function compareSourcePrecedence(pathA: string, pathB: string): number {
	if (pathA === pathB) return 0;

	const a = sourceRank(pathA);
	const b = sourceRank(pathB);

	if (a.tier === 2 && b.tier === 2 && a.folder && b.folder) {
		if (a.folder === b.folder) return a.rank - b.rank;
		if (a.folder.startsWith(`${b.folder}/`)) return -1;
		if (b.folder.startsWith(`${a.folder}/`)) return 1;

		return 0;
	}

	return a.tier - b.tier || a.rank - b.rank || pathA.localeCompare(pathB);
}

function directoryPrefix(glob: string | undefined): string | undefined {
	if (!glob || glob.startsWith('*')) return undefined;

	const wild = glob.search(/[*?[{]/);
	const prefix = (wild >= 0 ? glob.slice(0, wild) : glob).replace(/\/+$/, '');

	return prefix || undefined;
}

function extensionSuffix(glob: string | undefined): string | undefined {
	if (!glob) return undefined;

	const match = /\*(\.[a-z0-9]+)$/i.exec(glob);

	return match?.[1]?.toLowerCase();
}

/** Whether two file globs (`undefined` meaning every file) can match a common path. */
function scopesOverlap(scopeA: string | undefined, scopeB: string | undefined): boolean {
	if (!scopeA || !scopeB || scopeA === scopeB) return true;

	const dirA = directoryPrefix(scopeA);
	const dirB = directoryPrefix(scopeB);

	if (dirA && dirB && dirA !== dirB && !dirA.startsWith(`${dirB}/`) && !dirB.startsWith(`${dirA}/`)) {
		return false;
	}

	const extA = extensionSuffix(scopeA);
	const extB = extensionSuffix(scopeB);

	if (extA && extB && extA !== extB) return false;

	return true;
}

function normalizeUnit(raw: string): string {
	const lower = raw.toLowerCase();

	if (lower.startsWith('line')) return 'line';
	if (lower.startsWith('char')) return 'char';
	if (lower.startsWith('col')) return 'column';

	return 'param';
}

function stemToken(token: string): string {
	if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
	if (token.length > 4 && token.endsWith('es') && !token.endsWith('ses')) return token.slice(0, -1);
	if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);

	return token;
}

function subjectTokens(text: string): string[] {
	const raw = text
		.toLowerCase()
		.replace(/\/\/+/g, ' line comment ')
		.replace(/\/\*\*[\s\S]*?\*\//g, ' jsdoc ')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim()
		.split(/\s+/)
		.filter((word) => word.length >= 2 && !/^\d+$/.test(word) && !DIRECTIVE_STOPWORDS.has(word))
		.map(stemToken);

	return [...new Set(raw)];
}

function polarityOf(text: string): 'forbid' | 'allow' | 'require' {
	if (FORBID_RE.test(text)) return 'forbid';
	if (ALLOW_RE.test(text)) return 'allow';

	return 'require';
}

function checksConflict(a: MechanicalCheck | undefined, b: MechanicalCheck | undefined): boolean {
	if (!a || !b || a.kind !== b.kind) return false;

	if (a.kind === 'max-file-lines' && b.kind === 'max-file-lines') {
		return a.max !== b.max && scopesOverlap(a.glob, b.glob);
	}

	if (a.kind === 'path-pattern' && b.kind === 'path-pattern') {
		return a.files === b.files && a.mustMatch !== b.mustMatch;
	}

	return false;
}

function limitsConflict(textA: string, textB: string): boolean {
	const limitA = LIMIT_RE.exec(textA);
	const limitB = LIMIT_RE.exec(textB);

	if (!limitA || !limitB) return false;

	return normalizeUnit(limitA[2]) === normalizeUnit(limitB[2]) && limitA[1] !== limitB[1];
}

function opposingChoices(tokensA: string[], tokensB: string[]): boolean {
	const shared = tokensA.filter((token) => tokensB.includes(token));

	if (!shared.length) return false;

	return CHOICE_GROUPS.some((group) => {
		const pickA = tokensA.filter((token) => group.has(token));
		const pickB = tokensB.filter((token) => group.has(token));

		return pickA.length > 0 && pickB.length > 0 && !pickA.some((token) => pickB.includes(token));
	});
}

/** Whether two rules state incompatible requirements over overlapping code. */
function rulesConflict(
	a: Pick<RepoRule, 'text' | 'restatement' | 'check'>,
	b: Pick<RepoRule, 'text' | 'restatement' | 'check'>,
	topicA?: string,
	topicB?: string
): boolean {
	if (checksConflict(a.check, b.check)) return true;

	const summaryA = `${ruleSummary(a)} ${a.text}`;
	const summaryB = `${ruleSummary(b)} ${b.text}`;

	if (limitsConflict(summaryA, summaryB)) return true;

	const polarityA = polarityOf(summaryA);
	const polarityB = polarityOf(summaryB);

	if (topicA && topicA === topicB && polarityA !== polarityB) return true;

	const tokensA = subjectTokens(ruleSummary(a));
	const tokensB = subjectTokens(ruleSummary(b));

	if (!tokensA.length || !tokensB.length) return false;
	if (opposingChoices(tokensA, tokensB)) return true;

	if ((polarityA === 'forbid') === (polarityB === 'forbid')) {
		const exclusive = /\bonly\b/i.test(summaryA) || /\bonly\b/i.test(summaryB);

		if (!(topicA && topicA === topicB && exclusive)) return false;
	}

	const shared = tokensA.filter((token) => tokensB.includes(token));
	const minSize = Math.min(tokensA.length, tokensB.length);

	return shared.length === minSize;
}

/**
 * Applies source precedence across `rules`: when a higher-precedence rule
 * disagrees with a lower-precedence rule on overlapping paths, the lower rule
 * records `excludedScopes` and `overriddenBy` so it stops applying there.
 */
export function resolveRulePrecedence(rules: RepoRule[], topics?: ReadonlyMap<string, string>): RepoRule[] {
	const resolved = rules.map((rule) => ({
		...rule,
		...(rule.excludedScopes ? { excludedScopes: [...rule.excludedScopes] } : {})
	}));

	for (let i = 0; i < resolved.length; i++) {
		for (let j = 0; j < resolved.length; j++) {
			if (i === j) continue;

			const winner = resolved[i];
			const loser = resolved[j];

			if (compareSourcePrecedence(winner.source.path, loser.source.path) >= 0) continue;

			const winnerScope = effectiveRuleScope(winner);
			const loserScope = effectiveRuleScope(loser);

			if (!scopesOverlap(winnerScope, loserScope)) continue;
			if (!rulesConflict(winner, loser, topics?.get(winner.id), topics?.get(loser.id))) continue;

			const carvedOut = winnerScope ?? '**';
			const existing = loser.excludedScopes ?? [];

			if (!existing.includes(carvedOut)) {
				loser.excludedScopes = [...existing, carvedOut];
			}

			loser.overriddenBy ??= winner.id;
		}
	}

	return resolved;
}
