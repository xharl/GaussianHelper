/**
 * Issue #16 — pre-flight chemistry lint and heuristic cost estimate.
 *
 * Every lint rule is tested with a configuration that triggers it and one that
 * does not. The cost model is tested for its labelling (estimate, never a
 * benchmark), its one-significant-figure output, and monotonicity in atoms and
 * method rung.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { methods } from '../src/data/methods.js';
import { GJFPreview } from '../src/components/GJFPreview.js';
import {
  lintTheoryLevel,
  getTheoryRecommendations,
  estimateCalculationCost,
} from '../src/utils/validation.js';

const atom = (symbol) => ({ symbol, x: 0, y: 0, z: 0 });
const WATER = [atom('O'), atom('H'), atom('H')];
const carbonCluster = (count) => Array.from({ length: count }, () => atom('C'));

function config(overrides = {}) {
  const { route = {}, link0 = {}, ...rest } = overrides;
  return {
    link0,
    route: {
      method: 'B3LYP',
      basisSet: '6-31G(d)',
      jobType: 'SP',
      scf: '',
      dispersion: '',
      custom: '',
      ...route,
    },
    title: 'issue-16 test',
    charge: 0,
    multiplicity: 1,
    atoms: WATER,
    ...rest,
  };
}

const issuesFor = (cfg) => lintTheoryLevel(cfg).issues;
const issueIds = (cfg) => issuesFor(cfg).map((issue) => issue.id);
const findIssue = (cfg, id) => issuesFor(cfg).find((issue) => issue.id === id);

/**
 * Temporarily register a synthetic method definition, proving that a method
 * added to methods.js later automatically inherits the metadata-driven checks.
 */
function withSyntheticMethod(definition, assertion) {
  methods.push(definition);
  try {
    assertion();
  } finally {
    const index = methods.indexOf(definition);
    if (index >= 0) methods.splice(index, 1);
  }
}

afterEach(() => {
  for (let i = methods.length - 1; i >= 0; i -= 1) {
    if (methods[i].keyword.startsWith('ISSUE16SYNTH')) methods.splice(i, 1);
  }
});

describe('issue #16 — rule 1: DFT dispersion warning from metadata', () => {
  it('warns for a DFT functional without an explicit dispersion correction', () => {
    const issue = findIssue(config({ route: { method: 'M062X' } }), 'dispersion-missing');

    expect(issue).toBeDefined();
    expect(issue.severity).toBe('warning');
    expect(issue.message).toMatch(/dispersion correction/);
    expect(issue.message).toContain('EmpiricalDispersion=GD3BJ');
  });

  it('stays silent when a dispersion correction is already requested', () => {
    const cfg = config({ route: { method: 'M062X', dispersion: 'EmpiricalDispersion=GD3BJ' } });

    expect(issueIds(cfg)).not.toContain('dispersion-missing');
  });

  it('stays silent for methods whose keyword already includes dispersion', () => {
    for (const method of ['B2PLYPD3', 'wB97XD', 'APFD', 'B97D', 'DSDPBEP86']) {
      const cfg = config({ route: { method, basisSet: 'def2-TZVP' } });

      expect(issueIds(cfg)).not.toContain('dispersion-missing');
    }
  });

  it('gives a newly added DFT functional the same check automatically', () => {
    withSyntheticMethod({
      keyword: 'ISSUE16SYNTHGGA',
      name: 'Synthetic GGA',
      description: 'test-only functional',
      category: 'DFT',
      subcategory: 'GGA',
      popular: false,
      needsBasis: true,
      isDft: true,
      rung: 'GGA',
    }, () => {
      expect(issueIds(config({ route: { method: 'ISSUE16SYNTHGGA' } }))).toContain('dispersion-missing');
      expect(
        issueIds(config({ route: { method: 'ISSUE16SYNTHGGA', dispersion: 'EmpiricalDispersion=GD3BJ' } }))
      ).not.toContain('dispersion-missing');
    });
  });
});

