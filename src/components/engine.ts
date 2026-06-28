// Single-origin engine entry for EXTERNAL consumers (e.g. the demo-lab storefront).
//
// apexlint-demo is the canonical source of the linting engine. The standalone app
// imports the local source modules directly; this barrel is the published surface
// that other repos depend on (via the package `exports` map) so the engine has ONE
// origin and can no longer drift between the storefront and the standalone repo.
export { runRulePack } from './rules.js';
export { SEVERITY_ORDER } from './types.js';
export type { Finding, SamplesData, SortKey, TabId } from './types.js';
