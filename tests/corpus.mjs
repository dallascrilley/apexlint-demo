/**
 * Shared fixture corpus for the Apexlint test suite.
 *
 * Used two ways:
 *  - tests/apexlint-lint.test.js — coverage gate: every rule the engine
 *    exports must fire at least once across this corpus.
 *  - tests/engine-parity.test.js — parity gate: the browser engine
 *    (src/components/rules.ts) and the server engine
 *    (functions/apexlint/lint.js) must produce identical findings for every
 *    entry here plus the shipped samples.
 *
 * Entries mix straightforward positives (one per rule) with adversarial
 * shapes: one-line catches, K&R-style catch blocks, comments containing
 * trigger keywords, invalid JSON, and clean code that must stay silent.
 */

export const CORPUS = [
  // ─── Apex positives ────────────────────────────────────────────────────
  {
    name: 'apex: SOQL + DML inside a loop (AP-001, AP-002)',
    tab: 'apex',
    source: `trigger Enrich on Opportunity (before update) {
    for (Opportunity record : Trigger.new) {
        List<Task> tasks = [SELECT Id FROM Task WHERE WhatId = :record.Id];
        update record;
    }
}`,
  },
  {
    name: 'apex: single-SObject handler (AP-003)',
    tab: 'apex',
    source: `public class Handler {
    public void enrich(Opportunity single) {
        System.debug(single);
    }
}`,
  },
  {
    name: 'apex: hardcoded Salesforce ID (AP-004)',
    tab: 'apex',
    source: `public class Assigner {
    public void assign(Lead l) {
        l.OwnerId = '0051g00000XyZaBAAV';
    }
}`,
  },
  {
    name: 'apex: unguarded relationship deref (AP-005)',
    tab: 'apex',
    source: `public class Reader {
    public String industry(Opportunity record) {
        return record.Account.Industry;
    }
}`,
  },
  {
    name: 'apex: comment-only catch body (AP-006)',
    tab: 'apex',
    source: `public class Saver {
    public void save(Account a) {
        try {
            insert a;
        } catch (DmlException e) {
            // TODO handle later
        }
    }
}`,
  },
  {
    name: 'apex: one-line truly-empty catch (AP-006)',
    tab: 'apex',
    source: `public class Saver {
    public void save(Account a) {
        try { insert a; } catch (DmlException e) {}
    }
}`,
  },
  {
    name: 'apex: *Test class without @isTest (AP-007)',
    tab: 'apex',
    source: `public class AccountServiceTest {
    public void run() {}
}`,
  },
  {
    name: 'apex: test method with no assertion (AP-008)',
    tab: 'apex',
    source: `@isTest
static void testNothing() {
    Account a = new Account(Name = 'x');
}`,
  },

  // ─── Apex adversarial / negative shapes ────────────────────────────────
  {
    name: 'apex: one-line catch with a real body (no AP-006)',
    tab: 'apex',
    source: `public class Saver {
    public void save(Account a) {
        try { insert a; } catch (DmlException e) { System.debug(e); }
    }
}`,
  },
  {
    name: 'apex: K&R catch with a rethrow body (no AP-006)',
    tab: 'apex',
    source: `public class Saver {
    public void save(Account a) {
        try {
            insert a;
        } catch (DmlException e) {
            throw new AuraHandledException(e.getMessage());
        }
    }
}`,
  },
  {
    name: 'apex: SELECT only inside a comment and a string (no AP-001)',
    tab: 'apex',
    source: `public class Quiet {
    public void run(List<Account> accts) {
        for (Account a : accts) {
            // SELECT Id FROM Task — just a comment
            a.Description = 'SELECT nothing';
        }
    }
}`,
  },
  {
    name: 'apex: clean bulkified class (silent)',
    tab: 'apex',
    source: `public class AccountService {
    public void handle(List<Account> accts) {
        for (Account a : accts) {
            a.Name = a.Name;
        }
    }
}`,
  },

  // ─── Flow positives ────────────────────────────────────────────────────
  {
    name: 'flow: recordCreates + recordDeletes without faultConnector (FL-001)',
    tab: 'flow',
    source: JSON.stringify({
      Flow: {
        recordCreates: [{ name: 'Create_Log' }],
        recordDeletes: [{ name: 'Delete_Stale' }],
      },
    }, null, 2),
  },
  {
    name: 'flow: hardcoded ID in an assignment (FL-002)',
    tab: 'flow',
    source: JSON.stringify({
      Flow: {
        assignments: [{
          name: 'Set_Owner',
          assignmentItems: [{ assignToReference: '$Record.OwnerId', value: { stringValue: '00G1g000004ZxYZEA0' } }],
        }],
      },
    }, null, 2),
  },
  {
    name: 'flow: fault path to a non-descriptive node (FL-003)',
    tab: 'flow',
    source: JSON.stringify({
      Flow: {
        recordUpdates: [{ name: 'U1', faultConnector: { targetReference: 'Blank' } }],
        screens: [{ name: 'Blank' }],
      },
    }, null, 2),
  },
  {
    name: 'flow: orphan node (FL-004)',
    tab: 'flow',
    source: JSON.stringify({
      Flow: {
        start: { connector: { targetReference: 'A1' } },
        assignments: [{ name: 'A1', connector: { targetReference: 'End' } }],
        screens: [{ name: 'Orphan' }],
      },
    }, null, 2),
  },

  // ─── Flow adversarial ──────────────────────────────────────────────────
  {
    name: 'flow: invalid JSON (silent, no throw)',
    tab: 'flow',
    source: '<Flow><recordUpdates/></Flow>',
  },
  {
    name: 'flow: fully-wired flow with fault handling (silent)',
    tab: 'flow',
    source: JSON.stringify({
      Flow: {
        start: { connector: { targetReference: 'U1' } },
        recordUpdates: [{ name: 'U1', connector: { targetReference: 'Done' }, faultConnector: { targetReference: 'Err' } }],
        screens: [
          { name: 'Done', fields: [{ name: 'ok' }] },
          { name: 'Err', fields: [{ name: 'msg' }] },
        ],
      },
    }, null, 2),
  },

  // ─── n8n positives ─────────────────────────────────────────────────────
  {
    name: 'n8n: no errorWorkflow, fragile HTTP, open webhook, unguarded sends (N8-001..004)',
    tab: 'n8n',
    source: JSON.stringify({
      settings: {},
      nodes: [
        { name: 'Hook', type: 'n8n-nodes-base.webhook', parameters: { authentication: 'none' } },
        { name: 'Fetch', type: 'n8n-nodes-base.httpRequest', parameters: { method: 'GET' }, retryOnFail: false },
        { name: 'Notify', type: 'n8n-nodes-base.emailSend', parameters: {} },
        { name: 'Post', type: 'n8n-nodes-base.httpRequest', parameters: { method: 'POST' }, retryOnFail: true },
      ],
    }, null, 2),
  },

  // ─── n8n adversarial ───────────────────────────────────────────────────
  {
    name: 'n8n: invalid JSON (silent, no throw)',
    tab: 'n8n',
    source: 'nodes: [unquoted yaml-ish]',
  },
  {
    name: 'n8n: hardened workflow (silent)',
    tab: 'n8n',
    source: JSON.stringify({
      settings: { errorWorkflow: '42' },
      nodes: [
        { name: 'Hook', type: 'n8n-nodes-base.webhook', parameters: { authentication: 'headerAuth' } },
        { name: 'Fetch', type: 'n8n-nodes-base.httpRequest', parameters: { method: 'GET' }, retryOnFail: true },
        { name: 'Notify', type: 'n8n-nodes-base.emailSend', parameters: {}, continueOnFail: true },
      ],
    }, null, 2),
  },
];
