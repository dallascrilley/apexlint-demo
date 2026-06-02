# Apexlint Architecture

## Stack

- **Astro 5** — static site generator
- **TypeScript** — vanilla TS, no framework; the UI is a split-pane code review surface
- **One Cloudflare Pages Function** (`functions/apexlint/lint.js`, `POST /apexlint/lint`) running the same engine server-side
- **No API keys, no secrets, no environment variables, no external calls**

## Two code paths, one engine

The 16 rules exist as a pure function `runRulePack(tab, source) → Finding[]`. It is shipped twice from identical logic:

- **Client** (`src/components/rules.ts`, TypeScript) — runs in the browser for instant, zero-egress linting of the samples and anything you paste.
- **Server** (`functions/apexlint/lint.js`, plain JS) — a Cloudflare Pages Function that runs the *same* logic on a real backend so the analysis is provably not a canned reel.

The two are byte-equivalent: `public/data/samples.json` is regenerated from the engine, so the shipped findings, the in-browser findings, and the live `/apexlint/lint` response are identical. `tests/apexlint-lint.test.js` pins all three.

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
  ruleId: string;                 // "AP-001"
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  locus: string;                  // "Line 4" | "Node: Update_Lead_Owner"
  message: string;                // one sentence
  fix: string;                    // one-paragraph fix
  lineNumber?: number;            // anchor for scroll + highlight
  lineRange?: [number, number];   // span to dim-around (e.g. the loop body)
}

type TabId = 'apex' | 'flow' | 'n8n';
```

The server endpoint returns `{ tab, findings: Finding[], counts: Record<ruleId, number> }`.

Samples (`public/data/samples.json`) contain pre-loaded "2am agent output" for each tab, with their `findings` regenerated from the engine so they always match live output:
- **Apex** — `OpportunityEnrichmentTrigger` (4 findings: AP-001 SOQL loop, AP-004 hardcoded ID, AP-005 null guard, AP-006 empty catch)
- **Flow** — `Lead_Round_Robin_Assign` (2 findings: FL-001 missing fault path, FL-002 hardcoded queue ID)
- **n8n** — `Contact_Enrichment` (5 findings: N8-001 no error workflow, N8-002 no HTTP retry, N8-003 unauthenticated webhook, N8-004 ×2 destructive nodes with no `continueOnFail`)

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
| `src/components/rules.ts` | All 16 rule implementations + dispatcher (client) |
| `functions/apexlint/lint.js` | Same engine as a Cloudflare Pages Function (`POST /apexlint/lint`) |
| `tests/apexlint-lint.test.js` | `node --test` suite: all 16 rules (positive + clean) + 3 sample fixtures |
| `src/components/types.ts` | Shared interfaces |
| `src/styles/apexlint.css` | Split-pane layout, severity color system, code highlighting |

## What was cut for scope

- **Full Apex parser** — regex + brace depth only; misses nested generics and some anonymous block patterns. AP-006, for example, keys off the `} catch (...) {` one-liner shape rather than a full body analysis — a deliberate heuristic, pinned by tests.
- **Real org connection** — no Salesforce Metadata API, no n8n REST pull. The backend lints source you submit; it does not read from your org (that needs server-side OAuth).
- **CI wrapper** — no CLI, no GitHub Action for *your* repos (this repo's own CI runs the test + build).
- **Custom rule authoring UI** — rules are hardcoded.

## How to extend to production

A production version would need:
1. A formal Apex parser (ANTLR or tree-sitter) for accuracy
2. A CLI (`npx apexlint --ruleset=./rules.json src/`) for CI integration
3. A rule registry (YAML/JSON) so teams can add org-specific rules without recompiling
4. A SARIF output formatter for integration with GitHub Advanced Security / SonarQube

## Performance

- Lint pass: <50ms for samples up to 200 lines
- Bundle: ~20 KB gzipped (Astro + app code, no external deps)
