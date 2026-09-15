// app/ui/console/riskParser.js — AC3/console: "risk-register sign-off list
// (reads docs/risk-dossier.md families as entries with sign/reject state)."
// A small, pure, dependency-free markdown-light parser (DOM-free, so it is
// unit-testable in Node) that pulls the risk families out of the shipped
// dossier text without needing a build step or a markdown library.

/**
 * Parse the "## 1. Attack families" table (F-1..F-7, one per row) into
 * structured entries.
 */
export function parseFamilyTable(mdText) {
  const rows = [];
  const re = /^\|\s*(F-\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/gm;
  let m;
  while ((m = re.exec(mdText))) {
    const [, id, family, severity, feasibility, summary] = m;
    rows.push({ id, family: family.trim(), severity: stripMd(severity), feasibility: stripMd(feasibility), summary: stripMd(summary) });
  }
  return rows;
}

/**
 * Parse the "### F-n · Title ... · severity X · feasibility Y" mechanics
 * finding headers (F-8..F-11 in the shipped dossier, but written generally).
 */
export function parseFindingHeaders(mdText) {
  const rows = [];
  const re = /^###\s+(F-\d+)\s*(?:[\u00b7-]\s*)?(.+)$/gm;
  let m;
  while ((m = re.exec(mdText))) {
    const [, id, rest] = m;
    const severityMatch = rest.match(/severity[:\s]*([a-z-]+)/i);
    rows.push({ id, family: rest.split('\u00b7')[0].replace(/—.*$/, '').trim(), severity: severityMatch ? severityMatch[1] : null, feasibility: null, summary: rest.trim() });
  }
  return rows;
}

function stripMd(s) {
  return s.replace(/\*\*/g, '').trim();
}

/**
 * The combined, deduplicated list of risk families for the console's
 * sign-off panel: table rows first (F-1..F-7, richest data), then any
 * header-only findings (F-8+) not already present.
 */
export function parseRiskFamilies(mdText) {
  const tableRows = parseFamilyTable(mdText);
  const headerRows = parseFindingHeaders(mdText);
  const seen = new Set(tableRows.map((r) => r.id));
  const combined = [...tableRows];
  for (const r of headerRows) {
    if (!seen.has(r.id)) { combined.push(r); seen.add(r.id); }
  }
  combined.sort((a, b) => Number(a.id.slice(2)) - Number(b.id.slice(2)));
  return combined;
}
