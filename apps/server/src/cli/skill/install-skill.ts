import { randomUUID } from 'node:crypto';
import type { Stats } from 'node:fs';
import { cp, lstat, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describeError, errorCode, usageError } from '../exit.js';
import { SKILL_FOLDER_NAME } from './bundled-skill.js';

/** Which skill to copy and where its folder goes. */
interface SkillInstall {
	/** The skill folder to copy. */
	source: string;
	/** The folder that holds skills; the skill lands in `<skillsFolder>/recoder`. */
	skillsFolder: string;
	/** Replace an existing `recoder` folder. Nothing else in the skills folder is touched. */
	force: boolean;
}

interface InstalledSkill {
	/** Absolute path of the new skill folder. */
	destination: string;
	files: number;
	/** Set when the skill is in place but a leftover could not be removed; the text names it. */
	warning: string | null;
}

/** The two file-system calls whose failure the install has to survive, so a test can make them fail. */
interface FolderOperations {
	rename: (from: string, to: string) => Promise<void>;
	remove: (path: string) => Promise<void>;
}

/** What is at the destination, when it may be replaced. Anything that may never be replaced throws instead. */
type DestinationState = 'absent' | 'folder';

/** The folders one install moves between, all inside the skills folder. */
interface InstallPaths {
	destination: string;
	staging: string;
}

const FILE_SYSTEM: FolderOperations = {
	rename,
	remove: (path) => rm(path, { recursive: true, force: true })
};

/**
 * Copies the skill to `<skillsFolder>/recoder`. The copy is made beside the destination and renamed into place, so a
 * failed copy leaves no half-written skill. A replaced folder is moved aside, not deleted, until the new one is in
 * place, and is moved back when that fails: the user ends with the old skill or the new one, never neither. An
 * existing folder is refused unless `force` is set, and a symbolic link or a file is refused always, because writing
 * through a link would leave the skills folder.
 */
export async function installSkill(
	install: SkillInstall,
	overrides: Partial<FolderOperations> = {}
): Promise<InstalledSkill> {
	const operations = { ...FILE_SYSTEM, ...overrides };
	const destination = join(install.skillsFolder, SKILL_FOLDER_NAME);

	await requireFolderOrNothing(install.skillsFolder);

	const existing = await inspectDestination(destination);

	if (existing === 'folder' && !install.force) {
		throw usageError(`${destination} already exists. Pass --force to replace it.`);
	}

	await mkdir(install.skillsFolder, { recursive: true });

	const paths = { destination, staging: siblingOf(destination, 'install') };

	await copyToStaging(install.source, paths, operations);

	if (existing === 'folder') return installed(destination, await replaceFolder(paths, operations));

	await publishNew(paths, operations);

	return installed(destination, null);
}

async function installed(destination: string, warning: string | null): Promise<InstalledSkill> {
	return { destination, files: await countFiles(destination), warning };
}

async function requireFolderOrNothing(skillsFolder: string): Promise<void> {
	const entry = await statOrNull(skillsFolder, stat);

	if (entry !== null && !entry.isDirectory()) throw usageError(`${skillsFolder} exists and is not a folder.`);
}

/** Looks at the destination before anything is written. */
async function inspectDestination(destination: string): Promise<DestinationState> {
	const entry = await statOrNull(destination, lstat);

	if (entry === null) return 'absent';

	if (entry.isSymbolicLink()) {
		throw usageError(
			`${destination} is a symbolic link, and recoder will not install through it. Remove it or use --dir.`
		);
	}

	if (!entry.isDirectory()) throw usageError(`${destination} is not a folder, and recoder will not replace it.`);

	return 'folder';
}

/** The entry's stats, or null when nothing is there. Any other failure is raised. */
async function statOrNull(path: string, read: (path: string) => Promise<Stats>): Promise<Stats | null> {
	try {
		return await read(path);
	} catch (error) {
		if (errorCode(error) === 'ENOENT') return null;

		throw error;
	}
}

/** A hidden folder beside `path`, named like the staging folder, so no tool takes it for a skill. */
function siblingOf(path: string, purpose: 'install' | 'replaced'): string {
	return join(dirname(path), `.${SKILL_FOLDER_NAME}-${purpose}-${randomUUID()}`);
}

async function copyToStaging(source: string, paths: InstallPaths, operations: FolderOperations): Promise<void> {
	await undoneOnFailure(
		() => cp(source, paths.staging, { recursive: true }),
		() => removeAll([paths.staging], operations)
	);
}

async function publishNew(paths: InstallPaths, operations: FolderOperations): Promise<void> {
	await undoneOnFailure(
		() => operations.rename(paths.staging, paths.destination),
		() => removeAll([paths.staging], operations)
	);
}

/** Moves the old folder aside, puts the new one in its place, then removes the old. Returns a warning if that fails. */
async function replaceFolder(paths: InstallPaths, operations: FolderOperations): Promise<string | null> {
	const aside = siblingOf(paths.destination, 'replaced');

	await undoneOnFailure(
		() => operations.rename(paths.destination, aside),
		() => removeAll([paths.staging], operations)
	);

	await undoneOnFailure(
		() => operations.rename(paths.staging, paths.destination),
		async () => [
			...(await moveBack(aside, paths.destination, operations)),
			...(await removeAll([paths.staging], operations))
		]
	);

	const notes = await removeAll([aside], operations);

	return notes.length === 0 ? null : `The new skill is installed. ${notes.join(' ')}`;
}

/**
 * Runs a step. When it fails, runs the undo, and throws the step's own error: with a note for each undo that failed
 * as well, so a cleanup problem is reported and never takes the place of the failure that caused it.
 */
async function undoneOnFailure(step: () => Promise<unknown>, undo: () => Promise<string[]>): Promise<void> {
	try {
		await step();
	} catch (error) {
		const notes = await undo();

		if (notes.length === 0) throw error;

		throw new Error(`${describeError(error)} ${notes.join(' ')}`, { cause: error });
	}
}

/** Puts the moved-aside folder back. A failure becomes a note that says where the old skill is. */
async function moveBack(aside: string, destination: string, operations: FolderOperations): Promise<string[]> {
	try {
		await operations.rename(aside, destination);

		return [];
	} catch (error) {
		return [`The previous skill could not be moved back and is at ${aside}: ${describeError(error)}.`];
	}
}

/** Removes each path, trying them all. A path that cannot be removed becomes a note that names it. */
async function removeAll(paths: string[], operations: FolderOperations): Promise<string[]> {
	const notes: string[] = [];

	for (const path of paths) {
		try {
			await operations.remove(path);
		} catch (error) {
			notes.push(`${path} could not be removed: ${describeError(error)}. Delete it by hand.`);
		}
	}

	return notes;
}

async function countFiles(folder: string): Promise<number> {
	const entries = await readdir(folder, { recursive: true, withFileTypes: true });

	return entries.filter((entry) => entry.isFile()).length;
}
