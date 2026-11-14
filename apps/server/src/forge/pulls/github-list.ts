import { PULL_LIST_PAGE, type PrCheck } from '@recoder/shared';
import { str } from '../context/sources.js';
import { GhError } from '../cli.js';
import { extractJson, gh, parsePullRow, parseRepoSlug } from '../gh.js';
import { record, records, STATUS_CONTEXT_STATES, tallyChecks, type OpenPulls, type PullEntry } from './status.js';

const PULL_FIELDS = `
	number title url author { login } baseRefName headRefName headRefOid
	additions deletions changedFiles createdAt updatedAt isDraft
	assignees(first: 10) { nodes { login name } }
	commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 1) {
		checkRunCountsByState { state count }
		statusContextCountsByState { state count }
	} } } } }`;

const OPEN_PULLS_QUERY = `
query($owner: String!, $name: String!, $first: Int!, $after: String) {
	repository(owner: $owner, name: $name) {
		pullRequests(states: OPEN, first: $first, after: $after, orderBy: { field: UPDATED_AT, direction: DESC }) {
			pageInfo { hasNextPage endCursor }
			nodes {${PULL_FIELDS}
			}
		}
	}
}`;

/**
 * One page of a repository's open pull requests, most recently updated first,
 * with check counts instead of every check. `after` is the cursor the previous
 * page answered. GitHub answers a page this size in about a second, but times
 * out (502) when it also computes mergeability for 100 pull requests, so the
 * list leaves mergeability `unknown` and the pull request page reads it. Throws GhError.
 */
export async function listGithubPulls(
	repoUrl: string,
	env: Record<string, string>,
	after: string | null
): Promise<OpenPulls> {
	const [owner, name] = parseRepoSlug(repoUrl).split('/');
	const args = ['api', 'graphql', '-f', `query=${OPEN_PULLS_QUERY}`, '-f', `owner=${owner}`, '-f', `name=${name}`];

	args.push('-F', `first=${PULL_LIST_PAGE}`);
	if (after !== null) args.push('-f', `after=${after}`);

	return parsePullPage(extractJson(await gh(args, env)));
}

/** A GraphQL `pullRequests` answer as entries and the cursor of the next page, null on the last. */
function parsePullPage(response: unknown): OpenPulls {
	const body = record(response);
	const connection = record(record(record(body.data).repository).pullRequests);

	if (!Array.isArray(connection.nodes)) {
		throw new GhError(
			'unknown',
			`GitHub's pull request list had no pull requests: ${JSON.stringify(body.errors ?? body)}`
		);
	}

	const pageInfo = record(connection.pageInfo);
	const endCursor = str(pageInfo.endCursor);

	return {
		entries: records(connection.nodes).map(pullEntry),
		nextCursor: pageInfo.hasNextPage === true && endCursor ? endCursor : null
	};
}

function pullEntry(node: Record<string, unknown>): PullEntry {
	const pull = parsePullRow({ ...node, assignees: records(record(node.assignees).nodes) }, 0);

	return {
		pull,
		status: {
			state: 'open',
			draft: node.isDraft === true,
			mergeability: 'unknown',
			updatedAt: str(node.updatedAt) ?? pull.createdAt,
			checks: tallyChecks(headCheckStates(node)),
			commits: null
		}
	};
}

/** Every check of the head commit as a state, from the counts GitHub gives per state. */
function headCheckStates(node: Record<string, unknown>): PrCheck['state'][] {
	const [commit] = records(record(node.commits).nodes);
	const contexts = record(record(record(commit?.commit).statusCheckRollup).contexts);

	return [
		...statesOf(contexts.checkRunCountsByState, CHECK_RUN_STATES),
		...statesOf(contexts.statusContextCountsByState, STATUS_CONTEXT_STATES)
	];
}

/** `count` entries of each state in `counts`; a state not in `known` is a failure. */
function statesOf(counts: unknown, known: Record<string, PrCheck['state']>): PrCheck['state'][] {
	return records(counts).flatMap((entry) =>
		Array.from({ length: Number(entry.count) || 0 }, () => known[String(entry.state)] ?? 'failed')
	);
}

const CHECK_RUN_STATES: Record<string, PrCheck['state']> = {
	SUCCESS: 'passed',
	NEUTRAL: 'skipped',
	SKIPPED: 'skipped',
	IN_PROGRESS: 'pending',
	PENDING: 'pending',
	QUEUED: 'pending',
	WAITING: 'pending',
	REQUESTED: 'pending'
};
