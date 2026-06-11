# Apexlint

> **Your agent wrote Apex at 2am. Who reviewed it?**
> Apexlint lints the Apex, Flow JSON, and n8n DSL your AI just shipped — before it hits prod.

| Field | Value |
|---|---|
| **Slug** | `apexlint` |
| **Lane fit** | L2 (Applied AI / AI Solutions Architect) primary |
| **Live route** | `demos.dallascrilley.com/apexlint` |
| **Rule source** | `github.com/dallascrilley/apexlint-demo` (public — 16 rules + the fixture pairs that prove them) |
| **Status** | Spec — ready to build |
| **Build estimate** | ~2 weeks |
| **Accent token** | `--accent: oklch(62% 0.24 27)` ember-orange |

---

## 1. Title, vision, and positioning

**Apexlint** is a client-side, rule-based linter for the three artifact types AI agents most commonly produce in Salesforce / ops environments: Apex classes, Flow JSON exports, and n8n workflow DSL. It runs deterministic rule packs in the browser, with the same engine also exposed as a Cloudflare Pages function (`POST /apexlint/lint`) — no LLM, no API keys, no secrets — and returns ranked findings, each with severity, the rule that fired, the exact line or node locus, and a concrete fix.

**The one-line claim it makes:** an AI writing ops-code makes *specific, reproducible mistakes*, and the right guardrail catches them deterministically — in milliseconds, with no model call, no latency tax, and an audit trail you can diff in CI.

**Positioning to the interviewer:** this is a diagnostic/guardrail layer that sits *between* an agent and production. It mirrors the verbatim language of three target-role postings (Elation Health, Ping Identity, Engine — §2) where reviewing AI-generated code is now an explicit job duty.

### Voice / microcopy sample

The product talks like a senior reviewer leaving a PR comment — terse, specific, never scolding:

- Empty state: *"Clean. No governor traps, no hardcoded ids, no silent catches. Paste your own to break it."*
- On a CRITICAL: *"SOQL inside a loop. This passes every unit test and dies in prod at row 101."*
- Banner: *"Synthetic code only — this is a portfolio demo, not a connected org."*
- Honest-limits link: *"What this can't catch →"* (not "Disclaimer").

---

## 2. Problem and evidence

Standard PR tools — ESLint, SonarQube, PMD — do not understand Salesforce governor limits, Flow node semantics, or n8n execution DSL. Cursor and Claude write Apex that *compiles and passes unit tests* but silently blows up at scale: SOQL inside a loop hits the 100-query governor at record 101; unbulkified DML triggers on the 151st record; a hardcoded record ID breaks in every sandbox. The reviewer-of-AI-code today is a senior human staring at a screen — or nobody, and the breakage surfaces in production.

**Direct posting evidence (verbatim):**

- **Elation Health** (`greenhouse.io/elationhealth`): *"Act as the final gatekeeper for team builds. You are responsible for ensuring all code (especially AI-generated code) is fully bulkified, secure, and follows strict error-handling standards."*
- **Ping Identity** (`greenhouse.io/pingidentity/jobs/8472396002`): *"Support the agent governance process… ensuring custom agents meet security, PII, and compliance requirements before production deployment."*
- **Engine** (`greenhouse.io/engine/jobs/7659263003`): *"Develop robust, well-documented solutions with proper error handling, monitoring, and testing to ensure long-term stability."*

The pattern: **AI governance is now an explicit job duty.** Apexlint is the artifact that proves Dallas has internalized it. Additional signal: **CentralReach** (`greenhouse.io/centralreach/jobs/4214753009`) fuses RAGAS/TruLens eval with Salesforce Flow — guardrail work at the ops-code layer is real and growing.

---

## 3. Target role and the senior signal

**Primary audience:** Applied AI Engineer, AI Solutions Architect, Forward Deployed Engineer.

**What it proves in 30 seconds:**

1. Dallas knows the *specific* failure modes of agent-generated Salesforce/ops code — rule by rule, locus by locus, not in the abstract.
2. Dallas can design a guardrail that sits between an agent and prod with no live LLM and no production credentials — in-browser by default, with the same deterministic engine on a keyless serverless endpoint.
3. Dallas's instinct is diagnostic and audit-first — the posture the portfolio anti-pattern analysis recommends ("position every new product as a diagnostic/audit/guardrail layer over the existing stack, not a replacement").

