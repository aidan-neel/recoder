import { parseReleaseTag } from '../upgrade/release-tag.js';
import type { UpgradeRequest } from '../upgrade/upgrade.js';
import { UPGRADE_FLAGS } from './flags.js';
import { parseFlags } from './parse.js';

/** Reads the flags of `recoder upgrade`. Throws a `CliError` for a bad one, or a `--to` that is no release. */
export function parseUpgradeArgs(argv: string[]): UpgradeRequest {
	const values = parseFlags(argv, { options: UPGRADE_FLAGS, strict: true, allowPositionals: false });

	return { to: values.to === undefined ? null : parseReleaseTag(values.to), checkOnly: values.check === true };
}
