import { NextResponse, type NextRequest } from 'next/server';

/**
 * An address no route answers, so Next renders the app's own 404 page for
 * it. A folder whose name starts with an underscore is private in the App
 * Router, so no page can ever take this path.
 */
const NOWHERE = '/_nowhere';

/** True when a part of the path is a percent escape that does not decode, such as `%E0%A4%A`, `%ZZ` or a lone `%`. */
export function malformedPath(pathname: string): boolean {
	return pathname.split('/').some((segment) => {
		try {
			decodeURIComponent(segment);

			return false;
		} catch {
			return true;
		}
	});
}

/**
 * Next decodes a dynamic segment (`/review/[id]`, `/settings/[section]`)
 * before any page runs, and answers a bare 500 when it cannot. The proxy
 * sends such an address to the 404 page first, so the person sees the app's
 * own page. Any other address goes on untouched.
 */
export function proxy(request: NextRequest): NextResponse {
	if (!malformedPath(request.nextUrl.pathname)) return NextResponse.next();

	return NextResponse.rewrite(new URL(NOWHERE, request.url));
}

/**
 * Only an address under a dynamic segment with a `%` in it runs the proxy:
 * other pages, `/_next`, static files and `/api` never do.
 */
export const config = { matcher: ['/review/:id(.*%.*)', '/settings/:section(.*%.*)'] };