### Why deterministic rules — not an LLM call — is the senior move

This is the load-bearing architectural decision, and it is deliberate. A junior reach here is "pipe the code to GPT and ask it to review." Apexlint refuses that on purpose:

| Concern | LLM-as-reviewer | Apexlint (deterministic rules) |
|---|---|---|
| **Determinism** | Same input, different findings run to run. Can't gate a CI on it. | Same input → byte-identical findings, every time. CI-gateable. |
| **Latency** | 1–5s per review, network round-trip. | Sub-50ms, in-browser, no network. |
| **Secrets / data egress** | Source code leaves the building to a third party. | Code never leaves the tab. Nothing to leak. |
| **Auditability** | "The model said so" — no rule to cite in a postmortem. | Every finding cites a rule ID + fixture; reviewable in a public repo. |
| **Cost** | Per-token, scales with codebase. | Zero marginal cost. |

The interview line: *"You don't put a non-deterministic black box on the production gate. You put deterministic rules there, and you reserve the LLM for the fuzzy stuff — explaining a finding, not deciding it."* Knowing *when not to use an LLM* is the signal.

**How it complements Console:** Console (existing) *generates* internal tools; Apexlint *reviews* what an agent generated. Adjacent stages of one loop — reinforces the "I build the whole loop" narrative.

---

## 4. The signature moment

Everything in the demo funnels to one finding. When a Salesforce platform lead lands on `/apexlint`, the Apex sample is already loaded and already linted. The first row in the findings panel is glowing ember:

> **● CRITICAL · AP-001 · Line 4** — SOQL inside a loop. Passes every unit test; dies in prod at row 101 when it hits the 100-query governor.

They click it. **The split-pane snaps:** the code panel scrolls to line 4, the offending `[SELECT Id FROM Task WHERE WhatId = :opp.Id]` lights with an ember left-rail and a faint underglow, and the loop it lives inside (lines 2–11) dims everything else to half-opacity so the trap is visually unmissable — query *inside* the `for`. The fix panel expands inline with the bulkified rewrite, side by side.

That is the moment a platform lead screenshots and captions *"yep — that's the exact bug."* It works because it is the canonical Salesforce failure mode, the locus is exact, the explanation names the precise governor and the precise row it dies on, and the fix is the real bulkified pattern, not a hand-wave. Build everything else to make *this click* feel inevitable.

---

## 5. The demo — core flow

**Interactive, not illustrative.** Sample is pre-loaded and pre-linted on open (no empty first impression). User can paste their own or reload a sample per tab. All linting is client-side; lint pass is <50ms, so there is no spinner — findings just appear.

### Tabs

| Tab | Artifact | Sample loaded on open |
|---|---|---|
| **Apex** | Salesforce Apex trigger (`.cls`) | `OpportunityEnrichmentTrigger` — agent-generated, 4 planted issues |
| **Flow** | Salesforce Flow JSON (Metadata API export) | `Lead_Round_Robin_Assign` — 2 planted issues |
| **n8n** | n8n workflow DSL JSON | `Contact_Enrichment` — 2 planted issues |

### UI layout — the split-pane motif

```
┌─ Apex │ Flow │ n8n ───────────────────────────────────────────────┐
│                                                                    │
│  ┌─ CODE ──────────────────┐  ┌─ FINDINGS — 4 ──────────────────┐  │
│  │  1  trigger Opportu...   │  │  ● CRITICAL  AP-001   Line 4    │  │  ← selected
│  │  2    for (Opportu...    │  │     SOQL inside loop            │  │     (ember left-rail)
│  │  3      // enrich        │  │     ▸ fix                       │  │
│  │ ▸4      List<Task>...    │  │  ● HIGH      AP-004   Line 7    │  │
│  │  5      ...              │  │  ● MEDIUM    AP-005   Line 10   │  │
│  └──────────────────────────┘  │  ● MEDIUM    AP-006   Line 16   │  │
│   ↑ selected finding scrolls    └─────────────────────────────────┘ │
│     here, lights line 4,        Sort: severity ↓ │ rule │ line       │
│     dims the rest                                                    │
└────────────────────────────────────────────────────────────────────┘
```

