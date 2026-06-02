/**
 * Apexlint — server-side deterministic linter (Cloudflare Pages Function).
 *
 * Accepts code YOU submit — an Apex class/trigger, a Flow metadata JSON export,
 * or an n8n workflow JSON — and runs 16 deterministic static-analysis rules
 * against it ENTIRELY on the server. No synthetic data, no secrets, no external
 * calls, no LLM: you paste your own source, the function parses and inspects it,
 * and hands back the findings the client renders.
 *
 * Honest boundary: this is REAL static analysis of the exact bytes you submit.
 * It is regex/JSON-structure based (not a full compiler), so it is intentionally
 * conservative — it flags the high-confidence governor traps, hardcoded IDs,
 * silent failures, and missing-guard patterns that ship from agent-generated
 * code. The rules are real; the data is yours.
 *
 * The pure helpers below (runRulePack + each rule) are exported so they can be
 * unit-tested without a network or a Workers runtime (see
 * ../../tests/apexlint-lint.test.js). Ported verbatim from the client-side
 * TypeScript engine (src/components/apexlint/rules.ts) — types stripped, logic
 * unchanged.
 */

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...init.headers,
    },
    ...init,
  });
}

// ─── Apex helpers ──────────────────────────────────────────────────────────

/**
 * Strip line and block comments, and string literals from Apex source.
 * Returns sanitized lines array (same count as original for line tracking).
 */
function stripApexCommentsAndStrings(source) {
  const lines = source.split('\n');
  const result = [];
  let inBlock = false;

  for (const line of lines) {
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end >= 0) {
        inBlock = false;
        result.push(line.slice(end + 2).replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""'));
      } else {
        result.push('');
      }
    } else {
      const blockStart = line.indexOf('/*');
      const lineComment = line.indexOf('//');
      let clean = line;

      if (blockStart >= 0 && (lineComment < 0 || blockStart < lineComment)) {
        const blockEnd = line.indexOf('*/', blockStart + 2);
        if (blockEnd >= 0) {
          clean = line.slice(0, blockStart) + line.slice(blockEnd + 2);
        } else {
          inBlock = true;
          clean = line.slice(0, blockStart);
        }
      } else if (lineComment >= 0) {
        clean = line.slice(0, lineComment);
      }

      // Strip string literals
      clean = clean.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
      result.push(clean);
    }
  }

  return result;
}

/**
 * Track brace depth to identify lines inside loop bodies.
 * Returns array of {depth, inLoop, loopDepth} per original line index.
 */
