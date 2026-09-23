import { chromium } from 'playwright-core';
// usage: bun app.ts <path> <out> [width] [height] [actions-json]
const [path, out, w = '1440', h = '900', actions = '[]'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome' });
const ctx = await browser.newContext({ viewport: { width: +w, height: +h } });
const ids = process.env.MANY ? ['28dee1ee-f7d3-46de-bcb8-e876127b275f','52c09095-b273-4c47-8625-e19c8391fd40','70a97fc1-fb3f-48ca-b525-47423861b51b','b5440484-4d40-4012-a8ab-9775e000cb48','38fcc8cd-3557-4d71-a452-8bd2e51e4046','79567200-10b7-4f21-9b7a-46e66176de00','90e08ef9-e0de-48c7-ab06-e363b8ca79cc','a9e0fc49-7ebb-4478-b56e-21ee85bff1e4'] : ['28dee1ee-f7d3-46de-bcb8-e876127b275f','52c09095-b273-4c47-8625-e19c8391fd40','70a97fc1-fb3f-48ca-b525-47423861b51b','b5440484-4d40-4012-a8ab-9775e000cb48','38fcc8cd-3557-4d71-a452-8bd2e51e4046'];
await ctx.addInitScript((ids) => {
  if (localStorage.getItem('seeded')) return;
  localStorage.setItem('seeded', '1');
  localStorage.setItem('recoder.sessions.v1', JSON.stringify({ activeId: ids[0], sessions: ids.map((id, i) => ({ id, name: 'sivir-ui', ref: null, color: '#5b8cff', status: 'ready' })) }));
}, ids);
const page = await ctx.newPage();
const logs: string[] = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
await page.goto('http://localhost:5173' + path, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
for (const a of JSON.parse(actions)) {
  if (a.hover) await page.hover(a.hover);
  if (a.click) await page.click(a.click, a.button ? { button: a.button } : undefined);
  if (a.press) await page.keyboard.press(a.press);
  if (a.type) await page.keyboard.type(a.type);
  if (a.wait) await page.waitForTimeout(a.wait);
  if (a.shot) await page.screenshot({ path: a.shot });
  if (a.eval) console.log(JSON.stringify(await page.evaluate(a.eval)));
}
await page.screenshot({ path: out });
console.log(logs.slice(0, 15).join('\n'));
await browser.close();
