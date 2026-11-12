import type { Node } from 'web-tree-sitter';
import { mark, type Mark } from './marks.js';
import { calleeName, clip, field, lastName, lineOf, operatorOf, squash, unwrap } from './syntax.js';

/** A field whose value is an entity's state: `status`, `state`, `phase`, `lifecycle`, or `jobStatus`, `reviewState`. */
const STATE_FIELD = /^(status|state|phase|lifecycle)$|[a-z0-9](Status|State|Phase)$/;

/** Who holds an entity and until when: `lease`, `leaseUntil`, `lockedBy`, `claimedAt`, `heartbeatAt`. */
const LEASE_FIELD = /^(lease|lock|locked|claim|claimed|heartbeat)([A-Z_]|$)/;

/** A flag that ends or suspends an entity's life: `closed`, `isCancelled`, `expired`, `superseded`. */
const LIFECYCLE_FLAG =
	/^(is)?(cancell?ed|aborted|closed|done|finished|completed|deleted|archived|expired|revoked|stale|disposed|released|settled|superseded)$/i;

/** Calls that are a move in themselves: a cache invalidation, a queue's ack, a lease renewal, `markAsDone`. */
const TRANSITION_CALL =
	/^(invalidate\w*|evict\w*|expire|enqueue|dequeue|requeue|ack|nack|renew\w*|release[A-Z]\w*|claim\w*|supersede\w*|markAs[A-Z]\w*|transition\w*|set(Status|State|Phase))$/;

/** Methods that insert, replace or remove an entry, which count when their receiver is a cache, queue or lease table. */
const CONTAINER_METHODS = new Set([
	'set',
	'delete',
	'clear',
	'add',
	'push',
	'unshift',
	'shift',
	'pop',
	'put',
	'upsert',
	'remove'
]);

/** The last word of a receiver that holds entries between states: `cache`, `jobQueue`, `leases`, `inFlight`. */
const CONTAINER_WORD = /^(cache|caches|queue|queues|lease|leases|locks|inflight|outbox|backlog)$/i;

const EQUALITY = new Set(['===', '!==', '==', '!=']);

/** Node types that can move or test a state. */
const TYPES = ['assignment_expression', 'pair', 'binary_expression', 'switch_case', 'call_expression'];

/**
 * Every operation on the given lines that moves an entity between states or
 * decides whether it may: a state field set or compared, a lease or lifecycle
 * flag written, and an entry put into or taken out of a cache or queue. A state
 * field set to a literal counts only when the file gives it two states or more,
 * so a single `status: 'ok'` is not taken for a lifecycle.
 */
export function collectTransitionMarks(root: Node, lines: Set<number>): Mark[] {
	const source = root.text.split('\n');
	const states = fieldStates(root);

	return root
		.descendantsOfType(TYPES)
		.filter((node): node is Node => node !== null && lines.has(lineOf(node)))
		.flatMap((node) => transitionMarks(node, states))
		.map((entry) => ({ ...entry, code: clip(source[entry.line - 1] ?? '') }));
}

/** The literal states each state field takes anywhere in the file, by field name. */
function fieldStates(root: Node): Map<string, Set<string>> {
	const states = new Map<string, Set<string>>();

	for (const node of root.descendantsOfType(TYPES)) {
		const written = node ? stateWrite(node) : null;

		if (!written?.literal) continue;

		const values = states.get(written.field) ?? new Set<string>();

		values.add(written.value);
		states.set(written.field, values);
	}

	return states;
}

/** A state field, the value it is set to or compared with, and whether that value is a literal state. */
interface StateWrite {
	field: string;
	subject: string;
	value: string;
	literal: boolean;
	verb: 'sets' | 'tests';
}

/** What a node does to a state field, or null when it touches none. */
function stateWrite(node: Node): StateWrite | null {
	if (node.type === 'assignment_expression') return assigned(field(node, 'left'), field(node, 'right'));
	if (node.type === 'pair') return paired(node);
	if (node.type === 'binary_expression' && EQUALITY.has(operatorOf(node))) return compared(node);
	if (node.type === 'switch_case') return switchedOn(node);

	return null;
}

/**
 * `job.status = 'failed'` or `job.status = next`: a state field on an object, never a local variable,
 * and never set to a number, which is an HTTP status or a count.
 */