function buildApexLineCtx(cleanLines) {
  const ctx = [];
  let depth = 0;
  let loopStack = []; // depths where loops opened

  for (const line of cleanLines) {
    const trimmed = line.trim();
    const isLoopStart = /^(for|while)\s*\(/.test(trimmed);
    const openCount = (line.match(/\{/g) || []).length;
    const closeCount = (line.match(/\}/g) || []).length;

    // Record context BEFORE modifying depth for this line
    const inLoop = loopStack.length > 0 && depth > (loopStack[loopStack.length - 1] ?? -1);

    ctx.push({
      depth,
      inLoop,
      loopDepth: loopStack[loopStack.length - 1] ?? -1,
    });

    // Update depth for next line
    if (isLoopStart && openCount > 0) {
      loopStack.push(depth);
    }

    depth += openCount - closeCount;

    // Pop loop stack when we exit the loop body
    while (loopStack.length > 0 && depth <= (loopStack[loopStack.length - 1] ?? 0)) {
      loopStack.pop();
    }
  }

  return ctx;
}

// ─── Apex Rules ────────────────────────────────────────────────────────────

function runAP001(source) {
  const cleanLines = stripApexCommentsAndStrings(source);
  const lineCtx = buildApexLineCtx(cleanLines);
  const findings = [];

  for (let i = 0; i < cleanLines.length; i++) {
    const clean = cleanLines[i] ?? '';
    const ctx = lineCtx[i];
    if (!ctx) continue;

    if (ctx.inLoop && /\bSELECT\b/i.test(clean)) {
      // Find the loop start line
      const loopStart = findLoopStart(lineCtx, i);
      const loopEnd = findLoopEnd(lineCtx, i, loopStart);

      findings.push({
        ruleId: 'AP-001',
        severity: 'CRITICAL',
        locus: `Line ${i + 1}`,
        message: 'SOQL inside a loop — hits the 100-query governor at record 101. Passes unit tests with <100 rows.',
        fix: 'Hoist the query above the loop: collect opp.Id into a Set<Id>, query WHERE WhatId IN :ids, build a Map<Id, Integer>, then read it inside the loop.',
        lineNumber: i + 1,
        lineRange: [loopStart + 1, loopEnd + 1],
      });
    }
  }

  return findings;
}

function findLoopStart(lineCtx, currentLine) {
  const targetDepth = lineCtx[currentLine]?.loopDepth ?? -1;
  for (let i = currentLine; i >= 0; i--) {
    if ((lineCtx[i]?.depth ?? 0) <= targetDepth) {
      return i;
    }
  }
  return 0;
}

function findLoopEnd(lineCtx, _currentLine, loopStart) {
  const targetDepth = lineCtx[loopStart]?.depth ?? 0;
  for (let i = loopStart + 1; i < lineCtx.length; i++) {
    if ((lineCtx[i]?.depth ?? 0) <= targetDepth) {
      return i;
    }
  }
  return lineCtx.length - 1;
}

function runAP002(source) {
  const cleanLines = stripApexCommentsAndStrings(source);
  const lineCtx = buildApexLineCtx(cleanLines);
  const findings = [];

  for (let i = 0; i < cleanLines.length; i++) {
    const clean = cleanLines[i] ?? '';
    const ctx = lineCtx[i];
    if (!ctx) continue;

    if (ctx.inLoop && /\b(insert|update|delete|upsert)\b/i.test(clean)) {
      const loopStart = findLoopStart(lineCtx, i);
      const loopEnd = findLoopEnd(lineCtx, i, loopStart);

      findings.push({
        ruleId: 'AP-002',
        severity: 'CRITICAL',
        locus: `Line ${i + 1}`,
        message: 'DML inside a loop — hits the 150-DML governor. Bulkify: collect records into a List, DML once outside the loop.',
        fix: 'Collect records into a List<SObject> or List<Id> before the loop, then call insert/update/delete once outside the loop body.',
        lineNumber: i + 1,
        lineRange: [loopStart + 1, loopEnd + 1],
      });
    }
  }

  return findings;
}

function runAP003(source) {
  const findings = [];
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    // Handler method takes a single SObject, not a List
    if (/\b(public|private|global)\b.*\(SObject\s+\w+\)/.test(line) ||
        /\b(public|private|global)\b.*\((Opportunity|Lead|Contact|Account|Case)\s+\w+\)/.test(line)) {
      findings.push({
        ruleId: 'AP-003',
        severity: 'HIGH',
        locus: `Line ${i + 1}`,
        message: 'Handler method accepts a single SObject — not bulkified. Trigger.new passes all records at once; this breaks at >1 record.',
        fix: 'Change the parameter to List<SObject> (or the specific SObject type) and process with a for loop inside the method.',
        lineNumber: i + 1,
        lineRange: [i + 1, i + 1],
      });
    }
  }

  return findings;
}

