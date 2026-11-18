import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { copyTree, removeOverlayDirs } from './overlay.js';
import type { SandboxLayout } from './sandbox-layout.js';

/**
 * Files and folders at a repository's root that an agent CLI takes as its own instructions, settings, skills or
 * plugins when it works there. The pull request controls them, so an agent's copy of the checkout leaves them out.
 */
const CLI_CONFIG = [
	'AGENTS.md',
	'CLAUDE.md',
	'opencode.json',
	'opencode.jsonc',
	'.opencode',
	'.claude',
	'.agents',
	'.codex'
];

/**
 * Makes a private copy of the head checkout for one agent that works with its CLI's own tools, and returns its
 * path. What the agent writes or breaks there reaches neither the review's checkout nor another agent. The copy
 * holds whatever the checkout holds, installed dependencies included, so it must be taken while no command runs
 * there. It sits in the review's cache folder and goes with it.
 */
export async function copyCheckoutFor(layout: SandboxLayout, owner: string): Promise<string> {
	const copy = join(layout.cacheDir, 'agents', owner.replace(/[^\w.-]/g, '_'));

	await removeOverlayDirs(copy);
	await copyTree(layout.checkout, copy);
	await Promise.all(CLI_CONFIG.map((name) => rm(join(copy, name), { recursive: true, force: true })));

	return copy;
}

/** Deletes an agent's copy of the checkout, including files its commands left without write permission. */
export function removeCheckoutCopy(copy: string): Promise<void> {
	return removeOverlayDirs(copy);
}
