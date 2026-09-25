import { redirect } from '@sveltejs/kit';
import { docs } from '$lib/docs';

export function load() {
	redirect(307, `/docs/${docs[0].slug}`);
}
