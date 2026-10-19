import { KIND_INFO, PROTOCOL_INFO } from '../model/catalog';
import type { Design } from '../model/types';
import { formatMoney } from '../model/util';
import type { CompileResult } from './types';

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function partsCsv(design: Design, compiled: CompileResult): string {
  const domainName = (id: string) => design.domains.find((d) => d.id === id)?.name ?? id;
  const rows = [
    ['Component', 'Kind', 'Technology', 'Sub-build', 'Owner', 'Criticality', 'Lifecycle', 'Replicas', 'Provides', 'Consumers', 'Dependencies', 'Est. monthly cost (USD)'],
    ...design.components.map((c) => [
      c.name,
      KIND_INFO[c.kind].label,
      c.tech,
      domainName(c.domainId),
      c.owner,
      c.criticality,
      c.lifecycle,
      c.replicas,
      KIND_INFO[c.kind].provides.map((p) => PROTOCOL_INFO[p].label).join(' '),
      (compiled.index.incoming.get(c.id) ?? []).length,
      (compiled.index.outgoing.get(c.id) ?? []).length,
      c.replicas * KIND_INFO[c.kind].costPerReplica,
    ]),
  ];
  return rows.map((r) => r.map(csvCell).join(',')).join('\n');
}

export function manualMarkdown(design: Design, compiled: CompileResult): string {
  const name = (id: string) => compiled.index.byId.get(id)?.name ?? id;
  const out: string[] = [];
  out.push(`# ${design.name} — build manual`, '');
  if (design.summary) out.push(design.summary, '');
  const s = compiled.stats;
  out.push(
    `**${s.components} components** (${s.instances} instances) · **${s.subBuilds} sub-builds** · **${s.steps} steps** · **${s.joints} joints** (${s.weakJoints} weak) · est. ${formatMoney(s.monthlyCost)}/month`,
    '',
  );

  out.push('## Parts inventory', '', '| Part | Technology | Components | Instances | Est. / month |', '|---|---|---:|---:|---:|');
  for (const line of compiled.parts) {
    out.push(`| ${KIND_INFO[line.kind].label} | ${line.tech} | ${line.componentIds.length} | ${line.instances} | ${formatMoney(line.monthlyCost)} |`);
  }
  out.push('');

  for (const sb of compiled.subBuilds) {
    out.push(`## Sub-build ${sb.index + 1}: ${sb.name}`, '');
    if (sb.description) out.push(sb.description, '');
    for (let i = sb.firstStep; i <= sb.lastStep; i++) {
      const step = compiled.steps[i];
      out.push(`### Step ${step.number} — ${step.title}`, '');
      if (step.adds.length) out.push(`Parts: ${step.adds.map(name).join(', ')}`, '');
      step.instructions.forEach((line, n) => out.push(`${n + 1}. ${line}`));
      if (step.checks.length) {
        out.push('');
        step.checks.forEach((line) => out.push(`- [ ] ${line.replace(/^⚠\s*/, '⚠️ ')}`));
      }
      out.push('');
    }
  }

  const problems = compiled.issues.filter((i) => i.severity !== 'info');
  out.push('## Engine checks', '');
  if (!problems.length) out.push('Every joint grips. No errors or warnings.', '');
  for (const issue of problems) out.push(`- **${issue.severity.toUpperCase()} — ${issue.title}:** ${issue.message}`);
  out.push('', '## Sign-off', '', '| Role | Name | Date |', '|---|---|---|');
  for (const role of ['Architecture review board', 'Security', 'Operations / SRE', 'Product owner']) out.push(`| ${role} | | |`);
  return out.join('\n');
}

export function mermaidDiagram(design: Design): string {
  const safe = (id: string) => id.replace(/[^a-zA-Z0-9_]/g, '_');
  const out = ['flowchart TB'];
  for (const d of design.domains) {
    const members = design.components.filter((c) => c.domainId === d.id);
    if (!members.length) continue;
    out.push(`  subgraph ${safe(d.id)}["${d.name}"]`);
    for (const c of members) out.push(`    ${safe(c.id)}["${c.name}<br/><small>${c.tech}</small>"]`);
    out.push('  end');
  }
  for (const conn of design.connections) {
    out.push(`  ${safe(conn.from)} -->|${PROTOCOL_INFO[conn.protocol].label}| ${safe(conn.to)}`);
  }
  return out.join('\n');
}
