# Apexlint

> **Your agent wrote Apex at 2am. Who reviewed it?**

Apexlint is a client-side, deterministic linter for the three artifact types AI agents most commonly produce in Salesforce / ops environments: Apex classes, Flow JSON exports, and n8n workflow DSL. It runs 16 rules entirely in the browser — no backend, no API keys, no model call. Sub-50ms per lint pass.

**Live demo:** [demos.dallascrilley.com/apexlint](https://demos.dallascrilley.com/apexlint)

## What it proves

- **Agent-code failure-mode expertise** — rules like SOQL-inside-loop and unbulkified DML are the exact bugs that pass unit tests and die in prod.
- **Deterministic guardrail design** — knowing *when not to use an LLM* is the senior signal. Deterministic rules gate CI; LLMs don't.
- **Cross-domain ops fluency** — Apex triggers, Salesforce Flow JSON, and n8n DSL are reviewed with equal precision.
- **Diagnostic UI design** — bidirectional code↔finding link: click a finding → code highlights; click a line → finding selects.

## Run locally

```bash
pnpm install
pnpm dev
```

Open `http://localhost:4321`. The demo loads synthetic samples from `public/data/samples.json`.

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for design decisions, rule engine structure, and tradeoffs.

## Honest limits

- **No live org connection** — this does not connect to Salesforce or execute real Apex.
- **No full language parser** — rules use regex and brace-depth tracking, not a formal grammar. Catches the common bugs; misses edge cases.
- **Synthetic samples only** — the planted bugs are realistic, but pre-authored.
- **No CI integration** — the rule engine is designed to be CI-gateable, but this demo has no GitHub Action or CLI wrapper.

## License

MIT