Findings header: **"4 findings — 1 critical, 2 high, 1 medium."** Each row: severity dot + badge, rule ID (mono), locus, one-line message, `▸ fix` disclosure.

### The signature interaction (the one to nail)

**Click a finding → the code half responds.** Scroll-to-line, ember left-rail + underglow on the offending line(s), dim the rest of the file to 50% opacity, expand the fix inline. Reverse-binds too: clicking a flagged line selects its finding. This bidirectional code↔finding link *is* the product's identity — it is the VS Code Problems panel with an opinion. Keyboard: `↑/↓` move selection, `Enter`/`→` expands the fix, `Esc` clears the dim. Honor `prefers-reduced-motion` (snap instead of animate; no dim pulse).

---

## 6. Rule packs

### Apex (8 rules)

| Rule ID | Name | Severity | Detection logic |
|---|---|---|---|
| `AP-001` | SOQL inside loop | CRITICAL | `SELECT` query inside a `for`/`while` body (brace-depth tracked, comments/strings stripped first) |
| `AP-002` | DML inside loop | CRITICAL | `insert`/`update`/`delete`/`upsert` inside a loop body |
| `AP-003` | Unbulkified handler | HIGH | Handler method takes a single `SObject`, not `List<SObject>` |
| `AP-004` | Hardcoded record ID | HIGH | 15/18-char SF ID literal in a string (`['"][a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?['"]`) |
| `AP-005` | Missing null guard before field access | MEDIUM | Relationship field access (`x.Account.Name`) with no prior null check on the parent |
| `AP-006` | Empty catch block | MEDIUM | `catch` body is whitespace/comment only |
| `AP-007` | Missing `@isTest` on test class | LOW | Class name ends in `Test`, no `@isTest` annotation |
| `AP-008` | Test method without asserts | LOW | `@isTest` method contains no `System.assert*` call |

### Flow (4 rules)

| Rule ID | Name | Severity | Detection logic |
|---|---|---|---|
| `FL-001` | Missing fault path on DML | HIGH | `recordCreates`/`recordUpdates`/`recordDeletes` node with no `faultConnector` |
| `FL-002` | Hardcoded record ID in assignment | HIGH | `inputAssignments[].value.stringValue` matches a 15/18-char ID literal |
| `FL-003` | Empty fault path | MEDIUM | `faultConnector` present but lands on an `End` or a Screen with no message |
| `FL-004` | Orphan node | LOW | Node in `elements` with no inbound/outbound connector and not the Start |

### n8n (4 rules)

| Rule ID | Name | Severity | Detection logic |
|---|---|---|---|
| `N8-001` | No error workflow | HIGH | `settings.errorWorkflow` absent/empty |
| `N8-002` | HTTP node, no retry | HIGH | `n8n-nodes-base.httpRequest` with `retryOnFail` absent/`false` |
| `N8-003` | Webhook, no auth | MEDIUM | `n8n-nodes-base.webhook` with `authentication` = `none`/absent |
| `N8-004` | No `continueOnFail` on destructive node | MEDIUM | `emailSend` or POST/DELETE `httpRequest` with `continueOnFail` absent |

---

## 7. Synthetic samples (real code, planted bugs)

These are the demo's credibility. Each is realistic enough that a reviewer recognizes the bug on sight. A builder implements them verbatim and the acceptance criteria pin the exact findings.

### Sample 1 — `OpportunityEnrichmentTrigger` (Apex, 4 findings)

A plausible "enrich each Opportunity on update" trigger an agent would emit:

```apex
trigger OpportunityEnrichmentTrigger on Opportunity (before update) {
    for (Opportunity opp : Trigger.new) {
        // AP-001 — query per record
        List<Task> openTasks = [SELECT Id FROM Task WHERE WhatId = :opp.Id AND IsClosed = false];
        opp.Open_Task_Count__c = openTasks.size();

        // AP-004 — works in this sandbox, nowhere else
        if (opp.OwnerId == null) {
            opp.OwnerId = '0051g00000XyZaBAAV';
        }

        // AP-005 — Account may be null on a before-update insert path
        opp.Account_Tier__c = opp.Account.Industry;
    }

    try {
        update Trigger.new;
    } catch (DmlException e) {
        // AP-006 — TODO: handle
    }
}
```

