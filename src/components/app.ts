/**
 * Apexlint — client-side app entry point.
 * Loads sample data, wires tabs, runs the deterministic rule engine,
 * renders findings, implements code↔finding bidirectional binding.
 *
 * No external dependencies. Pure TypeScript.
 */

import { runRulePack } from './rules.js';
import type { Finding, SamplesData, SortKey, TabId } from './types.js';
import { SEVERITY_ORDER } from './types.js';

// ─── State ───────────────────────────────────────────────────────────────────

let samples: SamplesData | null = null;
let activeTab: TabId = 'apex';
let currentFindings: Finding[] = [];
let selectedFindingIdx: number | null = null;
let sortKey: SortKey = 'severity';
let expandedFixes: Set<number> = new Set();
let useCustomSource = false;

// ─── DOM helpers ──────────────────────────────────────────────────────────────

const $ = (id: string): HTMLElement | null => document.getElementById(id);

function codeLines(): HTMLElement | null { return $('al-code-lines'); }
function codeTextarea(): HTMLTextAreaElement | null { return $('al-code-textarea') as HTMLTextAreaElement | null; }
function findingsList(): HTMLElement | null { return $('al-findings-list'); }

// ─── Boot ─────────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  try {
    const res = await fetch('/data/samples.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    samples = (await res.json()) as SamplesData;
  } catch (err) {
    console.error('[apexlint] Failed to load samples:', err);
    const header = $('al-findings-header');
    if (header) header.textContent = 'Failed to load samples — check console.';
    return;
  }

  wireBanner();
  wireTabs();
  wireHonestLimits();
  wireSort();
  wireTextarea();
  wireLoadSample();
  wireKeyboard();
  switchTab('apex');
}

// ─── Banner ───────────────────────────────────────────────────────────────────

function wireBanner(): void {
  const dismiss = $('al-banner-dismiss');
  const banner = $('al-banner');
  if (!dismiss || !banner) return;
  dismiss.addEventListener('click', () => {
    banner.setAttribute('hidden', '');
    try { sessionStorage.setItem('al-banner-dismissed', '1'); } catch {}
  });
  try {
    if (sessionStorage.getItem('al-banner-dismissed')) banner.setAttribute('hidden', '');
  } catch {}
}

// ─── Honest limits accordion ───────────────────────────────────────────────────

function wireHonestLimits(): void {
  const toggle = $('al-limits-toggle');
  const body = $('al-limits-body');
  if (!toggle || !body) return;
  toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!expanded));
    body.classList.toggle('al-limits-body--open', !expanded);
  });
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

function wireTabs(): void {
  document.querySelectorAll('[data-al-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-al-tab') as TabId | null;
      if (tab) switchTab(tab);
    });
  });
}

