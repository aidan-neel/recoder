import { access, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GUIDELINES_PATH, GUIDELINES_PATHS } from '@recoder/shared';
import { describeError, errorCode } from '../exit.js';
import { failedStep, type InitStep } from './init-step.js';

/**
 * What a new guidelines file starts as: the sections reviewers read, with nothing under them. A file with no rules is
 * not sent to the reviewers, so the starter changes no review until someone writes a rule.
 */
const STARTER = `# Review rules for this repository

## Focus

-

## Ignore

-

## Conventions

-
`;

const STEP = { id: 'guidelines', label: 'Review rules' } as const;

/**
 * Gives a project its guidelines file, `RECODER.md`, which reviewers read from the base branch of every change. A
 * project that already has one, under either name the review reads, keeps it untouched.
 */
export async function createGuidelinesStep(projectFolder: string): Promise<InitStep> {
	try {
		const existing = await firstExisting(GUIDELINES_PATHS.map((path) => join(projectFolder, path)));

		if (existing !== null) return { ...STEP, state: 'unchanged', detail: 'already there', path: existing, fix: null };

		const path = join(projectFolder, GUIDELINES_PATH);

		await writeFile(path, STARTER, { flag: 'wx' });

		return { ...STEP, state: 'done', detail: 'created', path, fix: null };
	} catch (error) {
		return failedStep({ ...STEP, path: join(projectFolder, GUIDELINES_PATH) }, describeError(error));
	}
}

async function firstExisting(paths: readonly string[]): Promise<string | null> {
	for (const path of paths) {
		if (await exists(path)) return path;
	}

	return null;
}

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);

		return true;
	} catch (error) {
		if (errorCode(error) === 'ENOENT') return false;

		throw error;
	}
}
