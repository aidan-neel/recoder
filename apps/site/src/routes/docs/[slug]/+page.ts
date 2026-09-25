import { error } from '@sveltejs/kit';
import { docBySlug, docs } from '$lib/docs';
import type { EntryGenerator, PageLoad } from './$types';

export const entries: EntryGenerator = () => docs.map((doc) => ({ slug: doc.slug }));

export const load: PageLoad = ({ params }) => {
	const doc = docBySlug(params.slug);
	if (!doc) error(404, 'Page not found');
	const index = docs.indexOf(doc);
	return { slug: doc.slug, previous: docs[index - 1] ?? null, next: docs[index + 1] ?? null };
};