function switchTab(tab: TabId): void {
  activeTab = tab;
  useCustomSource = false;
  selectedFindingIdx = null;
  expandedFixes.clear();
  sortKey = 'severity';
  resetSortButtons('severity');

  document.querySelectorAll('[data-al-tab]').forEach(btn => {
    const isActive = btn.getAttribute('data-al-tab') === tab;
    btn.classList.toggle('al-tab--active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });

  renderForTab(tab);
}

function renderForTab(tab: TabId): void {
  if (!samples) return;
  const sample = samples[tab];
  if (!sample) return;

  // Update header labels
  const filenameEl = $('al-filename');
  const descEl = $('al-desc');
  if (filenameEl) filenameEl.textContent = sample.filename;
  if (descEl) descEl.textContent = sample.description;

  // Set textarea value so user can paste-and-replace
  const ta = codeTextarea();
  if (ta) ta.value = sample.source;

  renderCodeLines(sample.source);
  lint(sample.source);
}

// ─── Code rendering ───────────────────────────────────────────────────────────

function renderCodeLines(source: string): void {
  const container = codeLines();
  if (!container) return;

  const lines = source.split('\n');
  // Build fragment for performance
  const frag = document.createDocumentFragment();

  lines.forEach((lineText, i) => {
    const lineNum = i + 1;
    const row = document.createElement('div');
    row.className = 'al-code-row';
    row.dataset.line = String(lineNum);

    const numEl = document.createElement('span');
    numEl.className = 'al-code-linenum al-mono';
    numEl.textContent = String(lineNum);
    numEl.setAttribute('aria-hidden', 'true');

    const textEl = document.createElement('span');
    textEl.className = 'al-code-linetext';
    textEl.textContent = lineText !== '' ? lineText : ' ';

    row.appendChild(numEl);
    row.appendChild(textEl);
    row.addEventListener('click', () => onCodeLineClick(lineNum));
    frag.appendChild(row);
  });

  container.innerHTML = '';
  container.appendChild(frag);
}

function onCodeLineClick(lineNum: number): void {
  // Find finding whose range includes this line
  const idx = currentFindings.findIndex(f => {
    if (f.lineRange) return lineNum >= f.lineRange[0] && lineNum <= f.lineRange[1];
    return f.lineNumber === lineNum;
  });
  if (idx >= 0) selectFinding(idx);
}

// ─── Linting ──────────────────────────────────────────────────────────────────

function lint(source: string): void {
  const raw = runRulePack(activeTab, source);
  currentFindings = sortFindings(raw, sortKey);
  selectedFindingIdx = null;
  expandedFixes.clear();
  updateFindingsHeader(raw);
  renderFindings();
  clearCodeHighlight();
}

function sortFindings(findings: Finding[], key: SortKey): Finding[] {
  return [...findings].sort((a, b) => {
    if (key === 'severity') {
      const diff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      return diff !== 0 ? diff : (a.lineNumber ?? 999) - (b.lineNumber ?? 999);
    }
    if (key === 'rule') return a.ruleId.localeCompare(b.ruleId);
    return (a.lineNumber ?? 999) - (b.lineNumber ?? 999);
  });
}

function updateFindingsHeader(findings: Finding[]): void {
  const header = $('al-findings-header');
  if (!header) return;

  if (findings.length === 0) {
    header.textContent = 'Clean.';
    return;
  }

  const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const f of findings) counts[f.severity]++;

  const parts: string[] = [];
  if (counts.CRITICAL) parts.push(`${counts.CRITICAL} critical`);
  if (counts.HIGH) parts.push(`${counts.HIGH} high`);
  if (counts.MEDIUM) parts.push(`${counts.MEDIUM} medium`);
  if (counts.LOW) parts.push(`${counts.LOW} low`);

  const s = findings.length !== 1 ? 's' : '';
  header.textContent = `${findings.length} finding${s} — ${parts.join(', ')}.`;
}

// ─── Findings rendering ───────────────────────────────────────────────────────

function renderFindings(): void {
  const list = findingsList();
  if (!list) return;

  const frag = document.createDocumentFragment();

  if (currentFindings.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'al-findings-empty';
    empty.setAttribute('role', 'status');
    empty.textContent = 'Clean. No governor traps, no hardcoded ids, no silent catches. Paste your own to break it.';
    list.innerHTML = '';
    list.appendChild(empty);
    return;
  }

  currentFindings.forEach((finding, idx) => {
    frag.appendChild(buildFindingRow(finding, idx));
  });

  list.innerHTML = '';
  list.appendChild(frag);

  // Auto-select first finding on initial load (not custom paste)
  if (!useCustomSource && currentFindings.length > 0) {
    selectFinding(0);
  }
}

function buildFindingRow(finding: Finding, idx: number): HTMLElement {
  const row = document.createElement('div');
  row.className = `al-finding-row al-finding--${finding.severity.toLowerCase()}`;
  row.dataset.idx = String(idx);
  row.setAttribute('role', 'listitem');
  row.setAttribute('tabindex', '0');
  row.setAttribute('aria-label',
    `${finding.severity}: ${finding.ruleId} at ${finding.locus}. ${finding.message}`);

  if (idx === selectedFindingIdx) row.classList.add('al-finding--selected');

  const isExpanded = expandedFixes.has(idx);
  const sevLower = finding.severity.toLowerCase();

  // Main row content
  const main = document.createElement('div');
  main.className = 'al-finding-main';

  const dot = document.createElement('span');
  dot.className = `al-sev-dot al-sev-dot--${sevLower}`;
  dot.setAttribute('aria-hidden', 'true');
  dot.title = finding.severity;

  const sev = document.createElement('span');
  sev.className = `al-finding-sev al-sev--${sevLower}`;
  sev.textContent = finding.severity;

  const rule = document.createElement('span');
  rule.className = 'al-finding-rule al-mono';
  rule.textContent = finding.ruleId;

  const locus = document.createElement('span');
  locus.className = 'al-finding-locus al-mono';
  locus.textContent = finding.locus;

  const msg = document.createElement('span');
  msg.className = 'al-finding-msg';
  msg.textContent = finding.message;

  const fixBtn = document.createElement('button');
  fixBtn.className = 'al-fix-toggle';
  fixBtn.setAttribute('aria-expanded', String(isExpanded));
  fixBtn.setAttribute('aria-label', `${isExpanded ? 'Collapse' : 'Expand'} fix for ${finding.ruleId}`);
  fixBtn.innerHTML = `<span class="al-fix-arrow">${isExpanded ? '▾' : '▸'}</span>&thinsp;fix`;

  main.appendChild(dot);
  main.appendChild(sev);
  main.appendChild(rule);
  main.appendChild(locus);
  main.appendChild(msg);
  main.appendChild(fixBtn);
  row.appendChild(main);

  // Fix panel
  if (isExpanded) {
    const fixEl = document.createElement('div');
    fixEl.className = 'al-finding-fix';
    fixEl.setAttribute('role', 'region');
    fixEl.setAttribute('aria-label', `Fix for ${finding.ruleId}`);
    fixEl.textContent = finding.fix;
    row.appendChild(fixEl);
  }

  // Events
  fixBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleFix(idx); });
  row.addEventListener('click', () => selectFinding(idx));
  row.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') selectFinding(idx);
    if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); toggleFix(idx); }
  });

  return row;
}

