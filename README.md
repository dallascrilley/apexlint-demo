# Apexlint

> **Your agent wrote Apex at 2am. Who reviewed it?**

Apexlint is a **deterministic linter** for the three artifact types AI agents most commonly produce in Salesforce / ops environments: Apex classes & triggers, Salesforce Flow JSON exports, and n8n workflow DSL. It runs **16 deterministic rules** over the exact source you submit — no LLM, no model call, no data leaving to a third party. Sub-50ms per pass.

The rule engine runs two ways: **client-side in the browser** (instant, zero-egress) and on a **live Cloudflare Pages Function** (`POST /apexlint/lint`) so the analysis is provably real, not a canned reel. The two code paths are two synchronized implementations of the same 16 rules — TypeScript for the browser, plain JS for the Function — and parity is enforced in CI: `tests/engine-parity.test.js` runs a fixture corpus through both engines and fails if their findings ever differ.

**Live demo:** [demos.dallascrilley.com/apexlint](https://demos.dallascrilley.com/apexlint) — lint the synthetic samples instantly, or paste your own Apex/Flow/n8n and hit **“Lint on server.”**

## Real vs. synthetic — the honest boundary

| Capability | Source |
| --- | --- |
| Run 16 deterministic rules over Apex / Flow JSON / n8n you paste | **Real** — actual static analysis of your bytes, client-side and on the live backend |
| `POST /apexlint/lint` server endpoint returning `{ tab, findings, counts }` | **Real** — a deployed Cloudflare Pages Function running the server twin of the browser engine (parity-gated in CI) |
| Findings cite a rule ID (AP-001 … N8-004), severity, line, and a fix | **Real** — emitted deterministically per rule |
| Pre-loaded sample artifacts (the “2am agent output” shown on load) | Synthetic — `public/data/samples.json`, regenerated from the engine so they always match live output |
| Live Salesforce Metadata-API / n8n-REST connection that pulls *from your org* | Out of scope — that needs a server-side OAuth flow; you paste source, the backend lints it |
| Full Apex/Flow grammar (AST) | Out of scope — rules use comment-stripping + brace-depth + regex + JSON-structure checks |
| Automated remediation | Out of scope — Apexlint surfaces the finding and a one-paragraph fix; a human applies it |

The synthetic samples let a reviewer try it instantly; pasting your own source and clicking “Lint on server” proves the rule engine is genuine and runs on a real backend.

## The 16 rules

**Apex (8):** AP-001 SOQL-in-loop · AP-002 DML-in-loop · AP-003 unbulkified single-SObject handler · AP-004 hardcoded Salesforce ID · AP-005 unguarded relationship deref (NPE) · AP-006 empty catch · AP-007 `*Test` class missing `@isTest` · AP-008 test method with no assertion.

**Flow (4):** FL-001 DML node with no fault connector · FL-002 hardcoded ID in an assignment · FL-003 fault path to a non-descriptive node · FL-004 orphan node.

**n8n (4):** N8-001 empty `settings.errorWorkflow` · N8-002 `httpRequest` with `retryOnFail: false` · N8-003 unauthenticated webhook · N8-004 destructive node with no `continueOnFail`.

Each rule has positive + clean coverage in `tests/apexlint-lint.test.js`.

## The backend

`functions/apexlint/lint.js` is a Cloudflare Pages Function exposing `POST /apexlint/lint`:

```bash
curl -s https://demos.dallascrilley.com/apexlint/lint \
  -H 'content-type: application/json' \
  -d '{"tab":"apex","source":"for (Opportunity o : Trigger.new) { List<Task> t = [SELECT Id FROM Task WHERE WhatId = :o.Id]; }"}'
# → {"tab":"apex","findings":[{"ruleId":"AP-001",...}],"counts":{"AP-001":1}}
```

It reads `{ tab, source }` (tab ∈ `apex|flow|n8n`), runs the engine, and returns `{ tab, findings, counts }`. No secrets, no external calls, no LLM. The pure `runRulePack` / `lint` / per-rule helpers are exported so they unit-test without a network.

## Run locally

```bash
pnpm install
pnpm test                                    # node --test — all 16 rules, 3 sample fixtures, browser/server engine parity
pnpm build                                   # static site → ./dist
npx wrangler pages dev dist                  # serve site + POST /apexlint/lint locally (port 8788)
pnpm dev                                     # static UI only — http://localhost:4321 (samples, no backend)
```

The backend (`/apexlint/lint`) is available under `wrangler pages dev`; `pnpm dev` serves the client-side UI alone (samples still lint instantly in-browser).

## What it proves

- **Agent-code failure-mode expertise** — SOQL-in-loop and unbulkified DML are the exact bugs that pass unit tests and die at record 101 in prod.
- **Deterministic guardrail design** — knowing *when not to use an LLM* is the senior signal. Deterministic rules gate CI; non-deterministic reviewers can't.
- **Honest system boundaries** — the real/synthetic and "no OAuth, you paste the source" lines are explicit in the UI banner, the API response, and this README.
- **Cross-domain ops fluency** — Apex, Flow JSON, and n8n DSL reviewed with equal precision.

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the rule-engine structure, the client/server engine-parity design, and tradeoffs.

## License

MIT