describe('issue #16 — rule 2: hybrid DFT on a small Pople double-zeta basis', () => {
  it('warns for a hybrid functional on 6-31G(d)', () => {
    const issue = findIssue(config({ route: { method: 'B3LYP', basisSet: '6-31G(d)' } }), 'hybrid-small-basis');

    expect(issue).toBeDefined();
    expect(issue.severity).toBe('warning');
    expect(issue.message).toMatch(/triple-zeta/);
  });

  it('warns for a meta-hybrid on 6-31G(d,p)', () => {
    expect(issueIds(config({ route: { method: 'M062X', basisSet: '6-31G(d,p)' } })))
      .toContain('hybrid-small-basis');
  });

  it('stays silent on a triple-zeta basis', () => {
    expect(issueIds(config({ route: { method: 'B3LYP', basisSet: '6-311G(d,p)' } })))
      .not.toContain('hybrid-small-basis');
    expect(issueIds(config({ route: { method: 'B3LYP', basisSet: 'def2-TZVP' } })))
      .not.toContain('hybrid-small-basis');
  });

  it('stays silent for a pure GGA functional on the same basis', () => {
    expect(issueIds(config({ route: { method: 'BLYP', basisSet: '6-31G(d)' } })))
      .not.toContain('hybrid-small-basis');
  });

  it('applies to a newly added hybrid functional from its rung metadata', () => {
    withSyntheticMethod({
      keyword: 'ISSUE16SYNTHHYB',
      name: 'Synthetic hybrid',
      description: 'test-only functional',
      category: 'DFT',
      subcategory: 'Hybrid',
      popular: false,
      needsBasis: true,
      isDft: true,
      rung: 'hybrid',
    }, () => {
      expect(issueIds(config({ route: { method: 'ISSUE16SYNTHHYB', basisSet: '6-31G(d)' } })))
        .toContain('hybrid-small-basis');
    });
  });
});

describe('issue #16 — rule 3: Freq without explicit Temperature/Pressure', () => {
  it('adds an informational hint for a bare Freq job', () => {
    const issue = findIssue(config({ route: { jobType: 'Freq' } }), 'freq-thermochemistry-defaults');

    expect(issue).toBeDefined();
    expect(issue.severity).toBe('info');
    expect(issue.message).toMatch(/298\.15 K/);
  });

  it('stays silent when Temperature and Pressure are set', () => {
    const cfg = config({
      route: { jobType: 'Freq', custom: 'Temperature=298.15 Pressure=1.0' },
    });

    expect(issueIds(cfg)).not.toContain('freq-thermochemistry-defaults');
  });

  it('stays silent when Temperature alone is set', () => {
    const cfg = config({ route: { jobType: 'Opt Freq', custom: 'Temperature=310.0' } });

    expect(issueIds(cfg)).not.toContain('freq-thermochemistry-defaults');
  });

  it('does not fire for a single-point job', () => {
    expect(issueIds(config({ route: { jobType: 'SP' } }))).not.toContain('freq-thermochemistry-defaults');
  });
});

describe('issue #16 — rule 4: TS optimization without CalcFC / NoEigenTest', () => {
  it('warns for Opt=(TS) without a Hessian or eigenvector test', () => {
    const issue = findIssue(config({ route: { jobType: 'Opt=(TS)' } }), 'ts-opt-missing-hessian');

    expect(issue).toBeDefined();
    expect(issue.severity).toBe('warning');
    expect(issue.message).toMatch(/CalcFC/);
  });

  it('stays silent with Opt=(TS,CalcFC)', () => {
    expect(issueIds(config({ route: { jobType: 'Opt=(TS,CalcFC)' } })))
      .not.toContain('ts-opt-missing-hessian');
  });

  it('stays silent with NoEigenTest', () => {
    expect(issueIds(config({ route: { jobType: 'Opt=(TS,NoEigenTest)' } })))
      .not.toContain('ts-opt-missing-hessian');
  });

  it('does not fire for a minimum optimization', () => {
    expect(issueIds(config({ route: { jobType: 'Opt' } }))).not.toContain('ts-opt-missing-hessian');
  });
});

