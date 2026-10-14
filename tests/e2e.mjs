// End-to-end smoke test: drives the real app in Chrome. Usage: node tests/e2e.mjs <outDir>
import puppeteer from 'puppeteer-core';
const out = process.argv[2] || '.';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--window-size=1440,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' });
await page.screenshot({ path: `${out}/01-empty.png` });
// Starter: Devanagari + Playfair
await page.click('#starters [data-i="0"]');
await page.waitForFunction(() => document.querySelector('#statusText')?.textContent.startsWith('Built') && document.querySelectorAll('.donor').length === 1, { timeout: 60000 });
await new Promise(r => setTimeout(r, 1200));
console.log('status:', await page.$eval('#statusText', e => e.textContent));
console.log('warn:', await page.$eval('#warnText', e => e.textContent));
await page.screenshot({ path: `${out}/02-remix.png` });
// Move sliders
for (const [id, v] of [['#sl-weight', 40], ['#sl-slant', 8], ['#sl-roundness', 25]]) {
  await page.$eval(id, (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, v);
}
await new Promise(r => setTimeout(r, 1500));
console.log('status2:', await page.$eval('#statusText', e => e.textContent));
await page.click('.seg [data-compare="split"]');
await page.screenshot({ path: `${out}/03-params.png` });
// Glyphs
await page.goto('http://localhost:5173/#glyphs');
await new Promise(r => setTimeout(r, 1500));
await page.click('.gcell:nth-child(60)');
await new Promise(r => setTimeout(r, 500));
await page.screenshot({ path: `${out}/04-glyphs.png` });
// Drag a point
const pt = await page.$('.editor .pt-on');
const bb = await pt.boundingBox();
await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.mouse.down();
await page.mouse.move(bb.x + 60, bb.y - 40, { steps: 5 }); await page.mouse.up();
await new Promise(r => setTimeout(r, 1200));
console.log('edited cells:', await page.$$eval('.gcell.is-edited', e => e.length), '| undo enabled:', await page.$eval('#undoBtn', b => !b.disabled));
await page.screenshot({ path: `${out}/05-edit.png` });
await page.goto('http://localhost:5173/#library'); await new Promise(r => setTimeout(r, 2500));
await page.screenshot({ path: `${out}/06-library.png` });
await page.goto('http://localhost:5173/#scripts'); await new Promise(r => setTimeout(r, 2500));
await page.screenshot({ path: `${out}/07-scripts.png` });
await page.goto('http://localhost:5173/#remix'); await new Promise(r => setTimeout(r, 3000));
console.log('restored:', await page.$eval('#statusText', e => e.textContent));
await page.click('#exportBtn'); await new Promise(r => setTimeout(r, 400));
await page.screenshot({ path: `${out}/08-export.png` });
await page.goto('http://localhost:5173/#learn'); await new Promise(r => setTimeout(r, 800));
await page.screenshot({ path: `${out}/09-learn.png` });
console.log('errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
