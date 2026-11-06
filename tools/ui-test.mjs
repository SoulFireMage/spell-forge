#!/usr/bin/env node
// Browser UI regression test + screenshots (needs Playwright + Chromium).
//   node tools/ui-test.mjs            → checks, and PNGs in snapshots/
// Drives the real page: boot → Gen 0 crucible → choose two parents → breed →
// lineage rollback → form switch → free-text compile → ManifoldCAD script.
// Fails on any console error.
import { mkdirSync } from 'node:fs';
import { serve } from './serve.mjs';
import { playwright } from './pw.mjs';

const { chromium } = await playwright();
const srv = await serve(8137);
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined;
const browser = await chromium.launch({ proxy, args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
mkdirSync('snapshots', { recursive: true });
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; console.log(`  ✗ ${m}`); } else console.log(`  ✓ ${m}`); };
const T = { timeout: 90000 };

async function run(viewport, tag) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://localhost:8137/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.spellforge && window.spellforge.telemetry, null, T);
  await page.waitForFunction(() => document.querySelectorAll('#grid .cell svg').length === 9, null, T);
  const t0 = await page.evaluate(() => window.spellforge.telemetry);
  ok(t0.status === 'NoError' && t0.bodies === 1, `${tag}: Gen 0 forged watertight (${t0.symmetry}, ${t0.massG} g)`);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `snapshots/ui-${tag}.png` });
  if (tag === 'desktop') {
    await page.click('#grid .cell:nth-child(2)');
    await page.click('#grid .cell:nth-child(7)');
    ok((await page.$$('#grid .cell.parent')).length === 2, `${tag}: two parents chosen`);
    await page.click('#btn-mutate');
    await page.waitForFunction(() => document.querySelector('#gen').textContent === 'Gen 1' && document.querySelectorAll('#grid .cell svg').length === 9, null, T);
    ok(true, `${tag}: bred Gen 1`);
    ok((await page.$$('#lineage .lin')).length === 2, `${tag}: lineage has two generations`);
    await page.click('#lineage .lin:last-child');
    await page.waitForFunction(() => document.querySelector('#gen').textContent === 'Gen 0', null, T);
    ok(true, `${tag}: rolled back to Gen 0`);
    await page.click('#form-kind button[data-v="medallion"]');
    await page.waitForFunction(() => window.spellforge.telemetry && window.spellforge.telemetry.form === 'medallion', null, T);
    ok(true, `${tag}: switched to medallion`);
    await page.selectOption('#slot-0-id', '');
    await page.fill('#slot-0-text', 'courage for the dragon interview');
    await page.click('#btn-compile');
    await page.waitForFunction(() => window.spellforge.genome && /Courage Dragon Interview/.test(window.spellforge.genome.meta.name), null, T);
    ok(true, `${tag}: free-text effect compiled`);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `snapshots/ui-${tag}-2.png` });
    const script = await page.evaluate(() => window.spellforge.manifoldCadScript());
    ok(script.includes('compileSigil') && script.includes("from 'manifold-3d/manifoldCAD'"), `${tag}: ManifoldCAD script built`);
  }
  ok(errors.length === 0, `${tag}: no console errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
  await ctx.close();
}

try {
  await run({ width: 1440, height: 900 }, 'desktop');
  await run({ width: 390, height: 844 }, 'phone');
} finally {
  await browser.close();
  srv.close();
}
console.log(failures ? `${failures} UI failures` : 'UI OK');
process.exit(failures ? 1 : 0);