describe('issue #16 — rule 5: TD with a non-range-separated functional', () => {
  it('adds an informational hint for TD-DFT with a global hybrid', () => {
    const issue = findIssue(
      config({ route: { method: 'B3LYP', basisSet: '6-311+G(d,p)', jobType: 'TD=(NStates=6)' } }),
      'td-non-range-separated'
    );

    expect(issue).toBeDefined();
    expect(issue.severity).toBe('info');
    expect(issue.message).toMatch(/range-separated/);
  });

  it('stays silent for range-separated functionals', () => {
    for (const method of ['CAM-B3LYP', 'wB97XD', 'M11']) {
      const cfg = config({
        route: { method, basisSet: '6-311+G(d,p)', jobType: 'TD=(NStates=6)' },
      });

      expect(issueIds(cfg)).not.toContain('td-non-range-separated');
    }
  });

  it('stays silent for Hartree-Fock, which is not a DFT functional', () => {
    const cfg = config({
      route: { method: 'HF', basisSet: '6-311+G(d,p)', jobType: 'TD=(NStates=6)' },
    });

    expect(issueIds(cfg)).not.toContain('td-non-range-separated');
  });
});

describe('issue #16 — rule 6: transition metal with default SCF settings', () => {
  const ironConfig = (route = {}) => config({
    route: { method: 'B3LYP', basisSet: 'def2-TZVP', jobType: 'Opt', ...route },
    atoms: [atom('Fe'), atom('C'), atom('O')],
    multiplicity: 3,
  });

  it('suggests an explicit SCF keyword for a metal complex', () => {
    const issue = findIssue(ironConfig(), 'transition-metal-scf');

    expect(issue).toBeDefined();
    expect(issue.severity).toBe('info');
    expect(issue.message).toContain('SCF=(XQC)');
  });

  it('stays silent when the SCF dropdown is set', () => {
    expect(issueIds(ironConfig({ scf: 'SCF=(XQC)' }))).not.toContain('transition-metal-scf');
  });

  it('stays silent when SCF is supplied through custom keywords', () => {
    expect(issueIds(ironConfig({ custom: 'SCF=XQC' }))).not.toContain('transition-metal-scf');
  });

  it('does not fire for a molecule without transition metals', () => {
    expect(issueIds(config({ route: { jobType: 'Opt' } }))).not.toContain('transition-metal-scf');
  });
});

describe('issue #16 — rule 7: heavy element on a basis without ECP coverage', () => {
  it('warns for iodine on 6-31G(d)', () => {
    const issue = findIssue(
      config({ route: { basisSet: '6-31G(d)' }, atoms: [atom('I'), atom('H')] }),
      'heavy-element-ecp'
    );

    expect(issue).toBeDefined();
    expect(issue.severity).toBe('warning');
    expect(issue.message).toContain('Heavy elements');
    expect(issue.message).toContain('ECP');
    expect(issue.message).toContain('I');
  });

  it('stays silent for an ECP basis set', () => {
    const cfg = config({ route: { basisSet: 'LanL2DZ' }, atoms: [atom('I'), atom('H')] });

    expect(issueIds(cfg)).not.toContain('heavy-element-ecp');
  });

  it('stays silent for a def2 basis with ECP coverage', () => {
    const cfg = config({ route: { basisSet: 'def2TZVP' }, atoms: [atom('I'), atom('H')] });

    expect(issueIds(cfg)).not.toContain('heavy-element-ecp');
  });
});

describe('issue #16 — rule 8: basis supplied to a method that does not use one', () => {
  it('warns for a semi-empirical method with a basis set', () => {
    const issue = findIssue(config({ route: { method: 'PM6', basisSet: '6-31G(d)' } }), 'unsupported-method-basis');

    expect(issue).toBeDefined();
    expect(issue.severity).toBe('warning');
    expect(issue.message).toContain('does not use an external basis set');
  });

  it('warns for a composite method with an external basis set', () => {
    expect(issueIds(config({ route: { method: 'CBS-QB3', basisSet: 'cc-pVTZ' } })))
      .toContain('unsupported-method-basis');
  });

  it('stays silent when the method is given no basis set', () => {
    expect(issueIds(config({ route: { method: 'PM6', basisSet: '' } })))
      .not.toContain('unsupported-method-basis');
  });

  it('does not fire for a method that does use a basis set', () => {
    expect(issueIds(config({ route: { method: 'B3LYP', basisSet: '6-31G(d)' } })))
      .not.toContain('unsupported-method-basis');
  });
});