| # | Rule | Sev | Locus | Message | Fix |
|---|---|---|---|---|---|
| 1 | AP-001 | CRITICAL | Line 4 | SOQL inside a loop — hits the 100-query governor at record 101. Passes unit tests with <100 rows. | Hoist the query above the loop: collect `opp.Id` into a `Set<Id>`, query `WHERE WhatId IN :ids`, build a `Map<Id, Integer>`, then read it inside the loop. |
| 2 | AP-004 | HIGH | Line 9 | Hardcoded ID `0051g00000XyZaBAAV` — valid only in the org it was copied from; breaks every sandbox + new prod. | Resolve the default owner via Custom Metadata (`Default_Owner__mdt`) or a Custom Setting; never literal-ID an owner. |
| 3 | AP-005 | MEDIUM | Line 13 | `opp.Account.Industry` dereferences `Account` with no null guard — NPE when `AccountId` is null. | Guard: `if (opp.AccountId != null) { … }`, or query the parent and map it; relationship fields are not auto-loaded in triggers. |
| 4 | AP-006 | MEDIUM | Line 19 | Empty catch swallows the `DmlException` — the failure vanishes with no signal. | Re-throw, or `addError()` on the record, or publish a Platform Event / `Log__c`. A bare `// TODO` ships the bug. |

### Sample 2 — `Lead_Round_Robin_Assign` (Flow JSON, 2 findings)

A round-robin lead-assignment flow. The `recordUpdates` node has no fault path; one assignment hardcodes a fallback queue ID.

```json
{
  "Flow": {
    "label": "Lead Round Robin Assign",
    "processType": "AutoLaunchedFlow",
    "start": { "connector": { "targetReference": "Assign_Owner" } },
    "assignments": [
      {
        "name": "Assign_Owner",
        "assignmentItems": [
          { "assignToReference": "$Record.OwnerId", "operator": "Assign",
            "value": { "stringValue": "00G1g000004ZxYZEA0" } }
        ],
        "connector": { "targetReference": "Update_Lead_Owner" }
      }
    ],
    "recordUpdates": [
      {
        "name": "Update_Lead_Owner",
        "object": "Lead",
        "inputReference": "$Record"
      }
    ]
  }
}
```

| # | Rule | Sev | Locus | Message | Fix |
|---|---|---|---|---|---|
| 1 | FL-001 | HIGH | Node `Update_Lead_Owner` | `recordUpdates` has no `faultConnector`. A validation rule or lock contention throws an unhandled fault and the flow dies silently. | Add a Fault connector to a Screen (interactive) or an `Apex_Error_Log` subflow (autolaunched). Never leave DML faultless. |
| 2 | FL-002 | HIGH | Node `Assign_Owner` → `OwnerId` | Hardcoded ID `00G1g000004ZxYZEA0` (a Queue) in the assignment — breaks on deploy to any other org. | Resolve the fallback queue with a Get Records on `Group WHERE DeveloperName = 'Lead_Default_Queue'`, or store it in Custom Metadata. |

### Sample 3 — `Contact_Enrichment` (n8n DSL, 2 findings)

Webhook → HTTP Request (POST to an enrichment API) → Email Send. No error workflow; the HTTP node has retry disabled.

```json
{
  "name": "Contact Enrichment",
  "settings": {},
  "nodes": [
    { "name": "Webhook", "type": "n8n-nodes-base.webhook",
      "parameters": { "path": "enrich", "authentication": "none" } },
    { "name": "Enrich Contact", "type": "n8n-nodes-base.httpRequest",
      "parameters": { "method": "POST", "url": "https://api.enrich.example/v1/lookup" },
      "retryOnFail": false, "continueOnFail": false },
    { "name": "Notify Owner", "type": "n8n-nodes-base.emailSend",
      "parameters": { "toEmail": "={{$json.ownerEmail}}" } }
  ]
}
```

