import { tildePath } from '../terminal/home-path.js';
import type { Surface } from '../terminal/surface.js';
import { indent } from '../terminal/text.js';
import type { UpgradeResult } from './upgrade.js';

const MARGIN = 2;

/** `recoder upgrade`: what was installed and where, that a release is waiting, or that there is nothing to do. */
export function upgradeView(result: UpgradeResult, { paint, glyphs }: Surface): string[] {
	const { state, currentVersion, targetVersion, path } = result;

	if (state === 'current') {
		return framed([`${paint.ok(glyphs.ok)} ${paint.strong(`recoder ${currentVersion}`)} is the newest release.`]);
	}

	if (state === 'available') {
		return framed([
			`${paint.info(glyphs.dot)} ${paint.strong(`recoder ${targetVersion}`)} is available. You have ${currentVersion}.`,
			...indent([paint.muted('Run recoder upgrade to install it.')], MARGIN)
		]);
	}

	const where = path === null ? [] : [paint.muted(tildePath(path))];

	return framed([
		`${paint.ok(glyphs.ok)} ${paint.strong(`Upgraded recoder ${currentVersion} ${glyphs.arrow} ${targetVersion}`)}`,
		...indent([...where, paint.muted('Run recoder init to refresh the agent skill.')], MARGIN)
	]);
}

function framed(lines: readonly string[]): string[] {
	return ['', ...indent(lines, MARGIN), ''];
}