describe('issue #16 — existing recommendation strings stay available', () => {
  it('returns the same messages through getTheoryRecommendations()', () => {
    const cfg = config({ route: { method: 'M062X', basisSet: '6-31G(d)', jobType: 'Opt Freq' } });

    expect(getTheoryRecommendations(cfg)).toEqual(
      lintTheoryLevel(cfg).issues.map((issue) => issue.message)
    );
    expect(getTheoryRecommendations(cfg).every((message) => typeof message === 'string')).toBe(true);
  });
});

describe('issue #16 — heuristic cost estimate', () => {
  const estimateFor = (overrides = {}) => estimateCalculationCost(config({
    route: { method: 'B3LYP', basisSet: 'def2-TZVP', jobType: 'SP', ...overrides.route },
    atoms: overrides.atoms || carbonCluster(10),
    link0: overrides.link0 || {},
  }));

  it('is explicitly labelled as an estimate, never a benchmark', () => {
    const estimate = estimateFor();

    expect(estimate).not.toBeNull();
    expect(estimate.kind).toBe('heuristic-estimate');
    expect(estimate.disclaimer).toMatch(/estimate/i);
    expect(estimate.disclaimer).toMatch(/not a benchmark/i);
    expect(estimate.assumptions.length).toBeGreaterThanOrEqual(5);
    expect(estimate.assumptions.join(' ')).toMatch(/Memory\/disk/);
    expect(estimate.assumptions.join(' ')).toMatch(/not measured/i);
  });

  it('reports core-hours and wall-clock to one significant figure only', () => {
    const estimate = estimateFor({ link0: { nproc: '8' } });
    const values = [
      estimate.coreHours.low,
      estimate.coreHours.high,
      estimate.wallHours.low,
      estimate.wallHours.high,
    ];

    for (const value of values) {
      expect(value).toBeGreaterThan(0);
      expect(value).toBe(Number(value.toPrecision(1)));
    }
    expect(estimate.wallHours.low).toBeLessThan(estimate.coreHours.low);
  });

  it('increases monotonically with the number of atoms', () => {
    const small = estimateFor({ atoms: carbonCluster(5) });
    const large = estimateFor({ atoms: carbonCluster(25) });

    expect(large.coreHours.low).toBeGreaterThan(small.coreHours.low);
    expect(large.coreHours.high).toBeGreaterThan(small.coreHours.high);
  });

  it('increases monotonically with method rung', () => {
    const ladder = ['UFF', 'PM6', 'HF', 'BLYP', 'TPSSTPSS', 'B3LYP', 'M062X', 'B2PLYP', 'MP2', 'CCSD', 'CCSD(T)'];
    const estimates = ladder.map((method) => estimateCalculationCost(config({
      route: {
        method,
        basisSet: method === 'UFF' || method === 'PM6' ? '' : '6-31G(d)',
        jobType: 'SP',
      },
      atoms: carbonCluster(10),
    })));

    estimates.forEach((estimate, index) => {
      expect(estimate, `${ladder[index]} should have a cost estimate`).not.toBeNull();
    });

    for (let i = 1; i < estimates.length; i += 1) {
      expect(
        estimates[i].coreHours.low,
        `${ladder[i]} should cost more than ${ladder[i - 1]}`
      ).toBeGreaterThan(estimates[i - 1].coreHours.low);
      expect(estimates[i].coreHours.high).toBeGreaterThan(estimates[i - 1].coreHours.high);
    }
  });

  it('applies a larger multiplier for optimization than for a single point', () => {
    const singlePoint = estimateFor({ route: { jobType: 'SP' } });
    const optimization = estimateFor({ route: { jobType: 'Opt' } });
    const optFreq = estimateFor({ route: { jobType: 'Opt Freq' } });

    expect(optimization.coreHours.low).toBeGreaterThan(singlePoint.coreHours.low);
    expect(optFreq.coreHours.low).toBeGreaterThan(optimization.coreHours.low);
  });

  it('keeps core-hours independent of core count while wall-clock falls', () => {
    const twoCores = estimateFor({ link0: { nproc: '2' } });
    const eightCores = estimateFor({ link0: { nproc: '8' } });

    expect(eightCores.coreHours).toEqual(twoCores.coreHours);
    expect(eightCores.wallHours.low).toBeLessThan(twoCores.wallHours.low);
    expect(eightCores.wallHours.high).toBeLessThan(twoCores.wallHours.high);
    expect(eightCores.assumptions.join(' ')).toMatch(/8 cores/);
  });

  it('scales up with basis-set size', () => {
    const doubleZeta = estimateFor({ route: { basisSet: '6-31G(d)' } });
    const tripleZeta = estimateFor({ route: { basisSet: 'def2-TZVP' } });

    expect(tripleZeta.coreHours.low).toBeGreaterThan(doubleZeta.coreHours.low);
  });

  it('returns null rather than guessing when metadata or atoms are missing', () => {
    expect(estimateCalculationCost(config({ route: { method: 'NOT-A-REAL-METHOD' } }))).toBeNull();
    expect(estimateCalculationCost(config({ atoms: [] }))).toBeNull();
    expect(estimateCalculationCost(null)).toBeNull();
  });
});