function toggleFix(idx: number): void {
  if (expandedFixes.has(idx)) {
    expandedFixes.delete(idx);
  } else {
    expandedFixes.add(idx);
  }
  // Rebuild rows without triggering auto-select
  rebuildFindingRows();
}

// ─── Code↔finding binding ─────────────────────────────────────────────────────

function selectFinding(idx: number): void {
  selectedFindingIdx = idx;
  const finding = currentFindings[idx];
  if (!finding) return;

  // Re-render findings with new selection (without auto-select triggering again)
  rebuildFindingRows();
  applyCodeHighlight(finding);
  scrollFindingIntoView(idx);
  if (finding.lineNumber) scrollCodeToLine(finding.lineNumber);
}

/** Rebuild finding rows in place without resetting selectedFindingIdx or auto-selecting */
function rebuildFindingRows(): void {
  const list = findingsList();
  if (!list) return;

  if (currentFindings.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'al-findings-empty';
    empty.setAttribute('role', 'status');
    empty.textContent = 'Clean. No governor traps, no hardcoded ids, no silent catches. Paste your own to break it.';
    list.innerHTML = '';
    list.appendChild(empty);
    return;
  }

  const frag = document.createDocumentFragment();
  currentFindings.forEach((finding, idx) => frag.appendChild(buildFindingRow(finding, idx)));
  list.innerHTML = '';
  list.appendChild(frag);
}

