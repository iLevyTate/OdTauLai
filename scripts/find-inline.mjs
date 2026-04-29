// Find every element in the DOM with an on<event> attribute or a style
// attribute and dump enough context to track down the source.
import puppeteer from 'puppeteer';
const URL = process.env.SMOKE_URL || 'http://localhost:8080/';
const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await new Promise(r => setTimeout(r, 800));

const dump = await page.evaluate(() => {
  const onAttrEls = [];
  const styleAttrEls = [];
  document.querySelectorAll('*').forEach(el => {
    for (const a of el.attributes) {
      if (/^on/i.test(a.name)) {
        onAttrEls.push({ tag: el.tagName, id: el.id || '', cls: el.className || '', attr: a.name, value: a.value.slice(0, 100) });
      }
    }
    if (el.hasAttribute('style')) {
      styleAttrEls.push({ tag: el.tagName, id: el.id || '', cls: (el.className || '').toString().slice(0,80), style: el.getAttribute('style').slice(0,150) });
    }
  });
  return { onAttrEls, styleAttrEls };
});

console.log(`\n=== Elements with on<event> attribute (${dump.onAttrEls.length}) ===`);
dump.onAttrEls.forEach(e => console.log(`  ${e.tag}#${e.id}.${e.cls.slice(0,40)} ${e.attr}=${e.value}`));

console.log(`\n=== Elements with style attribute (${dump.styleAttrEls.length}) ===`);
dump.styleAttrEls.forEach(e => console.log(`  ${e.tag}#${e.id}.${e.cls} style="${e.style}"`));

await browser.close();
