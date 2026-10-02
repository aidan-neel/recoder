import { chromium } from 'playwright@1.60.0';
const url = process.argv[2];
const b = await chromium.launch();
for (const scheme of ['dark','light']) {
  const p = await b.newPage({ viewport:{width:1440,height:900}, colorScheme:scheme });
  const errs=[]; p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
  await p.goto(url); await p.waitForTimeout(1500);
  await p.screenshot({path:`clawd-${scheme}.png`});
  console.log(scheme, errs.slice(0,3));
}
await b.close();