describe('issue #16 — recommendations UI', () => {
  const view = Object.create(GJFPreview.prototype);

  it('renders the cost panel with the estimate label and assumptions', () => {
    const html = view.renderCostEstimate({
      coreHours: { low: 2, high: 8 },
      wallHours: { low: 1, high: 4 },
      cores: 2,
      assumptions: ['Reference point: assumed order of magnitude, not measured.'],
      disclaimer: 'Estimate only — not a benchmark. Order-of-magnitude heuristic.',
    });

    expect(html).toContain('Cost Estimate (heuristic)');
    expect(html).toMatch(/not a benchmark/i);
    expect(html).toContain('one significant figure');
    expect(html).toContain('Assumptions behind the estimate');
    expect(html).toContain('2–8 core-hours');
  });

  it('renders lint and cost panels through renderCode()', () => {
    const warnings = { innerHTML: '', classList: { add() {}, remove() {} } };
    const code = { innerHTML: '' };
    const view = Object.create(GJFPreview.prototype);
    view.container = {
      querySelector: (selector) => (selector === '#gjf-warnings' ? warnings : selector === '#gjf-code' ? code : null),
    };

    view.renderCode(
      '#N B3LYP/6-31G(d) SP\n\ntitle\n\n0 1\nO 0.0 0.0 0.0\n',
      { valid: true, errors: [] },
      {
        issues: [
          { severity: 'warning', message: 'a warning message' },
          { severity: 'info', message: 'an informational note' },
        ],
        estimate: {
          coreHours: { low: 1, high: 2 },
          wallHours: null,
          cores: null,
          assumptions: ['assumption text'],
          disclaimer: 'Estimate only — not a benchmark.',
        },
      }
    );

    expect(warnings.innerHTML).toContain('Pre-flight Chemistry Lint');
    expect(warnings.innerHTML).toContain('a warning message');
    expect(warnings.innerHTML).toContain('an informational note');
    expect(warnings.innerHTML).toContain('Cost Estimate (heuristic)');
    expect(warnings.innerHTML).toContain('assumption text');
    expect(code.innerHTML).toContain('code-line');
  });

  it('escapes lint messages and cost assumptions', () => {
    const lintHtml = view.renderLintPanel([
      { severity: 'warning', message: '<img src=x onerror=alert(1)>' },
      { severity: 'info', message: 'safe note' },
    ]);
    const costHtml = view.renderCostEstimate({
      coreHours: { low: 1, high: 2 },
      wallHours: null,
      cores: null,
      assumptions: ['<script>alert(1)</script>'],
      disclaimer: '<b>not a benchmark</b>',
    });

    expect(lintHtml).not.toContain('<img');
    expect(lintHtml).toContain('&lt;img');
    expect(lintHtml).toContain('Warning:');
    expect(lintHtml).toContain('Info:');
    expect(costHtml).not.toContain('<script>');
    expect(costHtml).toContain('&lt;script&gt;');
    expect(costHtml).not.toContain('<b>not a benchmark</b>');
  });
});
