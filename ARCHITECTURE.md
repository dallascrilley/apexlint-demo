# Apexlint Architecture

## Stack

- **Astro 5** — static site generator
- **TypeScript** — vanilla TS, no framework; the UI is a split-pane code review surface
- **No backend, no API keys, no environment variables**

## Why deterministic rules instead of an LLM

This is the load-bearing architectural decision:

| Concern | LLM-as-reviewer | Apexlint (deterministic rules) |
|---|---|---|
| **Determinism** | Same input, different findings run to run. Can't gate CI. | Same input → byte-identical findings. CI-gateable. |
| **Latency** | 1–5s per review, network round-trip. | Sub-50ms, in-browser, no network. |
| **Secrets / data egress** | Source code leaves the building. | Code never leaves the tab. |
| **Auditability** | "The model said so" — no rule to cite. | Every finding cites a rule ID + locus. |
| **Cost** | Per-token, scales with codebase. | Zero marginal cost. |

The interview line: *"You don't put a non-deterministic black box on the production gate. You put deterministic rules there, and you reserve the LLM for the fuzzy stuff — explaining a finding, not deciding it."*

## Data model

```typescript
interface Finding {
  ruleId: string;      // "AP-001"
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  line: number;        // 1-based
  message: string;
  fix: string;
}

type TabId = 'apex' | 'flow' | 'n8n';
```

Samples (`public/data/samples.json`) contain pre-loaded code for each tab with planted bugs:
- **Apex** — `OpportunityEnrichmentTrigger` (4 findings: SOQL loop, hardcoded ID, null guard, empty catch)
- **Flow** — `Lead_Round_Robin_Assign` (2 findings: missing fault path, hardcoded queue ID)
- **n8n** — `Contact_Enrichment` (2 findings: no error workflow, no HTTP retry)

## Rule engine

Rules are plain functions `(source: string) => Finding[]`. Each rule handles one failure mode:

| Rule ID | Name | Severity | Detection |
|---|---|---|---|
| AP-001 | SOQL inside loop | CRITICAL | `SELECT` inside `for`/`while` body (brace-depth tracked) |
| AP-002 | DML inside loop | CRITICAL | `insert`/`update`/`delete`/`upsert` inside loop body |
| AP-003 | Unbulkified handler | HIGH | Handler takes `SObject`, not `List<SObject>` |
| AP-004 | Hardcoded record ID | HIGH | 15/18-char SF ID literal in string |
| AP-005 | Missing null guard | MEDIUM | Relationship field access without null check |
| AP-006 | Empty catch block | MEDIUM | `catch` body is whitespace/comment only |
| AP-007 | Missing `@isTest` | LOW | Class name ends in `Test`, no `@isTest` |
| AP-008 | Test without asserts | LOW | `@isTest` method contains no `System.assert*` |
| FL-001 | Missing fault path | HIGH | `recordCreates`/`Updates`/`Deletes` with no `faultConnector` |
| FL-002 | Hardcoded ID in Flow | HIGH | `inputAssignments[].value.stringValue` matches SF ID |
| FL-003 | Empty fault path | MEDIUM | `faultConnector` lands on `End` or Screen with no message |
| FL-004 | Orphan node | LOW | Node with no inbound/outbound connector |
| N8-001 | No error workflow | HIGH | `settings.errorWorkflow` absent/empty |
| N8-002 | HTTP node, no retry | HIGH | `httpRequest` with `retryOnFail` absent/`false` |
| N8-003 | Webhook, no auth | MEDIUM | `webhook` with `authentication` = `none`/absent |
| N8-004 | No `continueOnFail` | MEDIUM | Destructive node (`emailSend`, POST/DELETE) without `continueOnFail` |

## Key design decisions

### 1. Brace-depth tracking for Apex
Instead of a full parser, rules track brace depth to identify lines inside loop bodies. Comments and string literals are stripped first so a `SELECT` inside a string comment does not false-positive. This is fast and sufficient for the 8 Apex rules.

### 2. Bidirectional code↔finding binding
Clicking a finding scrolls the code panel to the line, adds an ember left-rail + glow, and dims the rest to 50% opacity. Clicking a flagged line selects its finding. This is the VS Code Problems panel interaction model — familiar to any engineer.

### 3. Pre-loaded and pre-linted on open
The sample is already loaded and linted when the page opens. No empty first impression. The user can paste their own or reload per tab.

## File map

| File | Responsibility |
|---|---|
| `src/pages/index.astro` | Shell: nav, hero, linter shell, how-it-works, comparison table, limits |
| `src/components/app.ts` | Bootstrap, tab switching, lint dispatch, findings rendering, keyboard nav |
| `src/components/rules.ts` | All 16 rule implementations + dispatcher |
| `src/components/types.ts` | Shared interfaces |
| `src/styles/apexlint.css` | Split-pane layout, severity color system, code highlighting |

## What was cut for scope

- **Full Apex parser** — regex + brace depth only; misses nested generics and some anonymous block patterns
- **Real org connection** — no Salesforce API, no metadata deploy
- **CI wrapper** — no CLI, no GitHub Action
- **Custom rule authoring UI** — rules are hardcoded TS

## How to extend to production

A production version would need:
1. A formal Apex parser (ANTLR or tree-sitter) for accuracy
2. A CLI (`npx apexlint --ruleset=./rules.json src/`) for CI integration
3. A rule registry (YAML/JSON) so teams can add org-specific rules without recompiling
4. A SARIF output formatter for integration with GitHub Advanced Security / SonarQube

## Performance

- Lint pass: <50ms for samples up to 200 lines
- Bundle: ~20 KB gzipped (Astro + app code, no external deps)