| # | Rule | Sev | Locus | Message | Fix |
|---|---|---|---|---|---|
| 1 | N8-001 | HIGH | Workflow settings | `settings.errorWorkflow` is empty. Any node throwing fails the run silently — the contact is never enriched and nobody is told. | Set `settings.errorWorkflow` to a workflow that posts to Slack / writes to a dead-letter store. |
| 2 | N8-002 | HIGH | Node `Enrich Contact` | HTTP POST with `retryOnFail: false` — one transient 5xx from the enrichment API permanently drops the record. | `retryOnFail: true`, `maxTries: 3`, `waitBetweenTries: 1000`. (`N8-003` webhook-auth + `N8-004` continueOnFail also fire here at MEDIUM if you want the full pack.) |

---

## 8. Brand / visual direction

### Wordmark & tagline

**Apexlint** — one word. Wordmark: `APEX` solid, `LINT` one weight lighter, split by a thin ember hairline (`1px`, `--color-critical`) — the severity-badge metaphor baked into the logotype.

Tagline: **"Lint the ops-code your agent shipped."**

### Direction: *terminal diagnostic authority* (deliberate, not trendy-dark)

Dark because the product *reads code and surfaces errors* — a terminal/IDE mental model, not a fashion choice. The bar: an opinionated VS Code Problems panel. Authoritative, scannable, zero decoration. Distinct from siblings: **Tracewell** (incident timeline) is horizontal/temporal; **Funnelguard** (marketing-ops) is dashboard-bright; **Q2See** (flow-graph) is node/edge canvas. Apexlint alone is the **code↔findings split-pane** — vertical, dense, monospace-forward.

**Palette (oklch):**

```css
--color-surface:        oklch(14% 0.01 250);  /* near-black, slight blue cast   */
--color-surface-raised: oklch(18% 0.01 250);  /* code editor background         */
--color-surface-panel:  oklch(20% 0.01 250);  /* findings panel                 */
--color-line-dim:       oklch(18% 0.01 250 / 0.5); /* non-focused lines on click */
--color-text:           oklch(90% 0.01 250);  /* primary text                   */
--color-text-muted:     oklch(55% 0.01 250);  /* line numbers, labels           */
--color-accent:         oklch(62% 0.24 27);   /* ember-orange — active / select */
--color-critical:       oklch(57% 0.24 27);   /* ember, deeper                  */
--color-high:           oklch(72% 0.22 55);   /* amber                          */
--color-medium:         oklch(72% 0.16 250);  /* cool blue                      */
--color-low:            oklch(55% 0.01 250);  /* muted                          */
--glow-critical:        0 0 0 1px oklch(57% 0.24 27 / 0.5), -3px 0 0 0 var(--color-critical);
```

**Severity system** — one dot color per level, used *everywhere* the level appears (badge, code left-rail, count summary) so the eye learns it once: CRITICAL ember, HIGH amber, MEDIUM cool-blue, LOW muted. Never decorative; color always *means* severity.

**Type:** `JetBrains Mono` for the code panel, rule IDs, and loci; `Inter` for UI chrome and prose. Scale: H1 `clamp(2rem, 1.5rem + 2vw, 3rem)`; finding message `0.9375rem`; rule ID `0.75rem` mono; line numbers `0.75rem` mono muted.

**Anti-template guardrails:**

- [x] Hierarchy by scale + color: severity dot dominates, rule ID secondary, fix tertiary (disclosed).
- [x] No card grid — single-axis findings list, fixed `44px` rows, scans like real linter output.
- [x] Signature interaction (the code↔finding bind, §5) carries the identity, not decoration.
- [x] Motion is functional only: ember left-rail eases in `150ms`, dim cross-fades `120ms`, fix expands `180ms ease-out`. Killed under `prefers-reduced-motion`.
- [x] Both panels share the surface ramp; depth from `--surface-raised` vs `--surface-panel`, not borders.

---

## 9. Technical architecture

- **Framework:** Astro 5, static output (demo-lab convention).
- **Language:** TypeScript 5.6.
- **Rule engine:** pure TS — each rule is `(ctx) => Finding[]`; no external linter dependency. Apex rules: comment/string strip pre-pass → brace-depth scan + regex. Flow/n8n rules: `JSON.parse()` → walk the object tree.
- **Editor:** CodeMirror 6 — `@codemirror/lang-json` for Flow/n8n; minimal Apex keyword highlighter (no LSP); `<textarea>` fallback. Line-highlight + dim driven by a CM decoration set keyed off the selected finding's `lineNumber`/`lineRange`.
- **No LLM, no API keys, no secrets.** In-browser by default; the identical rule pack also runs server-side at `POST /apexlint/lint` (Cloudflare Pages function, keyless).

