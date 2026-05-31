export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type TabId = 'apex' | 'flow' | 'n8n';
export type SortKey = 'severity' | 'rule' | 'line';

export interface Finding {
  ruleId: string;          // 'AP-001'
  severity: Severity;
  locus: string;           // 'Line 4' | 'Node Update_Lead_Owner'
  message: string;         // one sentence
  fix: string;             // one-paragraph fix
  lineNumber?: number;     // anchor for scroll + highlight
  lineRange?: [number, number]; // span to dim-around (e.g. the loop, lines 2..11)
}

export interface Sample {
  id: TabId;
  label: string;
  filename: string;
  description: string;
  source: string;
  findings: Finding[];
}

export interface SamplesData {
  apex: Sample;
  flow: Sample;
  n8n: Sample;
}

export const SEVERITY_ORDER: Record<Severity, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};
