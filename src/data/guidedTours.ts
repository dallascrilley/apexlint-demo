export const GUIDED_TOURS = {
  apexlint: {
    repoLabel: 'Apexlint',
    repoUrl: 'https://github.com/dallascrilley/apexlint-demo',
    steps: [
      {
        label: 'Paste ops code',
        body: 'Use Apex, Flow JSON, or n8n DSL. Samples are editable, so the lint surface behaves like a review gate, not a screenshot.',
      },
      {
        label: 'Run deterministic rules',
        body: 'Lint on server executes the same 16-rule engine on the live backend. No model call decides whether production code is safe.',
      },
      {
        label: 'Trace every finding',
        body: 'Each result cites a rule ID, line, severity, and fix direction, with public fixtures in the repo for passing and failing cases.',
      },
    ],
  },
} as const;
