import { commandRows, factRows } from '../terminal/layout.js';
import type { Surface } from '../terminal/surface.js';
import { indent, padEnd, padStart, plural } from '../terminal/text.js';
import type { ListedModel, ModelList, ModelsQuery } from './model-list.js';

const MARGIN = 2;

const COLUMN_GAP = 3;

/** More models than this are not listed unasked: a machine with OpenCode has over a thousand. */
const MAX_UNFILTERED_MODELS = 40;

/**
 * `recoder models`: the models under their providers with the saved picks marked. A long list that no flag narrowed
 * is summed up by provider instead, with how to narrow it.
 */
export function modelsView(query: ModelsQuery): (list: ModelList, surface: Surface) => string[] {
	const isNarrowed = query.providers !== null || query.search !== null;

	return (list, surface) =>
		isNarrowed || list.models.length <= MAX_UNFILTERED_MODELS ? listView(list, surface) : overview(list, surface);
}

/** The saved picks, how many models each provider has, and the two ways to list fewer. */
function overview(list: ModelList, surface: Surface): string[] {
	const { paint } = surface;
	const providers = providersOf(list.models);
	const counts = providers.map((provider) => list.models.filter((model) => model.provider === provider).length);
	const nameWidth = Math.max(...providers.map((provider) => provider.length));
	const countWidth = String(Math.max(...counts)).length;

	const rows = providers.map(
		(provider, index) => `${padEnd(provider, nameWidth)}  ${paint.muted(padStart(String(counts[index]), countWidth))}`
	);

	const narrowing = commandRows(
		[
			[`recoder models --provider "${providers[0]}"`, "List one provider's models"],
			['recoder models --search opus', 'Find models by name or id']
		],
		surface
	);

	return [
		'',
		...indent(
			[
				paint.strong('Reviews run on'),
				...indent(factRows(savedPicks(list), surface), MARGIN),
				'',
				paint.strong(`${plural(list.models.length, 'model')} from ${plural(providers.length, 'provider')}`),
				...indent(rows, MARGIN),
				'',
				...narrowing,
				...problemLines(list, surface)
			],
			MARGIN
		),
		''
	];
}

function savedPicks(list: ModelList): [string, string][] {
	return [
		['reviewer', list.reviewer ?? 'not chosen yet; run recoder init'],
		['worker', list.worker ?? 'follows the reviewer']
	];
}

/** The models under their providers, the saved picks marked, then what could not be listed. */
function listView(list: ModelList, surface: Surface): string[] {
	const { paint } = surface;

	if (list.models.length === 0) {
		return ['', ...indent(['No model matches.', ...problemLines(list, surface)], MARGIN), ''];
	}

	const groups = providersOf(list.models).flatMap((provider) => [
		'',
		paint.strong(provider),
		...indent(
			providerLines(
				list.models.filter((model) => model.provider === provider),
				list,
				surface
			),
			MARGIN
		)
	]);

	const footer = [
		'',
		paint.muted(
			`${plural(list.models.length, 'model')}. Pass an id to --reviewer or --worker, or save one with recoder init.`
		),
		...problemLines(list, surface)
	];

	return [...indent([...groups, ...footer], MARGIN), ''];
}

/** The providers in the order their first model is listed. */
function providersOf(models: readonly ListedModel[]): string[] {
	return [...new Set(models.map((model) => model.provider))];
}

/** One provider's models, their columns as wide as that provider needs. */
function providerLines(models: readonly ListedModel[], list: ModelList, surface: Surface): string[] {
	const widths = {
		id: Math.max(...models.map((model) => model.id.length)),
		name: Math.max(...models.map((model) => model.name.length))
	};

	return models.map((model) => modelLine(model, list, widths, surface));
}

function modelLine(
	model: ListedModel,
	list: ModelList,
	widths: { id: number; name: number },
	surface: Surface
): string {
	const { paint } = surface;
	const gap = ' '.repeat(COLUMN_GAP);
	const roles = rolesOf(model, list);
	const id = roles.length > 0 ? paint.strong(padEnd(model.id, widths.id)) : padEnd(model.id, widths.id);
	const tags = roles.length > 0 ? `${gap}${paint.ok(roles.join(', '))}` : '';

	return `${id}${gap}${paint.muted(padEnd(model.name, widths.name))}${gap}${paint.muted(effortsOf(model))}${tags}`.trimEnd();
}

/** What the saved settings use this model for. Workers follow the reviewer when no worker is saved. */
function rolesOf(model: ListedModel, list: ModelList): string[] {
	const worker = list.worker ?? list.reviewer;

	return [...(model.id === list.reviewer ? ['reviewer'] : []), ...(model.id === worker ? ['worker'] : [])];
}

/** `low to max, default medium`, or nothing for a model with no effort levels. */
function effortsOf(model: ListedModel): string {
	if (model.efforts.length === 0) return '';

	const range =
		model.efforts.length === 1 ? model.efforts[0] : `${model.efforts[0]} to ${model.efforts[model.efforts.length - 1]}`;

	return model.defaultEffort === null ? range : `${range}, default ${model.defaultEffort}`;
}

function problemLines(list: ModelList, { paint, glyphs }: Surface): string[] {
	return list.problems.map((problem) => `${paint.warning(glyphs.warn)} ${problem}`);
}