function assigned(target: Node | null, value: Node | null): StateWrite | null {
	const name = lastName(target);

	if (!target || !value || !name || target.type === 'identifier' || !STATE_FIELD.test(name)) return null;
	if (value.type === 'number') return null;

	return {
		field: name,
		subject: squash(target.text),
		value: squash(value.text),
		literal: isState(value),
		verb: 'sets'
	};
}

/** `{ status: 'failed' }`: only a literal state, since an object key set from a variable is usually copied, not moved. */
function paired(node: Node): StateWrite | null {
	const written = assigned(field(node, 'key'), field(node, 'value'));

	return written?.literal ? written : null;
}

/** `job.status === 'running'`: a guard on the state the entity is in. */
function compared(node: Node): StateWrite | null {
	const left = field(node, 'left');
	const right = field(node, 'right');
	const [subject, value] = left && isState(left) ? [right, left] : [left, right];

	return testedState(subject, value);
}

/** `case 'running':` in a `switch (job.status)`. */
function switchedOn(node: Node): StateWrite | null {
	const statement = node.parent?.parent;
	const subject = statement?.type === 'switch_statement' ? unwrap(field(statement, 'value') ?? statement) : null;

	return testedState(subject, field(node, 'value'));
}

/** A state field tested against a literal state, or null when either side is something else. */
function testedState(subject: Node | null, value: Node | null): StateWrite | null {
	const name = lastName(subject);

	if (!subject || !value || !name || !STATE_FIELD.test(name) || !isState(value)) return null;

	return { field: name, subject: squash(subject.text), value: squash(value.text), literal: true, verb: 'tests' };
}

/** A string state or an enum member (`Status.Failed`); a number is an HTTP status or a count, not a lifecycle state. */
function isState(node: Node): boolean {
	return node.type === 'string' || (node.type === 'member_expression' && /^[A-Z]/.test(node.text));
}

/** The transition marks one node sets off. */
function transitionMarks(node: Node, states: Map<string, Set<string>>): Mark[] {
	if (node.type === 'call_expression') return callMarks(node);

	const written = stateWrite(node);

	if (written) return stateMarks(node, written, states);

	return node.type === 'assignment_expression' ? flagMarks(node) : [];
}

function stateMarks(node: Node, written: StateWrite, states: Map<string, Set<string>>): Mark[] {
	const known = [...(states.get(written.field) ?? [])];

	if (written.literal && known.length < 2) return [];

	const note = known.length ? `the file gives \`${written.field}\` these states: ${known.join(', ')}` : undefined;
	const preposition = written.verb === 'sets' ? 'to' : 'against';

	return [
		mark(node, 'transition', `${written.verb} \`${written.subject}\` ${preposition} \`${clip(written.value)}\``, {
			key: written.subject,
			value: `${written.verb}${written.value}`,
			note
		})
	];
}

/** `job.leaseUntil = now + ttl` or `this.closed = true`: a lease or lifecycle flag on an object, never a local. */
function flagMarks(node: Node): Mark[] {
	const target = field(node, 'left');
	const value = field(node, 'right');
	const name = lastName(target);

	if (target?.type !== 'member_expression' || !value || !name) return [];
	if (!LEASE_FIELD.test(name) && !LIFECYCLE_FLAG.test(name)) return [];

	const subject = squash(target.text);

	return [
		mark(node, 'transition', `sets \`${subject}\` to \`${clip(value.text)}\``, {
			key: subject,
			value: `sets${squash(value.text)}`
		})
	];
}

/** `cache.delete(key)`, `jobQueue.push(job)`, `invalidate(key)`, `lease.renew()`. */
function callMarks(call: Node): Mark[] {
	const name = calleeName(call) ?? '';
	const callee = field(call, 'function');
	const receiver = callee?.type === 'member_expression' ? field(callee, 'object') : null;
	const owner = lastWord(lastName(receiver) ?? '');
	const moves = TRANSITION_CALL.test(name) || (CONTAINER_METHODS.has(name) && CONTAINER_WORD.test(owner));

	if (!moves) return [];

	const key = receiver ? squash(receiver.text) : name;

	return [
		mark(call, 'transition', `moves an entry with \`${clip(callee?.text ?? name)}\``, { key, value: squash(call.text) })
	];
}

/** The last word of a camel-case or snake-case name: `Queue` for `jobQueue`, `cache` for `file_cache`. */
function lastWord(name: string): string {
	return name.split(/_|(?<=[a-z0-9])(?=[A-Z])/).at(-1) ?? name;
}