function applyCodeHighlight(finding: Finding): void {
  const container = codeLines();
  if (!container) return;

  const targetLine = finding.lineNumber;
  const range = finding.lineRange;

  container.querySelectorAll('.al-code-row').forEach(row => {
    const el = row as HTMLElement;
    const lineNum = parseInt(el.dataset.line || '0', 10);
    el.classList.remove('al-code-row--active', 'al-code-row--dimmed', 'al-code-row--range');

    if (lineNum === targetLine) {
      el.classList.add('al-code-row--active');
    } else if (range && lineNum >= range[0] && lineNum <= range[1]) {
      el.classList.add('al-code-row--range');
    } else if (targetLine || range) {
      el.classList.add('al-code-row--dimmed');
    }
  });
}

function clearCodeHighlight(): void {
  const container = codeLines();
  if (!container) return;
  container.querySelectorAll('.al-code-row').forEach(row => {
    (row as HTMLElement).classList.remove('al-code-row--active', 'al-code-row--dimmed', 'al-code-row--range');
  });
}

function scrollCodeToLine(lineNum: number): void {
  const container = codeLines();
  if (!container) return;
  const row = container.querySelector(`[data-line="${lineNum}"]`) as HTMLElement | null;
  if (!row) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  row.scrollIntoView({ block: 'center', behavior: reduced ? 'instant' : 'smooth' });
}

function scrollFindingIntoView(idx: number): void {
  const list = findingsList();
  if (!list) return;
  const row = list.querySelector(`[data-idx="${idx}"]`) as HTMLElement | null;
  if (!row) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  row.scrollIntoView({ block: 'nearest', behavior: reduced ? 'instant' : 'smooth' });
  row.focus({ preventScroll: true });
}

// ─── Keyboard navigation ───────────────────────────────────────────────────────

function wireKeyboard(): void {
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    // Don't intercept when user is typing in the textarea
    if (document.activeElement?.tagName === 'TEXTAREA') return;
    if (currentFindings.length === 0) return;

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        const next = selectedFindingIdx === null ? 0
          : Math.min(currentFindings.length - 1, selectedFindingIdx + 1);
        selectFinding(next);
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        const prev = selectedFindingIdx === null ? currentFindings.length - 1
          : Math.max(0, selectedFindingIdx - 1);
        selectFinding(prev);
        break;
      }
      case 'Escape': {
        selectedFindingIdx = null;
        expandedFixes.clear();
        clearCodeHighlight();
        rebuildFindingRows();
        break;
      }
      case 'Enter':
      case 'ArrowRight': {
        if (selectedFindingIdx !== null) {
          e.preventDefault();
          toggleFix(selectedFindingIdx);
        }
        break;
      }
    }
  });
}

// ─── Sort controls ────────────────────────────────────────────────────────────

function wireSort(): void {
  document.querySelectorAll('[data-al-sort]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-al-sort') as SortKey | null;
      if (!key) return;
      sortKey = key;
      resetSortButtons(key);
      currentFindings = sortFindings(currentFindings, key);
      selectedFindingIdx = null;
      expandedFixes.clear();
      clearCodeHighlight();
      rebuildFindingRows();
    });
  });
}

function resetSortButtons(active: SortKey = 'severity'): void {
  document.querySelectorAll('[data-al-sort]').forEach(btn => {
    const isActive = btn.getAttribute('data-al-sort') === active;
    btn.classList.toggle('al-sort-btn--active', isActive);
    btn.setAttribute('aria-pressed', String(isActive));
  });
}

// ─── Textarea (paste-your-own) ────────────────────────────────────────────────

function wireTextarea(): void {
  const ta = codeTextarea();
  if (!ta) return;

  ta.addEventListener('input', () => {
    useCustomSource = true;
    renderCodeLines(ta.value);
    lint(ta.value);
  });
}

function wireLoadSample(): void {
  const btn = $('al-load-sample');
  if (!btn || !samples) return;

  btn.addEventListener('click', () => {
    if (!samples) return;
    const sample = samples[activeTab];
    if (!sample) return;
    useCustomSource = false;
    const ta = codeTextarea();
    if (ta) ta.value = sample.source;
    renderCodeLines(sample.source);
    lint(sample.source);
  });
}

// ─── Start ────────────────────────────────────────────────────────────────────

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
