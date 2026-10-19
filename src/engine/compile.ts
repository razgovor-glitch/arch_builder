import { CATEGORY_INFO, KIND_INFO } from '../model/catalog';
import type { Design } from '../model/types';
import { planBuild } from './plan';
import type { CompileResult, Issue, ManualPage, PartLine } from './types';
import { buildIndex, checkJoints, checkStructure } from './validate';

export const PARTS_PER_INVENTORY_PAGE = 12;

export function billOfMaterials(design: Design): PartLine[] {
  const lines = new Map<string, PartLine>();
  for (const c of design.components) {
    const key = `${c.kind}::${c.tech}`;
    const info = KIND_INFO[c.kind];
    let line = lines.get(key);
    if (!line) {
      line = {
        key,
        kind: c.kind,
        category: info.category,
        tech: c.tech,
        componentIds: [],
        instances: 0,
        domainIds: [],
        monthlyCost: 0,
      };
      lines.set(key, line);
    }
    line.componentIds.push(c.id);
    line.instances += c.replicas;
    line.monthlyCost += c.replicas * info.costPerReplica;
    if (!line.domainIds.includes(c.domainId)) line.domainIds.push(c.domainId);
  }
  return [...lines.values()].sort(
    (a, b) =>
      CATEGORY_INFO[a.category].order - CATEGORY_INFO[b.category].order ||
      KIND_INFO[a.kind].label.localeCompare(KIND_INFO[b.kind].label) ||
      a.tech.localeCompare(b.tech),
  );
}

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 } as const;

/**
 * The engine: turns a design into parts, checks every joint, orders the build
 * and lays out the manual. Pure and synchronous so it can run on every edit.
 */
export function compile(design: Design): CompileResult {
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now();

  const index = buildIndex(design);
  const jointCheck = checkJoints(design, index);
  const issues: Issue[] = [...jointCheck.issues, ...checkStructure(design, index, jointCheck.joints)]
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    .map((issue, n) => ({ ...issue, id: `${issue.rule}-${n}` }));

  const issuesByComponent = new Map<string, Issue[]>();
  for (const issue of issues) {
    for (const id of issue.componentIds) {
      const list = issuesByComponent.get(id) ?? [];
      list.push(issue);
      issuesByComponent.set(id, list);
    }
  }

  const parts = billOfMaterials(design);
  const { subBuilds, steps, installedAt } = planBuild(design, index, jointCheck.joints);

  const pages: ManualPage[] = [{ kind: 'cover' }];
  const inventoryPages = Math.max(1, Math.ceil(parts.length / PARTS_PER_INVENTORY_PAGE));
  for (let p = 0; p < inventoryPages; p++) {
    pages.push({
      kind: 'inventory',
      lines: parts.slice(p * PARTS_PER_INVENTORY_PAGE, (p + 1) * PARTS_PER_INVENTORY_PAGE),
      part: p + 1,
      parts: inventoryPages,
    });
  }
  for (const sb of subBuilds) {
    pages.push({ kind: 'subbuild', subBuildIndex: sb.index });
    for (let s = sb.firstStep; s <= sb.lastStep; s++) pages.push({ kind: 'step', stepIndex: s });
  }
  pages.push({ kind: 'final' });

  let weakJoints = 0;
  for (const j of jointCheck.joints.values()) if (j.status === 'weak') weakJoints++;

  const ended = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    index,
    joints: jointCheck.joints,
    issues,
    issuesByComponent,
    parts,
    subBuilds,
    steps,
    installedAt,
    pages,
    stats: {
      components: design.components.length,
      instances: design.components.reduce((s, c) => s + c.replicas, 0),
      joints: design.connections.length,
      weakJoints,
      steps: steps.length,
      pages: pages.length,
      subBuilds: subBuilds.length,
      errors: issues.filter((i) => i.severity === 'error').length,
      warnings: issues.filter((i) => i.severity === 'warning').length,
      infos: issues.filter((i) => i.severity === 'info').length,
      monthlyCost: parts.reduce((s, p) => s + p.monthlyCost, 0),
    },
    ms: ended - started,
  };
}

/** Index of the manual page that shows a given step. */
export function pageOfStep(result: CompileResult, stepIndex: number): number {
  return result.pages.findIndex((p) => p.kind === 'step' && p.stepIndex === stepIndex);
}
