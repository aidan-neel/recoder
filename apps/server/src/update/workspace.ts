import { readFile, readdir } from 'node:fs/promises';
import { join, sep } from 'node:path';
import type { UpdateChanges } from '@recoder/shared';

/** The API server's package: what it transitively imports is the server side of an update. */
const SERVER_PACKAGE = '@recoder/server';

/** Root files a `bun install` owes itself to; the server restart rides along since its dependencies may have moved. */
const ROOT_INSTALL_FILES = new Set(['package.json', 'bun.lock', 'bun.lockb']);

/** The repo's workspace packages and which side of the update each is on. */
export interface WorkspaceGraph {
	/** Every workspace package's directory (repo-relative) → its package name. */
	packages: Map<string, string>;
	/** Directories the server transitively imports: its own package plus its workspace dependencies. */
	serverDirs: Set<string>;
	/** Directories the frontends are made of: every other workspace package. */
	webDirs: Set<string>;
}

interface Manifest {
	name?: string;
	workspaces?: string[];
	dependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
}

async function readManifest(path: string): Promise<Manifest | undefined> {
	try {
		return JSON.parse(await readFile(path, 'utf8')) as Manifest;
	} catch {
		return undefined;
	}
}

/** The directories a `workspaces` entry covers: `apps/*` lists each directory inside `apps`, a bare path itself. */
async function workspaceDirs(root: string, patterns: string[]): Promise<string[]> {
	const dirs: string[] = [];

	for (const pattern of patterns) {
		const parent = pattern.endsWith('/*') ? pattern.slice(0, -2) : pattern;

		const children = pattern.endsWith('/*')
			? (await readdir(join(root, parent), { withFileTypes: true }).catch(() => []))
					.filter((entry) => entry.isDirectory())
					.map((entry) => entry.name)
			: [''];

		for (const child of children) dirs.push(child ? `${parent}/${child}` : parent);
	}

	return dirs;
}

/** Each package's workspace dependencies, by directory. */
function dependencyEdges(manifests: Map<string, Manifest>, dirByName: Map<string, string>): Map<string, Set<string>> {
	const edges = new Map<string, Set<string>>();

	for (const [dir, manifest] of manifests) {
		const deps = new Set<string>();

		for (const name of Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies })) {
			const target = dirByName.get(name);

			if (target) deps.add(target);
		}

		edges.set(dir, deps);
	}

	return edges;
}

/** Every directory reachable from `start` through workspace dependencies, `start` included. */
function dependencyClosure(start: string, edges: Map<string, Set<string>>): Set<string> {
	const seen = new Set<string>([start]);
	const queue = [start];

	while (queue.length) {
		for (const next of edges.get(queue.pop() ?? '') ?? []) {
			if (!seen.has(next)) {
				seen.add(next);
				queue.push(next);
			}
		}
	}

	return seen;
}

/**
 * Reads the workspace dependency graph from the repo's package.json files:
 * the workspaces globs name the packages, and each package's dependencies the
 * edges, so a new package needs no change here.
 */
export async function readWorkspaceGraph(root: string): Promise<WorkspaceGraph> {
	const rootManifest = await readManifest(join(root, 'package.json'));
	const dirs = await workspaceDirs(root, rootManifest?.workspaces ?? []);

	const packages = new Map<string, string>();
	const manifests = new Map<string, Manifest>();
	const dirByName = new Map<string, string>();

	for (const dir of dirs) {
		const manifest = await readManifest(join(root, dir, 'package.json'));

		if (!manifest?.name) continue;

		packages.set(dir, manifest.name);
		manifests.set(dir, manifest);
		dirByName.set(manifest.name, dir);
	}

	const edges = dependencyEdges(manifests, dirByName);
	const serverDir = dirByName.get(SERVER_PACKAGE);
	const serverDirs = serverDir ? dependencyClosure(serverDir, edges) : new Set<string>(packages.keys());
	const webDirs = new Set([...packages.keys()].filter((dir) => dir !== serverDir));

	return { packages, serverDirs, webDirs };
}

/** The workspace directory owning a changed path, by longest prefix. */
function ownerOf(path: string, graph: WorkspaceGraph): string | undefined {
	let owner: string | undefined;

	for (const dir of graph.packages.keys()) {
		if ((path === dir || path.startsWith(`${dir}/`)) && (owner === undefined || dir.length > owner.length)) owner = dir;
	}

	return owner;
}

/**
 * Sorts changed repo-relative paths by what the update must do about them.
 * Server-owned paths are server-side and another package's web-side; the root
 * manifest and lockfile cover every package, so they count on both sides.
 * Anything a manifest or lockfile changed owes `bun install`. Paths nothing
 * owns (docs, charts, CI) ask for neither restart nor install.
 */
export function classifyPaths(paths: string[], graph: WorkspaceGraph): UpdateChanges {
	const changes = { server: false, web: false, install: false };

	for (const raw of paths) {
		const path = raw.split(sep).join('/');
		const owner = ownerOf(path, graph);

		if (owner === undefined) {
			if (ROOT_INSTALL_FILES.has(path)) {
				changes.install = true;
				changes.server = true;
				changes.web = true;
			}

			continue;
		}

		if (graph.serverDirs.has(owner)) changes.server = true;
		if (graph.webDirs.has(owner)) changes.web = true;

		if (path === `${owner}/package.json`) changes.install = true;
	}

	return changes;
}