function runAP004(source) {
  const findings = [];
  const lines = source.split('\n');
  const SF_ID_RE = /['"][a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?['"]/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    // Skip pure comments
    if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;

    let match;
    SF_ID_RE.lastIndex = 0;
    while ((match = SF_ID_RE.exec(line)) !== null) {
      const id = match[0].replace(/['"]/g, '');
      // Verify it looks like a SF ID (starts with valid prefix chars)
      if (/^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/.test(id)) {
        findings.push({
          ruleId: 'AP-004',
          severity: 'HIGH',
          locus: `Line ${i + 1}`,
          message: `Hardcoded ID '${id}' — valid only in the org it was copied from; breaks every sandbox and new prod.`,
          fix: 'Resolve the owner/record via Custom Metadata (e.g., Default_Owner__mdt) or a Custom Setting; never literal-ID a record reference.',
          lineNumber: i + 1,
          lineRange: [i + 1, i + 1],
        });
      }
    }
  }

  return findings;
}

function runAP005(source) {
  const findings = [];
  const cleanLines = stripApexCommentsAndStrings(source);

  for (let i = 0; i < cleanLines.length; i++) {
    const line = cleanLines[i] ?? '';
    // Match relationship field access pattern like x.Account.Name or x.Account.Industry
    const relMatch = line.match(/\b(\w+)\.(\w+)\.(\w+)/);
    if (relMatch) {
      // Check if there's a null guard somewhere above for the relationship
      const varName = relMatch[1];
      const relName = relMatch[2];

      let hasGuard = false;
      for (let j = Math.max(0, i - 10); j < i; j++) {
        const prevLine = cleanLines[j] ?? '';
        if (prevLine.includes(`${varName}.${relName}Id`) ||
            prevLine.includes(`${relName}Id != null`) ||
            prevLine.includes(`${relName} != null`) ||
            prevLine.includes(`if (${varName}.${relName}`) ) {
          hasGuard = true;
          break;
        }
      }

      if (!hasGuard) {
        findings.push({
          ruleId: 'AP-005',
          severity: 'MEDIUM',
          locus: `Line ${i + 1}`,
          message: `${relMatch[0]} dereferences ${relName} with no null guard — NPE when ${relName}Id is null.`,
          fix: `Guard: if (${varName}.${relName}Id != null) { … }, or query the parent and map it; relationship fields are not auto-loaded in triggers.`,
          lineNumber: i + 1,
          lineRange: [i + 1, i + 1],
        });
      }
    }
  }

  return findings;
}

function runAP006(source) {
  const findings = [];
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/\bcatch\b.*\{/.test(line)) {
      // Find the closing brace of the catch block
      let depth = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
      let bodyEnd = i;
      let isEmpty = true;

      for (let j = i + 1; j < lines.length && depth > 0; j++) {
        const inner = lines[j] ?? '';
        depth += (inner.match(/\{/g) || []).length;
        depth -= (inner.match(/\}/g) || []).length;

        if (depth > 0) {
          const trimmed = inner.trim();
          if (trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('*') && trimmed !== '') {
            isEmpty = false;
          }
        }
        bodyEnd = j;
      }

      if (isEmpty) {
        findings.push({
          ruleId: 'AP-006',
          severity: 'MEDIUM',
          locus: `Line ${i + 1}`,
          message: 'Empty catch swallows the exception — the failure vanishes with no signal.',
          fix: 'Re-throw, or addError() on the record, or publish a Platform Event / Log__c. A bare // TODO ships the bug.',
          lineNumber: i + 1,
          lineRange: [i + 1, bodyEnd + 1],
        });
      }
    }
  }

  return findings;
}

function runAP007(source) {
  const findings = [];
  const lines = source.split('\n');
  let hasIsTest = false;
  let testClassLine = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/@isTest/i.test(line)) hasIsTest = true;
    if (/\bclass\s+\w*[Tt]est\w*\s/.test(line) || /\bclass\s+\w+Test\b/.test(line)) {
      testClassLine = i;
    }
  }

  if (testClassLine >= 0 && !hasIsTest) {
    findings.push({
      ruleId: 'AP-007',
      severity: 'LOW',
      locus: `Line ${testClassLine + 1}`,
      message: 'Class name ends in "Test" but has no @isTest annotation — Salesforce requires the annotation for the class to run in test context.',
      fix: 'Add @isTest above the class declaration.',
      lineNumber: testClassLine + 1,
      lineRange: [testClassLine + 1, testClassLine + 1],
    });
  }

  return findings;
}

function runAP008(source) {
  const findings = [];
  const lines = source.split('\n');
  let inTestMethod = false;
  let testMethodStart = -1;
  let methodDepth = 0;
  let hasAssert = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    if (!inTestMethod && /@isTest/i.test(line)) {
      // Next method declaration is the test method
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        if (/\b(public|private|static)\b.*\bvoid\b/.test(lines[j] ?? '')) {
          inTestMethod = true;
          testMethodStart = j;
          hasAssert = false;
          methodDepth = 0;
          break;
        }
      }
    }

    if (inTestMethod) {
      methodDepth += (line.match(/\{/g) || []).length;
      methodDepth -= (line.match(/\}/g) || []).length;

      if (/System\.assert/i.test(line)) hasAssert = true;

      if (methodDepth <= 0 && testMethodStart >= 0 && i > testMethodStart) {
        if (!hasAssert) {
          findings.push({
            ruleId: 'AP-008',
            severity: 'LOW',
            locus: `Line ${testMethodStart + 1}`,
            message: 'Test method contains no System.assert* call — passes vacuously, proves nothing.',
            fix: 'Add at least one System.assertEquals, System.assertNotEquals, or System.assert to verify the expected outcome.',
            lineNumber: testMethodStart + 1,
            lineRange: [testMethodStart + 1, i + 1],
          });
        }
        inTestMethod = false;
        testMethodStart = -1;
      }
    }
  }

  return findings;
}

