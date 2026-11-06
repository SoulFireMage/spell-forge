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
// A stand-in Skapi for the account flows, so the test never writes to the real project.
const FAKE_SKAPI = `window.Skapi = class {
  constructor(id, o) { this.cb = o && o.eventListener && o.eventListener.onUserUpdate; this.user = null; this.db = []; Promise.resolve().then(() => this.cb && this.cb(null)); }
  async getProfile() { return this.user; }
  async login({ email }) { this.user = { user_id: 'u1', email, name: 'Kat' }; this.cb && this.cb(this.user); return this.user; }
  async signup(p) { return this.login(p); }
  async logout() { this.user = null; this.cb && this.cb(null); }
  async postRecord(data, cfg) { const rec = { record_id: 'r' + this.db.length, user_id: this.user.user_id, uploaded: Date.now(), data, table: cfg.table }; this.db.push(rec); return rec; }
  async getRecords(q) { return { list: this.db.filter((x) => x.table.name === q.table.name && x.table.access_group === q.table.access_group).reverse(), endOfList: true }; }
  async deleteRecords({ record_id }) { this.db = this.db.filter((x) => x.record_id !== record_id); return 'SUCCESS'; }
};`;


async function run(viewport, tag) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  if (tag === 'desktop') await page.route('**/skapi-js@*/dist/skapi.js', (route) => route.fulfill({ contentType: 'text/javascript', body: FAKE_SKAPI }));
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

    // colours: a filament set repaints everything without changing the shape
    const before = await page.evaluate(() => window.spellforge.telemetry.hash);
    await page.click('#swatches button[data-p="jade"]');
    await page.waitForFunction(() => window.spellforge.genome.palette.t2 === '#2f8a64', null, T);
    ok((await page.evaluate(() => window.spellforge.telemetry.hash)) === before, `${tag}: Dragon Jade applied, same genome hash`);
    ok((await page.$$eval('#grid .cell svg path[fill="#2f8a64"]', (x) => x.length)) >= 9, `${tag}: crucible repainted`);
    await page.click('#swatches button[data-p="auto"]');
    ok(await page.$eval('#swatches button[data-p="auto"]', (b) => b.classList.contains('on')), `${tag}: back to the effects' colours`);

    // Skapi (mocked): sign in, save, publish, Hall, open, sign out
    await page.click('#btn-account');
    await page.fill('#form-login input[name=email]', 'kat@example.com');
    await page.fill('#form-login input[name=password]', 'secret123');
    await page.click('#form-login button[type=submit]');
    await page.waitForFunction(() => /Kat/.test(document.querySelector('#account-who').textContent), null, T);
    ok(true, `${tag}: signed in (mock Skapi)`);
    await page.click('#btn-save');
    await page.waitForFunction(() => document.querySelectorAll('#spellbook .entry svg').length === 1, null, T);
    ok(true, `${tag}: saved to Spellbook, thumbnail drawn`);
    await page.click('#btn-publish');
    await page.click('#btn-hall');
    await page.waitForFunction(() => document.querySelectorAll('#hall-list .entry').length === 1, null, T);
    ok(!!(await page.$('#hall-list .entry .x')), `${tag}: own Hall entry can be withdrawn`);
    await page.click('#hall-list .entry');
    ok(!(await page.$eval('#hall', (d) => d.open)), `${tag}: Hall closes after opening a sigil`);
    await page.click('#btn-account');
    await page.waitForFunction(() => document.querySelector('#btn-account').textContent === 'Sign in', null, T);
    ok(true, `${tag}: signed out`);
  } else {
    // signed out, the Hall asks you to sign in first
    await page.click('#btn-hall');
    ok(await page.$eval('#auth', (d) => d.open) && !(await page.$eval('#auth-note', (e) => e.hidden)), `${tag}: Hall asks a signed-out visitor to sign in`);
    await page.click('#btn-auth-close');
    // the live Skapi project is reachable with this project ID (read-only probe; it answers that reads need sign-in)
    const probe = await page.evaluate(async () => { const c = await import('./src/cloud.js?v=' + window.spellforge.version); try { await c.listHall(); return 'listed'; } catch (e) { return c.errorMessage(e); } });
    ok(/sign in|listed/i.test(probe), `${tag}: live Skapi project answered: ${probe}`);
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
