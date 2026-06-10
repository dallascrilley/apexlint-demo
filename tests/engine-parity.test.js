/**
 * Engine-parity gate.
 *
 * Apexlint ships the rule engine twice: once as TypeScript for the browser
 * (src/components/rules.ts) and once as plain JS for the Cloudflare Pages
 * Function (functions/apexlint/lint.js). They are hand-synchronized twins —
 * nothing structural forces them to agree, so this suite does: it compiles
 * rules.ts (via the repo's own `typescript` devDependency — see the `test`
 * script in package.json) and runs the full fixture corpus plus the three
 * shipped samples through BOTH implementations, asserting the findings are
 * deep-equal (ruleId, severity, locus, message, fix, lineNumber, lineRange).
 *
 * If the twins ever drift, CI goes red here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import * as serverEngine from '../functions/apexlint/lint.js';
import { CORPUS } from './corpus.mjs';

let browserEngine;
try {
  browserEngine = await import('./.engine-build/rules.js');
} catch {
  throw new Error(
    'Browser-engine build not found at tests/.engine-build/rules.js — run `pnpm test`, ' +
    'which compiles src/components/rules.ts before invoking node --test.',
  );
}

const here = dirname(fileURLToPath(import.meta.url));
const samples = JSON.parse(readFileSync(join(here, '../public/data/samples.json'), 'utf8'));

const PARITY_INPUTS = [
  ...Object.values(samples).map((s) => ({ name: `shipped sample: ${s.id}`, tab: s.id, source: s.source })),
  ...CORPUS,
];

for (const { name, tab, source } of PARITY_INPUTS) {
  test(`parity: ${name}`, () => {
    const fromServer = serverEngine.runRulePack(tab, source);
    const fromBrowser = browserEngine.runRulePack(tab, source);
    assert.deepEqual(
      fromBrowser,
      fromServer,
      `Browser (rules.ts) and server (lint.js) engines disagree on "${name}"`,
    );
  });
}

test('parity: both engines expose the same rule functions', () => {
  const ruleNames = (mod) => Object.keys(mod).filter((k) => /^run(AP|FL|N8)\d{3}$/.test(k)).sort();
  assert.deepEqual(ruleNames(browserEngine), ruleNames(serverEngine));
});
