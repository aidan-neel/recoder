import type { GuidePart } from '../changes/types';

/** One step of the walkthrough: a part of the change to read, with the files and open bugs in it. */
export interface WalkthroughStep {
	id: string;
	/** What the step covers: the part's title, or the area of the change it reads. */
	title: string;
	/** The line under the title: why the part matters, or the names of the area's files. */
	note: string;
	paths: string[];
	/** Open findings in the step's files. */
	bugs: number;
}

/** How a lens plan titles a part: `<area> · <lens>`. */
const LENS_MARK = ' · ';

/** How a title names the repository root; older reviews wrote `.`. */
const ROOT_NAME = 'repository root';

/**
 * The guide as steps to read, in plan order. A lens plan reviews one area of
 * the change several times, once per lens (`src and 2 more folders ·
 * Security`); those parts share their files and become one step, titled by
 * the area, that names its files. Their reasons are the lens's fixed
 * question, the same for every area, so the files say more. Any other part
 * is a step of its own, with its title and reason as the model wrote them.
 */
export function walkthroughSteps(parts: GuidePart[]): WalkthroughStep[] {
	const groups = new Map<string, GuidePart[]>();

	for (const part of parts) {
		const key = areaKey(part) ?? part.id;

		groups.set(key, [...(groups.get(key) ?? []), part]);
	}

	return [...groups.values()].map(toStep);
}

/** The area and files a lens part reviews, as one key; null for a part that is not one. */
function areaKey(part: GuidePart): string | null {
	const split = splitLens(part.title);

	return split ? `${split.area}\n${[...part.paths].sort().join('\n')}` : null;
}

/** `src · Security` as its area and lens; null for a title with no lens. */
function splitLens(title: string): { area: string; lens: string } | null {
	const at = title.lastIndexOf(LENS_MARK);

	if (at <= 0) return null;

	return { area: title.slice(0, at), lens: title.slice(at + LENS_MARK.length) };
}

/** One part as it is, or the lens parts of one area as a single step. */
function toStep(group: GuidePart[]): WalkthroughStep {
	const [first] = group;

	if (group.length === 1) {
		return { id: first.id, title: namedRoot(first.title), note: first.reason, paths: first.paths, bugs: first.bugs };
	}

	return {
		id: first.id,
		title: namedRoot(splitLens(first.title)?.area ?? first.title),
		note: fileNames(first.paths),
		paths: first.paths,
		bugs: first.bugs
	};
}

/** The files by name, `Ky.ts, index.ts`; a name two files share keeps its folder, `core/Ky.ts`. */
function fileNames(paths: readonly string[]): string {
	const names = paths.map((path) => lastParts(path, 1));
	const shared = new Set(names.filter((name, index) => names.indexOf(name) !== index));

	return paths
		.map((path) => {
			const name = lastParts(path, 1);

			return shared.has(name) ? lastParts(path, 2) : name;
		})
		.join(', ');
}

/** The last `count` parts of a path: `source/core/Ky.ts` with 2 is `core/Ky.ts`. */
function lastParts(path: string, count: number): string {
	return path.split('/').slice(-count).join('/');
}

/** A title that opens on `.`, the root folder in reviews written before the server named it. */
function namedRoot(title: string): string {
	return /^\.(?= |$)/.test(title) ? `${ROOT_NAME}${title.slice(1)}` : title;
}