```
src/demos/apexlint/
  index.astro          — landing + demo shell
  LintPanel.tsx        — tabs + editor + findings (Astro island, client:load)
  rules/
    apex/  AP-001..008.ts
    flow/  FL-001..004.ts
    n8n/   N8-001..004.ts
    index.ts           — runRulePack(tab, source) → Finding[]
  types.ts             — Finding, Severity, RuleMeta
  samples/             — three synthetic files from §7
```

```ts
type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

interface Finding {
  ruleId: string;            // 'AP-001'
  severity: Severity;
  locus: string;             // 'Line 4' | 'Node Update_Lead_Owner'
  message: string;           // one sentence
  fix: string;               // one-paragraph fix
  lineNumber?: number;       // anchor for scroll + select
  lineRange?: [number, number]; // span to dim-around (e.g. the loop, lines 2..11)
}
```

**Deployment:** static route under `demos.dallascrilley.com/apexlint` via the demo-lab Cloudflare Pages pipeline. All linting is client-side island hydration. The rule pack + fixtures also publish to `github.com/dallascrilley/apexlint-demo` so the claim is independently verifiable.

---

## 10. Objection → proof

| Reviewer's concern | Role | How Apexlint answers it |
|---|---|---|
| "Does he actually know Salesforce failure modes, or just buzzwords?" | Salesforce platform lead | The AP-001 finding names the *exact* governor (100 queries) and the *exact* row it dies on (101), with the real bulkified fix. Domain-specific, not generic. |
| "Can he govern agent-generated code, like the JD asks?" | Applied AI / Elation, Ping | A working guardrail that sits between agent and prod — the literal "final gatekeeper" duty, shipped and runnable. |
| "Is this another LLM-wrapper toy?" | AI Solutions Architect | No model call anywhere. Deterministic rules chosen *on purpose* for CI-gateability and auditability (§3). Knowing when *not* to use an LLM is the point. |
| "Will it survive scrutiny / is it honest?" | FDE, any senior | Public rule repo with fixture pairs (passing + failing) per rule. Scope limits stated up front as design, not apology (§12). |
| "Can he build clean front-end too?" | Internal Tools | The code↔finding split-pane interaction (§5) is a non-trivial, polished UI primitive — not a Bootstrap form. |

---

## 11. Scope: in / out

**In (v1):** three tabs (Apex, Flow JSON, n8n DSL) · 16 deterministic rules · three pre-loaded synthetic samples (pre-linted on open) · paste-your-own per tab · severity/rule/line sort · per-finding expandable fix · the code↔finding bind with line dim · empty "clean" state · synthetic-data banner · honest-limits section · responsive 375/768/1280 · `prefers-reduced-motion` honored.

**Out (v1):** real org / Flow metadata / n8n instance connection · full Apex AST (ANTLR) · execution-time / coverage analysis · SOQL analysis beyond presence-in-loop · auto-fix mutation · any LLM-backed explain/rewrite · VS Code extension / CLI / CI integration (the rule pack repo is the seed for those later).

---

## 12. Honest limits — stated as design, not apology

**Banner (dismissible per session):** *"Synthetic code only — this is a portfolio demo, not a connected org. All linting runs on pre-loaded sample code, in your browser."*

**Landing section ("What this can't catch →"):**

1. **Bounded rule pack, by design.** PMD's Apex ruleset has hundreds of rules; Apexlint ships 16 — the *most common agent-generated failure modes*. The narrowness is the point: a tight, auditable pack you can reason about and gate CI on beats a sprawling one nobody trusts.
2. **Heuristic, not full static analysis.** Apex rules use a comment-strip pass + brace-depth + regex, not a full ANTLR AST. This demonstrates the *architecture* of a deterministic guardrail layer, not production-grade coverage — and it says so.
3. **No execution-time analysis.** Real governor consumption, coverage gaps, and dynamic data flow need to *run* the code. Apexlint is static-pattern only.
4. **n8n DSL version-pinned** to the v1.x workflow schema; newer versions may rename fields.
5. **No production integration.** The Metadata-API / n8n-REST connection layer is sketched in §9 but not wired — that would need a server-side OAuth flow, out of scope for a no-backend demo.
6. **Verify it yourself.** Every rule and its passing/failing fixture pair lives in the public `apexlint-demo` repo. The demo's claim is checkable, not asserted.