// ─── Flow Rules ────────────────────────────────────────────────────────────

function runFL001(source) {
  const findings = [];
  let data;
  try { data = JSON.parse(source); } catch { return []; }

  const flow = data?.Flow || data;
  const recordUpdates = flow?.recordUpdates
    ? (Array.isArray(flow.recordUpdates) ? flow.recordUpdates : [flow.recordUpdates])
    : [];
  const recordCreates = flow?.recordCreates
    ? (Array.isArray(flow.recordCreates) ? flow.recordCreates : [flow.recordCreates])
    : [];
  const recordDeletes = flow?.recordDeletes
    ? (Array.isArray(flow.recordDeletes) ? flow.recordDeletes : [flow.recordDeletes])
    : [];

  const dmlNodes = [...recordUpdates, ...recordCreates, ...recordDeletes];

  for (const node of dmlNodes) {
    if (!node.faultConnector) {
      findings.push({
        ruleId: 'FL-001',
        severity: 'HIGH',
        locus: `Node: ${node.name}`,
        message: `${node.name} (recordUpdates) has no faultConnector. A validation rule or lock contention throws an unhandled fault and the flow dies silently.`,
        fix: 'Add a Fault connector to a Screen (interactive) or an Apex_Error_Log subflow (autolaunched). Never leave DML faultless.',
        lineNumber: findJsonNodeLine(source, node.name),
        lineRange: findJsonNodeRange(source, node.name),
      });
    }
  }

  return findings;
}

function runFL002(source) {
  const findings = [];
  let data;
  try { data = JSON.parse(source); } catch { return []; }

  const flow = data?.Flow || data;
  const assignments = flow?.assignments
    ? (Array.isArray(flow.assignments) ? flow.assignments : [flow.assignments])
    : [];

  const SF_ID_RE = /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/;

  for (const node of assignments) {
    const items = node.assignmentItems
      ? (Array.isArray(node.assignmentItems) ? node.assignmentItems : [node.assignmentItems])
      : [];

    for (const item of items) {
      const val = item?.value?.stringValue;
      if (val && SF_ID_RE.test(val)) {
        findings.push({
          ruleId: 'FL-002',
          severity: 'HIGH',
          locus: `Node: ${node.name} → ${item.assignToReference?.split('.').pop()}`,
          message: `Hardcoded ID '${val}' in the assignment — breaks on deploy to any other org.`,
          fix: "Resolve the record with a Get Records node on the appropriate object (e.g., Group WHERE DeveloperName = 'Lead_Default_Queue'), or store it in Custom Metadata.",
          lineNumber: findJsonNodeLine(source, val),
          lineRange: findJsonNodeRange(source, node.name),
        });
      }
    }
  }

  return findings;
}

function runFL003(source) {
  const findings = [];
  let data;
  try { data = JSON.parse(source); } catch { return []; }

  // Check if faultConnector exists but leads to End or empty screen
  const flow = data?.Flow || data;
  if (!flow) return [];

  const screens = flow?.screens
    ? (Array.isArray(flow.screens) ? flow.screens : [flow.screens])
    : [];

  const allNodes = [...(Array.isArray(flow.assignments) ? flow.assignments : flow.assignments ? [flow.assignments] : []),
                    ...screens];

  // Find all fault connector targets
  const dmlNodes = [
    ...(Array.isArray(flow.recordUpdates) ? flow.recordUpdates : flow.recordUpdates ? [flow.recordUpdates] : []),
    ...(Array.isArray(flow.recordCreates) ? flow.recordCreates : flow.recordCreates ? [flow.recordCreates] : []),
  ];

  for (const node of dmlNodes) {
    if (node.faultConnector) {
      const target = node.faultConnector.targetReference;
      const targetNode = allNodes.find((n) => n.name === target);
      if (!targetNode || (targetNode && !targetNode.fields)) {
        // Fault path leads to empty/non-descriptive screen
        findings.push({
          ruleId: 'FL-003',
          severity: 'MEDIUM',
          locus: `Node: ${node.name} → fault path`,
          message: `Fault connector present but lands on an empty or non-descriptive node. The user sees a blank screen on error.`,
          fix: 'Add a Screen element with a meaningful error message, or route to a subflow that logs the error.',
          lineNumber: findJsonNodeLine(source, target),
          lineRange: findJsonNodeRange(source, node.name),
        });
      }
    }
  }

  return findings;
}

