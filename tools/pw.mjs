// pw.mjs — load Playwright from the project, or from the global install.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
export async function playwright() {
  try { return await import('playwright'); } catch (_) {
    const root = execSync('npm root -g').toString().trim();
    return createRequire(import.meta.url)(join(root, 'playwright'));
  }
}