---

## 13. Acceptance criteria

- **AC1:** `/apexlint` loads over HTTPS, no console errors, **zero external network requests** (verifiable in the Network tab — proves the no-egress claim).
- **AC2:** Apex sample pre-lints to exactly 4 findings in this order: AP-001 CRITICAL (L4), AP-004 HIGH (L9), AP-005 MEDIUM (L13), AP-006 MEDIUM (L19).
- **AC3:** Flow sample → exactly FL-001 HIGH, FL-002 HIGH.
- **AC4:** n8n sample → exactly N8-001 HIGH, N8-002 HIGH.
- **AC5:** A clean Apex paste → zero findings + explicit "clean" state (not a blank panel).
- **AC6:** Clicking the AP-001 finding scrolls the code panel to line 4, applies the ember rail + glow to line 4, dims lines outside the loop range, and expands the fix — the signature moment (§5) works.
- **AC7:** Clicking a flagged code line selects its finding (reverse bind).
- **AC8:** `↑/↓` move selection, `Enter`/`→` expand fix, `Esc` clears the dim; all reachable by keyboard.
- **AC9:** No secrets, API keys, or real user data anywhere in the bundle.
- **AC10:** Lighthouse mobile ≥ 90; no console errors when pasting a 500-line Apex class.
- **AC11:** Sort controls (severity / rule / line) reorder correctly.
- **AC12:** `prefers-reduced-motion` disables the dim pulse and rail animation (snap instead).

---

## 14. Build sequence

**Phase 1 — Shell + landing (2d):** Astro route; terminal-diagnostic brand pass (palette, JetBrains Mono + Inter); above-the-fold H1 "Your agent wrote Apex at 2am. Who reviewed it?", sub, CTA "Open the linter"; synthetic banner (shared component); honest-limits section.

**Phase 2 — Rule engine + samples (4d):** `types.ts`; `runRulePack` dispatcher; all 16 rules with vitest fixture pairs (one passing, one failing per rule); the three §7 samples verbatim; prove AC2–AC5 in isolation before any UI. Publish `apexlint-demo` repo from this code.

**Phase 3 — Interactive UI (4d):** `LintPanel.tsx` island; CodeMirror (JSON + Apex highlight, textarea fallback); paste + load-sample per tab; finding rows with severity dot/badge/locus/message/fix disclosure; **the code↔finding bind (scroll, rail, glow, dim) — the priority of the phase**; reverse line→finding select; keyboard nav; sort; clean state; responsive.

**Phase 4 — Polish + gates (2d):** all 12 ACs; Lighthouse ≥ 90; `pa11y` (keyboard, ARIA on severity badges, contrast); `lychee` link check; final copy pass on messages, fixes, banner, limits.

---

## 15. Open questions / risks

| Question | Answer | Risk if wrong |
|---|---|---|
| Can regex + brace-depth detect SOQL-in-loop without false positives? | Strip comments/strings first, then match `SELECT` inside a tracked loop body. Low FP on the curated samples; document the heuristic limit. | High FP rate erodes trust — mitigate by narrowing samples to clean detection cases and stating the limit. |
| Does CodeMirror have an Apex mode? | No official one; ship a minimal keyword highlighter (or SQL-proxy) for Apex; JSON mode is native for Flow/n8n. Degraded Apex highlight is acceptable if disclosed; don't block ship on it. | Cosmetic only. |
| How to signal rule-based, not AI-powered? | "How it works" paragraph + §3 table + honest-limits. Never say "AI-powered linting." The determinism *is* the senior signal — lead with it. | Overstating capability backfires in interview; under-stating buries the best signal. |
| Public rule repo? | Yes — `apexlint-demo` with the 16 rules + fixture pairs. Same view-source credibility play as Routely. | Without it, the claim is unverifiable; ship the repo. |
| Three tabs or Apex-only at launch? | Apex first; full three-tab is the target. If the build runs long, ship Apex + n8n, defer Flow (n8n is higher signal for the L2 buyer). | One tab reads thin. |