function runFL004(source) {
  const findings = [];
  let data;
  try { data = JSON.parse(source); } catch { return []; }

  const flow = data?.Flow || data;
  if (!flow) return [];

  // Collect all node names and connector targets
  const nodeTypes = ['assignments', 'decisions', 'loops', 'recordCreates', 'recordUpdates', 'recordDeletes', 'screens', 'subflows', 'actionCalls'];
  const allNodes = [];

  for (const type of nodeTypes) {
    const nodes = flow[type];
    if (nodes) {
      const arr = Array.isArray(nodes) ? nodes : [nodes];
      allNodes.push(...arr.map((n) => ({ ...n, _type: type })));
    }
  }

  // Collect all referenced targets
  const referenced = new Set();
  const startRef = flow?.start?.connector?.targetReference;
  if (startRef) referenced.add(startRef);

  for (const node of allNodes) {
    const refs = extractConnectorRefs(node);
    for (const r of refs) referenced.add(r);
  }

  // Find orphans (not referenced and not start)
  for (const node of allNodes) {
    if (!referenced.has(node.name) && node.name !== 'Start') {
      // Check if it has any outbound connections either
      const refs = extractConnectorRefs(node);
      if (refs.length === 0) {
        findings.push({
          ruleId: 'FL-004',
          severity: 'LOW',
          locus: `Node: ${node.name}`,
          message: `Node '${node.name}' has no inbound or outbound connectors — it is dead code that Flow Builder will ignore.`,
          fix: 'Remove the orphan node or connect it into the flow. Orphan nodes accumulate during iterative development and can mask logic errors.',
          lineNumber: findJsonNodeLine(source, node.name),
          lineRange: findJsonNodeRange(source, node.name),
        });
      }
    }
  }

  return findings;
}

function extractConnectorRefs(node) {
  const refs = [];
  const walk = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    if (obj.targetReference) refs.push(obj.targetReference);
    for (const val of Object.values(obj)) {
      if (typeof val === 'object') walk(val);
    }
  };
  walk(node);
  return refs;
}

function findJsonNodeLine(source, searchStr) {
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if ((lines[i] ?? '').includes(searchStr)) return i + 1;
  }
  return 1;
}

function findJsonNodeRange(source, nodeName) {
  const lines = source.split('\n');
  let start = -1;
  let depth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (start < 0 && line.includes(`"${nodeName}"`)) {
      start = i;
    }
    if (start >= 0) {
      depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
      if (depth <= 0 && i > start) {
        return [start + 1, i + 1];
      }
    }
  }
  return [start >= 0 ? start + 1 : 1, start >= 0 ? start + 3 : 3];
}

// ─── n8n Rules ─────────────────────────────────────────────────────────────

function runN8001(source) {
  let data;
  try { data = JSON.parse(source); } catch { return []; }

  const errorWorkflow = data?.settings?.errorWorkflow;
  if (!errorWorkflow || errorWorkflow === '') {
    return [{
      ruleId: 'N8-001',
      severity: 'HIGH',
      locus: 'Workflow settings',
      message: 'settings.errorWorkflow is empty. Any node throwing fails the run silently — no alert, no retry, no dead-letter store.',
      fix: 'Set settings.errorWorkflow to a workflow ID that posts to Slack or writes to a dead-letter store. Every prod workflow needs an error workflow.',
      lineNumber: findJsonNodeLine(source, '"settings"'),
      lineRange: [findJsonNodeLine(source, '"settings"'), findJsonNodeLine(source, '"settings"') + 1],
    }];
  }
  return [];
}

