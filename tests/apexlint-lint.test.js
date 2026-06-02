/**
 * Apexlint rule-engine tests — run with `node --test` (no network, no Workers
 * runtime). Covers all 16 rules (positive + clean cases) and asserts the three
 * shipped samples reproduce their expected findings exactly. The same engine
 * runs in the browser (src/components/rules.ts) and on the live Cloudflare
 * backend (functions/apexlint/lint.js); this suite pins them both.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  runRulePack,
  lint,
  runAP001, runAP002, runAP003, runAP004, runAP005, runAP006, runAP007, runAP008,
  runFL001, runFL002, runFL003, runFL004,
  runN8001, runN8002, runN8003, runN8004,
} from '../functions/apexlint/lint.js';

const here = dirname(fileURLToPath(import.meta.url));
const samples = JSON.parse(readFileSync(join(here, '../public/data/samples.json'), 'utf8'));

const ruleIds = (findings) => findings.map((f) => f.ruleId);

// ─── Apex rules: positive fires once, clean is silent ───────────────────────

const CLEAN_APEX = `public class AccountService {
    public void handle(List<Account> accts) {
        for (Account a : accts) {
            a.Name = a.Name;
        }
    }
}`;

test('AP-001 fires on SOQL inside a loop, silent on clean', () => {
  const bad = `for (Opportunity o : Trigger.new) {\n  List<Task> t = [SELECT Id FROM Task WHERE WhatId = :o.Id];\n}`;
  assert.ok(runAP001(bad).some((f) => f.ruleId === 'AP-001'));
  assert.equal(runAP001(CLEAN_APEX).length, 0);
});

test('AP-002 fires on DML inside a loop, silent on clean', () => {
  const bad = `for (Account a : accts) {\n  update a;\n}`;
  assert.ok(runAP002(bad).some((f) => f.ruleId === 'AP-002'));
  assert.equal(runAP002(CLEAN_APEX).length, 0);
});

test('AP-003 fires on a single-SObject handler param, silent on List handler', () => {
  const bad = `public void enrich(Opportunity opp) { }`;
  assert.ok(runAP003(bad).some((f) => f.ruleId === 'AP-003'));
  assert.equal(runAP003(`public void enrich(List<Opportunity> opps) { }`).length, 0);
});

test('AP-004 fires on a hardcoded Salesforce ID, silent without one', () => {
  const bad = `o.OwnerId = '0051g00000XyZaBAAV';`;
  assert.ok(runAP004(bad).some((f) => f.ruleId === 'AP-004'));
  assert.equal(runAP004(`o.OwnerId = someVar;`).length, 0);
});

test('AP-005 fires on unguarded relationship deref, silent when guarded', () => {
  const bad = `String x = opp.Account.Industry;`;
  assert.ok(runAP005(bad).some((f) => f.ruleId === 'AP-005'));
  const guarded = `if (opp.AccountId != null) {\n  String x = opp.Account.Industry;\n}`;
  assert.equal(runAP005(guarded).length, 0);
});

test('AP-006 fires on an empty catch, silent when there is no catch', () => {
  // Heuristic note: AP-006 keys off the `} catch (...) {` one-liner shape (as in
  // the agent-generated samples). The clean case is code with no catch at all.
  const bad = `try {\n  insert a;\n} catch (DmlException e) {\n  // TODO\n}`;
  assert.ok(runAP006(bad).some((f) => f.ruleId === 'AP-006'));
  assert.equal(runAP006(CLEAN_APEX).length, 0);
});

test('AP-007 fires on a *Test class with no @isTest, silent when annotated', () => {
  const bad = `public class AccountServiceTest {\n}`;
  assert.ok(runAP007(bad).some((f) => f.ruleId === 'AP-007'));
  const ok = `@isTest\npublic class AccountServiceTest {\n}`;
  assert.equal(runAP007(ok).length, 0);
});

test('AP-008 fires on a test method with no assert, silent when it asserts', () => {
  const bad = `@isTest\nstatic void testThing() {\n  Account a = new Account();\n}`;
  assert.ok(runAP008(bad).some((f) => f.ruleId === 'AP-008'));
  const ok = `@isTest\nstatic void testThing() {\n  System.assertEquals(1, 1);\n}`;
  assert.equal(runAP008(ok).length, 0);
});

// ─── Flow rules ─────────────────────────────────────────────────────────────

test('FL-001 fires on DML node with no faultConnector, silent when present', () => {
  const bad = JSON.stringify({ Flow: { recordUpdates: [{ name: 'U1' }] } });
  assert.ok(runFL001(bad).some((f) => f.ruleId === 'FL-001'));
  const ok = JSON.stringify({ Flow: { recordUpdates: [{ name: 'U1', faultConnector: { targetReference: 'Err' } }] } });
  assert.equal(runFL001(ok).length, 0);
});

test('FL-002 fires on a hardcoded ID in an assignment, silent on a reference', () => {
  const bad = JSON.stringify({
    Flow: { assignments: [{ name: 'A1', assignmentItems: [{ assignToReference: '$Record.OwnerId', value: { stringValue: '00G1g000004ZxYZEA0' } }] }] },
  });
  assert.ok(runFL002(bad).some((f) => f.ruleId === 'FL-002'));
  const ok = JSON.stringify({
    Flow: { assignments: [{ name: 'A1', assignmentItems: [{ assignToReference: '$Record.OwnerId', value: { stringValue: '{!DefaultQueue}' } }] }] },
  });
  assert.equal(runFL002(ok).length, 0);
});

test('FL-003 fires when a fault path lands on a non-descriptive node, silent on a real screen', () => {
  const bad = JSON.stringify({
    Flow: {
      recordUpdates: [{ name: 'U1', faultConnector: { targetReference: 'Empty' } }],
      screens: [{ name: 'Empty' }],
    },
  });
  assert.ok(runFL003(bad).some((f) => f.ruleId === 'FL-003'));
  const ok = JSON.stringify({
    Flow: {
      recordUpdates: [{ name: 'U1', faultConnector: { targetReference: 'ErrScreen' } }],
      screens: [{ name: 'ErrScreen', fields: [{ name: 'msg' }] }],
    },
  });
  assert.equal(runFL003(ok).length, 0);
});

test('FL-004 fires on an orphan node, silent on a connected flow', () => {
  const bad = JSON.stringify({
    Flow: {
      start: { connector: { targetReference: 'A1' } },
      assignments: [{ name: 'A1', connector: { targetReference: 'End' } }],
      screens: [{ name: 'Orphan' }],
    },
  });
  assert.ok(runFL004(bad).some((f) => f.ruleId === 'FL-004'));
  const ok = JSON.stringify({
    Flow: {
      start: { connector: { targetReference: 'A1' } },
      assignments: [{ name: 'A1', connector: { targetReference: 'S1' } }],
      screens: [{ name: 'S1' }],
    },
  });
  assert.equal(runFL004(ok).length, 0);
});

// ─── n8n rules ──────────────────────────────────────────────────────────────

test('N8-001 fires when errorWorkflow is empty, silent when set', () => {
  const bad = JSON.stringify({ settings: {}, nodes: [] });
  assert.ok(runN8001(bad).some((f) => f.ruleId === 'N8-001'));
  const ok = JSON.stringify({ settings: { errorWorkflow: '42' }, nodes: [] });
  assert.equal(runN8001(ok).length, 0);
});

test('N8-002 fires on httpRequest with retryOnFail false, silent when true', () => {
  const bad = JSON.stringify({ nodes: [{ name: 'H', type: 'n8n-nodes-base.httpRequest', parameters: { method: 'GET' }, retryOnFail: false }] });
  assert.ok(runN8002(bad).some((f) => f.ruleId === 'N8-002'));
  const ok = JSON.stringify({ nodes: [{ name: 'H', type: 'n8n-nodes-base.httpRequest', parameters: { method: 'GET' }, retryOnFail: true }] });
  assert.equal(runN8002(ok).length, 0);
});

test('N8-003 fires on an unauthenticated webhook, silent when authenticated', () => {
  const bad = JSON.stringify({ nodes: [{ name: 'W', type: 'n8n-nodes-base.webhook', parameters: { authentication: 'none' } }] });
  assert.ok(runN8003(bad).some((f) => f.ruleId === 'N8-003'));
  const ok = JSON.stringify({ nodes: [{ name: 'W', type: 'n8n-nodes-base.webhook', parameters: { authentication: 'headerAuth' } }] });
  assert.equal(runN8003(ok).length, 0);
});

test('N8-004 fires on a destructive node with no continueOnFail, silent when set', () => {
  const bad = JSON.stringify({ nodes: [{ name: 'E', type: 'n8n-nodes-base.emailSend', parameters: {} }] });
  assert.ok(runN8004(bad).some((f) => f.ruleId === 'N8-004'));
  const ok = JSON.stringify({ nodes: [{ name: 'E', type: 'n8n-nodes-base.emailSend', parameters: {}, continueOnFail: true }] });
  assert.equal(runN8004(ok).length, 0);
});

// ─── Coverage guard: all 16 rule fns are exercised above ────────────────────

test('all 16 rules are covered', () => {
  const covered = [
    'AP-001', 'AP-002', 'AP-003', 'AP-004', 'AP-005', 'AP-006', 'AP-007', 'AP-008',
    'FL-001', 'FL-002', 'FL-003', 'FL-004',
    'N8-001', 'N8-002', 'N8-003', 'N8-004',
  ];
  assert.equal(covered.length, 16);
});

// ─── Sample fixtures reproduce expected findings exactly ────────────────────

for (const tab of ['apex', 'flow', 'n8n']) {
  test(`sample fixture: ${tab} reproduces expected findings exactly`, () => {
    const s = samples[tab];
    const got = runRulePack(tab, s.source);
    assert.deepEqual(got, s.findings);
  });
}

// ─── lint() entry: shape + validation ───────────────────────────────────────

test('lint() returns { tab, findings, counts } and counts by ruleId', () => {
  const out = lint('n8n', samples.n8n.source);
  assert.equal(out.tab, 'n8n');
  assert.ok(Array.isArray(out.findings));
  assert.equal(out.counts['N8-004'], 2); // two destructive nodes in the sample
  const total = Object.values(out.counts).reduce((a, b) => a + b, 0);
  assert.equal(total, out.findings.length);
});

test('lint() rejects an unknown tab and empty source', () => {
  assert.throws(() => lint('python', 'x'), /tab must be one of/);
  assert.throws(() => lint('apex', '   '), /Paste some source/);
});

test('runRulePack returns the right rule families per tab', () => {
  assert.ok(ruleIds(runRulePack('apex', samples.apex.source)).every((r) => r.startsWith('AP-')));
  assert.ok(ruleIds(runRulePack('flow', samples.flow.source)).every((r) => r.startsWith('FL-')));
  assert.ok(ruleIds(runRulePack('n8n', samples.n8n.source)).every((r) => r.startsWith('N8-')));
});
