import type { SkillSummary } from '@recoder/shared';
import { git, readBlobHash, regularBlobs } from '../evidence/git';
import { TtlCache } from '../util/ttl-cache';
import { skillIdentity } from './frontmatter';

/**
 * Where a repository keeps its skills, in the order a name found in more than one is taken from. A top-level
 * `skills/` is where a project keeps the skills it ships to its users, such as a library's own skill.
 */
const SKILL_DIRS = ['.claude/skills', '.agents/skills', 'skills'] as const;

const SKILL_FILE = /^(?:\.claude\/|\.agents\/)?skills\/([^/]+)\/SKILL\.md$/;

/** The most skills one repository lists. */
const MAX_LISTED_SKILLS = 50;

/** The most characters of a `SKILL.md` a reader gets. */
const MAX_SKILL_CHARS = 20_000;

/** Blobs read at once, so a repository with many skills does not start that many git processes together. */
const READ_BATCH = 8;

/** How long a commit's skill index is kept. A commit never changes, so this only bounds memory and a lost copy. */
const INDEX_TTL_MS = 5 * 60_000;

/** A commit in a git copy on this server. */
export interface SkillRevision {
	root: string;
	sha: string;
}

/** A skill with its `SKILL.md`, cut to `MAX_SKILL_CHARS`. */
export interface LoadedSkill extends SkillSummary {
	text: string;
	/** True when `text` is only the start of the file. */
	truncated: boolean;
}

/** A skill found at one commit, with the object its `SKILL.md` is stored as. */
interface IndexedSkill extends SkillSummary {
	hash: string;
}

const indexes = new TtlCache<IndexedSkill[]>(INDEX_TTL_MS, 100);

/**
 * The skills at these commits, by name. A name found at an earlier commit is taken from it, so a pull request's
 * head listed before its target shows the head's version. At most `MAX_LISTED_SKILLS`.
 */
export async function listSkills(revisions: readonly SkillRevision[], signal?: AbortSignal): Promise<SkillSummary[]> {
	const found = await mergedIndex(revisions, signal);

	return [...found.values()]
		.map(({ name, description, path }) => ({ name, description, path }))
		.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
		.slice(0, MAX_LISTED_SKILLS);
}

/**
 * The named skills with their text, each from the first commit that has it, and the names no commit has.
 * The result follows the order of `names`.
 */
export async function findSkills(
	revisions: readonly SkillRevision[],
	names: readonly string[],
	signal?: AbortSignal
): Promise<{ skills: LoadedSkill[]; missing: string[] }> {
	const found = await mergedIndex(revisions, signal);
	const skills: LoadedSkill[] = [];
	const missing: string[] = [];

	for (const name of names) {
		const entry = found.get(name);
		const loaded = entry ? await readSkillText(entry, signal) : null;

		if (loaded) skills.push(loaded);
		else missing.push(name);
	}

	return { skills, missing };
}

/** Every commit's skills in one map; a name already there is kept. */
async function mergedIndex(
	revisions: readonly SkillRevision[],
	signal: AbortSignal | undefined
): Promise<Map<string, IndexedSkillAt>> {
	const merged = new Map<string, IndexedSkillAt>();

	for (const revision of revisions) {
		for (const skill of await indexOf(revision, signal)) {
			if (!merged.has(skill.name)) merged.set(skill.name, { ...skill, root: revision.root });
		}
	}

	return merged;
}

/** A skill together with the git copy that holds its `SKILL.md`. */
interface IndexedSkillAt extends IndexedSkill {
	root: string;
}

function indexOf(revision: SkillRevision, signal: AbortSignal | undefined): Promise<IndexedSkill[]> {
	return indexes.get(`${revision.root}\0${revision.sha}`, () => indexRevision(revision, signal));
}

/**
 * The skills one commit ships. Only regular files count: a symlinked skill folder (`.claude/skills/x` pointing at
 * `.agents/skills/x`) is one link entry, which is skipped, so a skill reached by two paths is listed once under the
 * path that really holds it, and a link out of the repository is never followed.
 */
async function indexRevision({ root, sha }: SkillRevision, signal: AbortSignal | undefined): Promise<IndexedSkill[]> {
	const listed = await git(root, ['ls-tree', '-r', '-z', sha, '--', ...SKILL_DIRS], signal);

	if (listed.code !== 0) {
		throw new Error(`Could not list the skills at ${sha.slice(0, 12)}: ${listed.stderr.slice(0, 200) || 'git failed'}`);
	}

	const candidates = skillFiles(listed.stdout).slice(0, MAX_LISTED_SKILLS);
	const named = new Map<string, IndexedSkill>();

	for (let start = 0; start < candidates.length; start += READ_BATCH) {
		const batch = candidates.slice(start, start + READ_BATCH);
		const read = await Promise.all(batch.map((file) => readIdentity(root, file, signal)));

		for (const skill of read) {
			if (skill && !named.has(skill.name)) named.set(skill.name, skill);
		}
	}

	return [...named.values()];
}

/** The `SKILL.md` files in an `ls-tree` listing, in the order of `SKILL_DIRS`, each by path. */
function skillFiles(lsTreeOutput: string): { path: string; hash: string; folder: string }[] {
	const files = [...regularBlobs(lsTreeOutput)].flatMap(([path, hash]) => {
		const folder = SKILL_FILE.exec(path)?.[1];

		return folder ? [{ path, hash, folder }] : [];
	});

	return files.sort((a, b) => dirRank(a.path) - dirRank(b.path) || (a.path < b.path ? -1 : 1));
}

function dirRank(path: string): number {
	return SKILL_DIRS.findIndex((dir) => path.startsWith(`${dir}/`));
}

/** What a `SKILL.md` calls itself; null when it can't be read as text or names no valid skill. */
async function readIdentity(
	root: string,
	file: { path: string; hash: string; folder: string },
	signal: AbortSignal | undefined
): Promise<IndexedSkill | null> {
	const blob = await readBlobHash(root, file.hash, signal);

	if (!blob.ok) return null;

	const identity = skillIdentity(blob.text, file.folder);

	return identity ? { ...identity, path: file.path, hash: file.hash } : null;
}

/** The skill's `SKILL.md`, cut to `MAX_SKILL_CHARS`; null when it can't be read. */
async function readSkillText(skill: IndexedSkillAt, signal: AbortSignal | undefined): Promise<LoadedSkill | null> {
	const blob = await readBlobHash(skill.root, skill.hash, signal);

	if (!blob.ok) return null;

	return {
		name: skill.name,
		description: skill.description,
		path: skill.path,
		text: blob.text.slice(0, MAX_SKILL_CHARS),
		truncated: blob.text.length > MAX_SKILL_CHARS
	};
}
