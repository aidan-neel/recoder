import { LOST_CHUNK_TEXT } from './chunk-reload';
import { BOOT_QUEUE_SCRIPT, BOOT_SEARCH_SCRIPT } from './saved-bar';
import { WATCH_BARS_SCRIPT } from './skeleton-handoff';

/**
 * When the watch first checks that the app has mounted. A cold dev server
 * mounts in about 3s. A boot whose scripts are still coming in, or came in
 * just now, waits on (up to {@link SCRIPTS_WAIT_MS}); any other boot gets
 * the reload notice then.
 */
const BOOT_WAIT_MS = 8000;

/**
 * How long the reload notice waits, counted like {@link BOOT_WAIT_MS} from
 * when the page's head ran the watch, while the app's scripts are still on
 * their way: a slow network gets the skeleton, and a request that never ends
 * still gets the notice. The browser shows no progress for a script still in
 * flight, so a boot slower than this cannot be told from one that hangs: it
 * gets the notice too, which goes the moment the app mounts.
 */
const SCRIPTS_WAIT_MS = 15_000;

/** How long the app may take to run and mount once its last script has come in, before the page offers a reload. */
const RUN_WAIT_MS = 2000;

/** What the reload notice says when the app has not mounted in time. */
const STALLED_TEXT = 'Recoder didn’t finish loading.';

/**
 * The `<html>` attribute set while the boot notice shows: common.css hides
 * the page's skeleton under the notice. The app removes it and the notice as
 * it mounts (`clearBootNotice`), so a slow boot that does finish leaves no
 * notice behind. After a lost script, a route that still waits for its page
 * keeps both until a page renders or the app's own notice takes their place
 * (`watchStuckRoute`).
 */
export const BOOT_FAILED_ATTR = 'data-boot-failed';

/**
 * The `<html>` attribute the boot script sets when one of the app's scripts
 * failed to load before the app mounted. A page whose code is lost waits on
 * its skeleton for good, so the mounted app checks its first route
 * (`watchStuckRoute`), then takes the attribute down.
 */
export const LOST_SCRIPT_ATTR = 'data-script-lost';

/**
 * The faces the first screens paint, as a font token and a weight: Inter for
 * the UI and its buttons, Geist Mono for counts and keycaps, Lora for the
 * queue's headline and a review's summary. The token names the family the kit
 * declares, so the files are the ones its stylesheet points at.
 */
const EARLY_FACES = [
	['--font-ui', 400],
	['--font-ui', 500],
	['--font-code', 400],
	['--font-code', 500],
	['--font-ai', 400]
] as const;

/**
 * Runs in `<head>` before first paint. It marks Apple platforms on `<html>`
 * (`data-platform="mac"`), so the boot frame prints the right modifier key
 * before React knows the platform. It starts loading the {@link EARLY_FACES}:
 * the stylesheet has loaded by now (it blocks this script), so the files come
 * in alongside the first paint instead of when text first needs them, and
 * the page's text never swaps faces under the reader. It runs the server
 * skeleton's holds (`WATCH_BARS_SCRIPT`): it sets the full load's longer
 * wait, dates the holds from the first paint and records which bars show.
 * It gives the boot bar's search the size the bar will settle on
 * (`BOOT_SEARCH_SCRIPT`), so a narrow window never sees it shrink when the
 * app takes over, and keeps room for the Queue count the last visit showed
 * (`BOOT_QUEUE_SCRIPT`), so the tab does not widen when the count lands. It
 * also watches the boot: when a script of the app fails to load, or the app
 * has not set `data-mounted` within {@link BOOT_WAIT_MS}, it puts a plain
 * notice with a Reload button on the page and sets {@link BOOT_FAILED_ATTR}.
 * A slow boot whose scripts are still coming in keeps its skeleton instead,
 * up to {@link SCRIPTS_WAIT_MS}, and gets {@link RUN_WAIT_MS} after the last
 * one lands, so the notice never flashes up just before the app mounts. A
 * script has come in once it fired `load` or the browser timed its request.
 * The first notice stays: a lost script says more than a slow boot. The
 * notice is built without React, since React is what failed. A lost script
 * also sets {@link LOST_SCRIPT_ATTR}, for the app to check its page once it
 * mounts.
 */
export const BOOT_SCRIPT = `(function(){
var r=document.documentElement;
try{if(/Mac|iPhone|iPad/.test(navigator.userAgent))r.setAttribute('data-platform','mac');}catch(e){}
try{var s=getComputedStyle(r);${JSON.stringify(EARLY_FACES)}.forEach(function(f){var family=s.getPropertyValue(f[0]).trim();if(family)document.fonts.load(f[1]+' 16px '+family).catch(function(){});});}catch(e){}
${WATCH_BARS_SCRIPT}
${BOOT_SEARCH_SCRIPT}
${BOOT_QUEUE_SCRIPT}
var box=null;
function show(text){
if(box||r.hasAttribute('data-mounted'))return;
if(!document.body){document.addEventListener('DOMContentLoaded',function(){show(text);});return;}
box=document.createElement('div');
box.setAttribute('data-ui','boot-notice');
box.setAttribute('role','alert');
var line=document.createElement('p');
line.textContent=text;
var button=document.createElement('button');
button.type='button';
button.textContent='Reload';
button.addEventListener('click',function(){location.reload();});
box.appendChild(line);
box.appendChild(button);
document.body.appendChild(box);
r.setAttribute(${JSON.stringify(BOOT_FAILED_ATTR)},'');
}
var started=performance.now(),came=new WeakMap();
addEventListener('load',function(e){var t=e.target;if(t&&t.tagName==='SCRIPT')came.set(t,performance.now());},true);
function arrived(){
var s=document.querySelectorAll('script[src*="/_next/"]'),last=0;
for(var i=0;i<s.length;i++){
if(s[i].noModule)continue;
var timed=performance.getEntriesByName(s[i].src)[0];
var at=came.has(s[i])?came.get(s[i]):timed?timed.responseEnd:Infinity;
if(at>last)last=at;
}
return last;
}
function stalled(){
if(box||r.hasAttribute('data-mounted'))return;
var now=performance.now(),last=0;
try{last=arrived();}catch(e){}
if(now-started<${SCRIPTS_WAIT_MS}&&now-last<${RUN_WAIT_MS}){setTimeout(stalled,250);return;}
show(${JSON.stringify(STALLED_TEXT)});
}
setTimeout(stalled,${BOOT_WAIT_MS});
addEventListener('error',function(e){var t=e.target;if(t&&t.tagName==='SCRIPT'&&/\\/_next\\//.test(t.src||'')&&!r.hasAttribute('data-mounted')){r.setAttribute(${JSON.stringify(LOST_SCRIPT_ATTR)},'');show(${JSON.stringify(LOST_CHUNK_TEXT)});}},true);
})();`;