function runN8002(source) {
  const findings = [];
  let data;
  try { data = JSON.parse(source); } catch { return []; }

  const nodes = data?.nodes || [];
  for (const node of nodes) {
    if (node.type === 'n8n-nodes-base.httpRequest') {
      if (!node.retryOnFail || node.retryOnFail === false) {
        const lineNum = findJsonNodeLine(source, node.name);
        findings.push({
          ruleId: 'N8-002',
          severity: 'HIGH',
          locus: `Node: ${node.name}`,
          message: `HTTP ${node.parameters?.method || 'request'} with retryOnFail: false — one transient 5xx permanently drops the record.`,
          fix: 'Set retryOnFail: true, maxTries: 3, waitBetweenTries: 1000. Transient failures should not be permanent.',
          lineNumber: lineNum,
          lineRange: findJsonNodeRange(source, node.name),
        });
      }
    }
  }
  return findings;
}

function runN8003(source) {
  const findings = [];
  let data;
  try { data = JSON.parse(source); } catch { return []; }

  const nodes = data?.nodes || [];
  for (const node of nodes) {
    if (node.type === 'n8n-nodes-base.webhook') {
      const auth = node.parameters?.authentication;
      if (!auth || auth === 'none') {
        findings.push({
          ruleId: 'N8-003',
          severity: 'MEDIUM',
          locus: `Node: ${node.name}`,
          message: `Webhook node has no authentication — any caller can trigger this workflow.`,
          fix: "Set authentication to 'headerAuth' or 'basicAuth'. Unauthenticated webhooks are an open endpoint in prod.",
          lineNumber: findJsonNodeLine(source, node.name),
          lineRange: findJsonNodeRange(source, node.name),
        });
      }
    }
  }
  return findings;
}

function runN8004(source) {
  const findings = [];
  let data;
  try { data = JSON.parse(source); } catch { return []; }

  const nodes = data?.nodes || [];
  for (const node of nodes) {
    const isDestructive = node.type === 'n8n-nodes-base.emailSend' ||
      (node.type === 'n8n-nodes-base.httpRequest' &&
       ['POST', 'DELETE'].includes(node.parameters?.method?.toUpperCase() || ''));

    if (isDestructive && !node.continueOnFail) {
      findings.push({
        ruleId: 'N8-004',
        severity: 'MEDIUM',
        locus: `Node: ${node.name}`,
        message: `Destructive node (${node.type.split('.').pop()}) has no continueOnFail — one failure halts the entire downstream chain.`,
        fix: 'Set continueOnFail: true and add an IF node to check $node[...].error before continuing.',
        lineNumber: findJsonNodeLine(source, node.name),
        lineRange: findJsonNodeRange(source, node.name),
      });
    }
  }
  return findings;
}

// ─── Rule packs & dispatcher ───────────────────────────────────────────────

const APEX_RULES = [runAP001, runAP002, runAP003, runAP004, runAP005, runAP006, runAP007, runAP008];
const FLOW_RULES = [runFL001, runFL002, runFL003, runFL004];
const N8N_RULES = [runN8001, runN8002, runN8003, runN8004];

export function runRulePack(tab, source) {
  const rules = tab === 'apex' ? APEX_RULES : tab === 'flow' ? FLOW_RULES : N8N_RULES;
  const findings = [];
  for (const rule of rules) {
    try {
      findings.push(...rule(source));
    } catch {
      // Rule errors must not surface to the user
    }
  }
  return findings;
}

// Exported individual rules so each can be unit-tested in isolation.
export {
  runAP001, runAP002, runAP003, runAP004, runAP005, runAP006, runAP007, runAP008,
  runFL001, runFL002, runFL003, runFL004,
  runN8001, runN8002, runN8003, runN8004,
};

// ─── Pages Function entry ──────────────────────────────────────────────────

const VALID_TABS = new Set(['apex', 'flow', 'n8n']);

export function lint(tab, source) {
  if (!VALID_TABS.has(tab)) {
    throw new Error("tab must be one of 'apex', 'flow', 'n8n'.");
  }
  if (typeof source !== 'string' || !source.trim()) {
    throw new Error('Paste some source to lint.');
  }
  const findings = runRulePack(tab, source);
  const counts = {};
  for (const f of findings) {
    counts[f.ruleId] = (counts[f.ruleId] || 0) + 1;
  }
  return { tab, findings, counts };
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const { tab, source } = body || {};
    return json(lint(tab, source));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Lint failed.' }, { status: 400 });
  }
}
