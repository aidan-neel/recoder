import { CHAT_LIMIT } from '../pulls/list-store';
import { API_BASE } from './http';

/**
 * What every live page reads as the shell mounts: the connections, the
 * tracked repositories, the reviews, the newest chats, the pull request list,
 * the agents and the models. Each must match the path its API call builds,
 * or the call simply reads again.
 */
const SHELL_PATHS = [
	'/api/auth/status',
	'/api/repos',
	'/api/reviews?view=summary',
	`/api/chats?limit=${CHAT_LIMIT}`,
	'/api/pulls',
	'/api/agent',
	'/api/settings/models'
];

/** A page's own first reads, from its address: `$1` and `$2` are the address's parts, already encoded. */
interface PageReads {
	pattern: string;
	paths: string[];
}

const PAGE_READS: PageReads[] = [
	{ pattern: '^/pulls/([^/]+)/(\\d+)$', paths: ['/api/repos/$1/pulls/$2/page', '/api/repos/$1/pulls/$2/diff'] },
	{ pattern: '^/repos/([^/]+)$', paths: ['/api/repos/$1/overview'] },
	{ pattern: '^/review/([^/]+)$', paths: ['/api/reviews/$1'] },
	{ pattern: '^/chats/([^/]+)$', paths: ['/api/chats/$1'] }
];

/**
 * Runs in `<head>` while the page still parses, so the live app's first
 * reads are on the wire before its code has even loaded: who is signed in,
 * then, once someone is, the shell's reads and the page's own. The app takes
 * each answer once through `takeEarly` instead of asking again. The sample
 * reads nothing from the server, so it starts nothing. A server that cannot
 * be reached rejects the read, and the app's own call reports it as usual.
 */
export const EARLY_FETCH_SCRIPT = `(function(){var p=location.pathname;if(/^\\/sample(\\/|$)/.test(p))return;var b=${JSON.stringify(API_BASE)};var e=window.__recoderEarly={};function get(path){var r=fetch(b+path,{credentials:'include'});r.catch(function(){});e[path]={at:Date.now(),response:r};return r;}get('/api/auth/me').then(function(r){return r.ok?r.clone().json():null;}).then(function(a){if(!a||!a.account)return;var s=${JSON.stringify(SHELL_PATHS)};for(var i=0;i<s.length;i++)get(s[i]);var g=${JSON.stringify(PAGE_READS)};for(var j=0;j<g.length;j++){var x=new RegExp(g[j].pattern);if(!x.test(p))continue;for(var k=0;k<g[j].paths.length;k++)get(p.replace(x,g[j].paths[k]));}})['catch'](function(){});})();`;
