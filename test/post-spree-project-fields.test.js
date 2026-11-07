import { describe, expect, it } from 'vitest';
import {
  createWorkflowProject,
  createWorkflowTask,
  parseWorkflowProjectJson,
  serializeWorkflowProject,
  validateWorkflowProject,
} from '../src/utils/workflowModel.js';

/**
 * Cross-feature integration guard: the Workbench snapshots a config, saves it to
 * `.ghproject.json` and reloads it. Structured route fields added by the
 * GenECP/#12 work, the validation toggles from #18 and the fragment spec from
 * #13 must survive that round trip. Dropping them silently changes the
 * calculation the reloaded task describes, which is worse than refusing to save.
 */

function projectWith(config, options = {}) {
  const project = createWorkflowProject('field preservation');
  project.tasks.push(createWorkflowTask(config, { title: 'Task 1', ...options }));
  return project;
}

function roundTrip(project) {
  return parseWorkflowProjectJson(serializeWorkflowProject(project));
}

const GENECP_CONFIG = {
  link0: { memory: '4GB', nproc: 4, checkpoint: 'mixed.chk' },
  route: {
    verbosity: '#N',
    method: 'B3LYP',
    basisMode: 'GenECP',
    elementBasis: [
      { elements: ['C'], basis: '6-31G(d)' },
      { elements: ['Pd'], basis: 'LanL2DZ' },
    ],
    ecp: [{ elements: ['Pd'], ecp: 'LanL2DZ' }],
    jobType: 'SP',
    allowUnknownRouteTokens: true,
    strictRouteTokens: false,
  },
  title: 'Pd complex',
  charge: 0,
  multiplicity: 1,
  atoms: [
    { symbol: 'C', x: 0, y: 0, z: 0 },
    { symbol: 'Pd', x: 0, y: 0, z: 1.9 },
  ],
};

const FRAGMENT_CONFIG = {
  link0: { memory: '2GB', nproc: 2, checkpoint: 'dimer.chk' },
  route: { verbosity: '#N', method: 'B3LYP', basisSet: '6-31G(d)', jobType: 'SP' },
  title: 'H2 dimer fragments',
  charge: 0,
  multiplicity: 1,
  atoms: [
    { symbol: 'H', x: 0, y: 0, z: 0 },
    { symbol: 'H', x: 0, y: 0, z: 3.0 },
  ],
  fragments: [
    { charge: 0, multiplicity: 2, atomRange: [0, 0] },
    { charge: 0, multiplicity: 2, atomRange: [1, 1] },
  ],
};

describe('structured project fields survive save/load', () => {
  it('keeps GenECP element basis, ECP assignments and validation toggles', () => {
    const project = projectWith(GENECP_CONFIG);
    expect(validateWorkflowProject(project).valid).toBe(true);

    const loaded = roundTrip(project);
    const route = loaded.tasks[0].config.route;

    expect(validateWorkflowProject(loaded).valid).toBe(true);
    expect(route.basisMode).toBe('GenECP');
    expect(route.elementBasis).toEqual(GENECP_CONFIG.route.elementBasis);
    expect(route.ecp).toEqual(GENECP_CONFIG.route.ecp);
    expect(route.allowUnknownRouteTokens).toBe(true);
    expect(route.strictRouteTokens).toBe(false);
    // The route string fields are still strings; no structured field leaked
    // into the single-line route serializer.
    expect(typeof route.method).toBe('string');
    expect(typeof route.jobType).toBe('string');
  });

  it('keeps the fragment specification and re-validates it on load', () => {
    const project = projectWith(FRAGMENT_CONFIG);
    expect(validateWorkflowProject(project).valid).toBe(true);

    const loaded = roundTrip(project);
    expect(loaded.tasks[0].config.fragments).toEqual(FRAGMENT_CONFIG.fragments);
    expect(validateWorkflowProject(loaded).valid).toBe(true);
  });

  it('keeps the saddle threshold and the final-energy gate', () => {
    const project = projectWith({
      ...FRAGMENT_CONFIG,
      route: { ...FRAGMENT_CONFIG.route, method: 'CCSD(T)' },
    }, {
      gates: { requireFinalEnergy: true, minImaginaryMagnitude: 75 },
    });

    const loaded = roundTrip(project);
    expect(loaded.tasks[0].gates.minImaginaryMagnitude).toBe(75);
    expect(loaded.tasks[0].gates.requireFinalEnergy).toBe(true);
  });
});

describe('malformed structured fields are rejected, not repaired', () => {
  function mutate(mutator) {
    const project = projectWith(GENECP_CONFIG);
    mutator(project.tasks[0].config.route);
    return validateWorkflowProject(project);
  }

  it('rejects a non-array elementBasis', () => {
    const result = mutate((route) => { route.elementBasis = 'C 6-31G(d)'; });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/elementBasis/);
  });

  it('rejects an elementBasis entry with a non-symbol element list', () => {
    const result = mutate((route) => { route.elementBasis = [{ elements: 'C', basis: '6-31G(d)' }]; });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/elementBasis/);
  });

  it('rejects a route-unsafe ECP keyword', () => {
    const result = mutate((route) => { route.ecp = [{ elements: ['Pd'], ecp: 'LANL2DZ/READ' }]; });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/ecp/);
  });

  it('rejects a fragment list with a gap', () => {
    const project = projectWith({
      ...FRAGMENT_CONFIG,
      atoms: [
        { symbol: 'H', x: 0, y: 0, z: 0 },
        { symbol: 'H', x: 0, y: 0, z: 1.5 },
        { symbol: 'H', x: 0, y: 0, z: 3.0 },
      ],
      fragments: [
        { charge: 0, multiplicity: 2, atomRange: [0, 0] },
        { charge: 0, multiplicity: 2, atomRange: [2, 2] },
      ],
    });
    const result = validateWorkflowProject(project);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/Fragment|atom/i);
  });
});
