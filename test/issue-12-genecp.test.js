import { describe, it, expect } from 'vitest';
import { basisSets } from '../src/data/basisSets.js';
import { buildRouteSection, generateGJF, buildGenECPBlocks } from '../src/generators/gjfGenerator.js';
import {
  COVERAGE,
  basisCoversElement,
  basisIncludesEcp,
  findUncoveredElements,
  isHeavyElement,
} from '../src/utils/basisCoverage.js';

/**
 * Issue #12 — heavy-element basis sets / ECP handling.
 *
 * The verified premise (from Gaussian 16's own documentation):
 *   - SDD, LanL2DZ, CEP-31G, ... are self-contained basis keywords that already
 *     include the matching ECP. `#P B3LYP/SDD` on Pd is complete; adding
 *     `Pseudo=Read` or an ECP block is wrong.
 *     https://gaussian.com/basissets/ : SDD = D95 through Ar + Stuttgart/Dresden
 *     ECPs thereafter; LanL2DZ = D95V first row + Los Alamos ECP on Na–La, Hf–Bi.
 *   - The real gaps are (a) no element-coverage knowledge (`6-31G(d)` on Pd is
 *     not defined but was emitted silently) and (b) no mixed light/heavy basis.
 *     Gaussian's documented mechanism for (b) is GenECP (== Gen Pseudo=Read)
 *     with basis blocks and an ECP block that may reference internally stored
 *     basis keywords instead of raw parameters.
 *     https://gaussian.com/pseudo/ , https://gaussian.com/gen/
 */

const WATER_ATOMS = [
  { symbol: 'O', x: 0.0, y: 0.0, z: 0.1197 },
  { symbol: 'H', x: 0.0, y: 0.7615, z: -0.4789 },
  { symbol: 'H', x: 0.0, y: -0.7615, z: -0.4789 },
];

/** Exact output of generateGJF() before issue #12 — must stay byte-identical. */
const DEFAULT_GJF = [
  '%Mem=4GB',
  '%NProcShared=4',
  '%Chk=water.chk',
  '#N B3LYP/6-31G(d) Opt Freq',
  '',
  'Water optimization',
  '',
  '0 1',
  ' O       0.000000    0.000000    0.119700',
  ' H       0.000000    0.761500   -0.478900',
  ' H       0.000000   -0.761500   -0.478900',
  '',
].join('\n');

const PALLADIUM_ATOMS = [{ symbol: 'Pd', x: 0.0, y: 0.0, z: 0.0 }];

const MIXED_ATOMS = [
  { symbol: 'C', x: 0.0, y: 0.0, z: 0.0 },
  { symbol: 'O', x: 0.0, y: 0.0, z: 1.13 },
  { symbol: 'Pd', x: 0.0, y: 0.0, z: 2.0 },
];

function mixedConfig(overrides = {}) {
  return {
    route: {
      verbosity: '#N',
      method: 'B3LYP',
      jobType: 'Opt',
      basisMode: 'GenECP',
      elementBasis: [
        { elements: ['C', 'O'], basis: '6-31G(d)' },
        { elements: ['Pd'], basis: 'LanL2DZ' },
      ],
      ecp: [{ elements: ['Pd'], ecp: 'LanL2DZ' }],
      ...(overrides.route || {}),
    },
    title: 'PdCO mixed basis',
    charge: 0,
    multiplicity: 1,
    atoms: MIXED_ATOMS,
    ...overrides.withoutRoute,
  };
}

describe('Issue #12 — ECP-bearing basis keywords are self-contained', () => {
  it('emits `B3LYP/SDD` for Pd and never adds Pseudo=Read or an ECP block', () => {
    const gjf = generateGJF({
      route: { verbosity: '#P', method: 'B3LYP', basisSet: 'SDD', jobType: 'Opt' },
      title: 'Pd with SDD',
      charge: 0,
      multiplicity: 1,
      atoms: PALLADIUM_ATOMS,
    });

    expect(gjf).toContain('#P B3LYP/SDD Opt');
    expect(gjf).not.toMatch(/Pseudo\s*=\s*Read/i);
    expect(gjf).not.toContain('GenECP');
    expect(gjf).not.toContain('****');
    // Geometry is the last thing in the file: no appended basis/ECP section.
    expect(gjf.trimEnd().split('\n').pop()).toMatch(/^\s*Pd\s/);
  });

  it('builds the plain SDD route with no extra keywords', () => {
    expect(
      buildRouteSection({ verbosity: '#P', method: 'B3LYP', basisSet: 'SDD', jobType: 'Opt' })
    ).toBe('#P B3LYP/SDD Opt');
  });

  it('marks the documented ECP bases as carrying their own ECP', () => {
    const expected = {
      LanL2DZ: 'LanL2DZ',
      LanL2MB: 'LanL2MB',
      SDD: 'SDD',
      SDDAll: 'SDD',
      'CEP-31G': 'CEP-31G',
      'CEP-121G': 'CEP-121G',
    };

    for (const [keyword, ecpName] of Object.entries(expected)) {
      const entry = basisSets.find((b) => b.keyword === keyword);
      expect(entry, `missing ${keyword}`).toBeDefined();
      expect(entry.ecpIncluded, keyword).toBe(true);
      expect(entry.ecpName, keyword).toBe(ecpName);
      expect(basisIncludesEcp(keyword), keyword).toBe(true);
    }

    // Non-ECP families must not claim an ECP.
    for (const keyword of ['6-31G(d)', '6-311+G(d,p)', 'cc-pVTZ', 'aug-cc-pVDZ']) {
      expect(basisIncludesEcp(keyword), keyword).toBe(false);
    }
  });
});

describe('Issue #12 — documented element coverage', () => {
  it('reports 6-31G(d) as not defined for Pd and SDD as defined', () => {
    expect(basisCoversElement('6-31G(d)', 'Pd')).toBe(COVERAGE.NO);
    expect(basisCoversElement('SDD', 'Pd')).toBe(COVERAGE.YES);
  });

  it('follows the documented ranges rather than assuming full periodic coverage', () => {
    // LanL2DZ applies to H, Li–La, Hf–Bi (gaussian.com/basissets).
    expect(basisCoversElement('LanL2DZ', 'C')).toBe(COVERAGE.YES);
    expect(basisCoversElement('LanL2DZ', 'Pd')).toBe(COVERAGE.YES);
    expect(basisCoversElement('LanL2DZ', 'He')).toBe(COVERAGE.NO);
    // The lanthanide gap is encoded in the documented ranges even though the
    // app's H–Xe element table cannot resolve those symbols.
    expect(basisSets.find((b) => b.keyword === 'LanL2DZ').coverage).toEqual([
      [1, 1],
      [3, 57],
      [72, 83],
    ]);

    // SDD is documented for all elements through Rn except Fr (87) and Ra (88);
    // the app's symbol table stops at Xe, so assert the encoded range + label.
    const sdd = basisSets.find((b) => b.keyword === 'SDD');
    expect(sdd.coverage).toEqual([[1, 86]]);
    expect(sdd.coverageNote).toMatch(/Fr and Ra/);
    expect(basisCoversElement('SDD', 'Xe')).toBe(COVERAGE.YES);

    // Pople 6-31G stops at Kr; cc-pVTZ has no K (19) entry.
    expect(basisCoversElement('6-31G(d)', 'Kr')).toBe(COVERAGE.YES);
    expect(basisCoversElement('6-31G(d)', 'Xe')).toBe(COVERAGE.NO);
    expect(basisCoversElement('cc-pVTZ', 'K')).toBe(COVERAGE.NO);
    expect(basisCoversElement('cc-pVTZ', 'Pd')).toBe(COVERAGE.NO);

    // def2 covers H–La, Hf–Rn and carries the def2 ECP on heavy elements.
    expect(basisCoversElement('def2TZVP', 'Pd')).toBe(COVERAGE.YES);
    expect(basisIncludesEcp('def2TZVP')).toBe(true);

    // CEP covers H–Rn; Xe is the heaviest element this app can resolve.
    expect(basisCoversElement('CEP-31G', 'Xe')).toBe(COVERAGE.YES);
  });

  it('returns unknown instead of guessing when coverage is not documented', () => {
    expect(basisCoversElement('STO-3G', 'C')).toBe(COVERAGE.UNKNOWN);
    expect(basisCoversElement('not-a-basis', 'C')).toBe(COVERAGE.UNKNOWN);
    // Elements beyond the app's H–Xe table cannot be resolved, so coverage is unknown.
    expect(basisCoversElement('SDD', 'Pt')).toBe(COVERAGE.UNKNOWN);
  });

  it('flags 6-31G(d) + Pd as an error and SDD + Pd as clean', () => {
    const bad = findUncoveredElements({
      atoms: PALLADIUM_ATOMS,
      route: { method: 'B3LYP', basisSet: '6-31G(d)', jobType: 'Opt' },
    });
    expect(bad).toHaveLength(1);
    expect(bad[0]).toMatchObject({
      code: 'basis-not-defined-for-element',
      severity: 'error',
      element: 'Pd',
      basis: '6-31G(d)',
    });
    expect(bad[0].message).toContain('Pd');

    expect(
      findUncoveredElements({
        atoms: PALLADIUM_ATOMS,
        route: { method: 'B3LYP', basisSet: 'SDD', jobType: 'Opt' },
      })
    ).toEqual([]);
  });

  it('warns about heavy all-electron treatment and deduplicates per element', () => {
    const atoms = [
      { symbol: 'Xe', x: 0, y: 0, z: 0 },
      { symbol: 'Xe', x: 0, y: 0, z: 3 },
    ];
    const warnings = findUncoveredElements({
      atoms,
      route: { method: 'B3LYP', basisSet: '3-21G', jobType: 'Opt' },
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      code: 'heavy-element-without-ecp',
      severity: 'warning',
      element: 'Xe',
      basis: '3-21G',
    });
    expect(isHeavyElement('Xe')).toBe(true);
    expect(isHeavyElement('Kr')).toBe(false);
  });

  it('flags elements missing from a GenECP assignment', () => {
    const warnings = findUncoveredElements({
      atoms: MIXED_ATOMS,
      route: {
        method: 'B3LYP',
        jobType: 'Opt',
        basisMode: 'GenECP',
        elementBasis: [{ elements: ['C', 'O'], basis: '6-31G(d)' }],
        ecp: [],
      },
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      code: 'genecp-element-unassigned',
      severity: 'error',
      element: 'Pd',
    });

    expect(
      findUncoveredElements({
        atoms: MIXED_ATOMS,
        route: {
          method: 'B3LYP',
          jobType: 'Opt',
          basisMode: 'GenECP',
          elementBasis: [
            { elements: ['C', 'O'], basis: '6-31G(d)' },
            { elements: ['Pd'], basis: 'LanL2DZ' },
          ],
          ecp: [{ elements: ['Pd'], ecp: 'LanL2DZ' }],
        },
      })
    ).toEqual([]);
  });
  it('flags a GenECP assignment for an element absent from the geometry', () => {
    const warnings = findUncoveredElements({
      atoms: MIXED_ATOMS,
      route: {
        method: 'B3LYP',
        jobType: 'Opt',
        basisMode: 'GenECP',
        elementBasis: [
          { elements: ['C', 'O'], basis: '6-31G(d)' },
          { elements: ['Pd'], basis: 'LanL2DZ' },
          { elements: ['Pt'], basis: 'LanL2DZ' },
        ],
        ecp: [{ elements: ['Pd'], ecp: 'LanL2DZ' }],
      },
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      code: 'genecp-element-not-in-molecule',
      severity: 'error',
      element: 'Pt',
    });
  });
});

describe('Issue #12 — GenECP mixed-basis input', () => {
  it('emits the documented basis and ECP block layout for C/O/Pd', () => {
    const gjf = generateGJF(mixedConfig());

    expect(gjf).toContain('#N B3LYP/GenECP Opt');
    // The exact documented simplified-input structure, after the geometry.
    expect(gjf).toContain(
      [
        'C O 0',
        '6-31G(d)',
        '****',
        'Pd 0',
        'LanL2DZ',
        '****',
        '',
        'Pd 0',
        'LanL2DZ',
      ].join('\n')
    );
    // GenECP is equivalent to Gen Pseudo=Read; both must not be spelled out.
    expect(gjf).not.toMatch(/Pseudo\s*=\s*Read/i);
    // Blocks come after the geometry, and the file ends with a blank line.
    expect(gjf.indexOf('C O 0')).toBeGreaterThan(gjf.indexOf(' Pd      0.000000'));
    expect(gjf.endsWith('\n')).toBe(true);
  });

  it('builds the block lines from the route without inventing parameters', () => {
    expect(buildGenECPBlocks(mixedConfig().route)).toEqual({
      basisLines: ['C O 0', '6-31G(d)', '****', 'Pd 0', 'LanL2DZ', '****'],
      ecpLines: ['Pd 0', 'LanL2DZ'],
    });
  });

  it('accepts element lists as strings and canonicalises their case', () => {
    const { basisLines, ecpLines } = buildGenECPBlocks({
      basisMode: 'genecp',
      elementBasis: [
        { elements: 'c o', basis: '6-31G(d)' },
        { elements: ['PD'], basis: 'LanL2DZ' },
      ],
      ecp: [{ elements: ['pd'], ecp: 'lanl2dz' }],
    });

    expect(basisLines).toEqual(['C O 0', '6-31G(d)', '****', 'Pd 0', 'LanL2DZ', '****']);
    expect(ecpLines).toEqual(['Pd 0', 'LanL2DZ']);
  });

  it('supports a basis-only GenECP input when ecp is explicitly empty', () => {
    const { basisLines, ecpLines } = buildGenECPBlocks({
      basisMode: 'GenECP',
      elementBasis: [{ elements: ['C', 'O'], basis: '6-31G(d)' }],
      ecp: [],
    });

    expect(basisLines).toEqual(['C O 0', '6-31G(d)', '****']);
    expect(ecpLines).toEqual([]);
  });

  it('does not auto-switch a single-basis job to GenECP just because Pd is present', () => {
    const gjf = generateGJF({
      route: { verbosity: '#N', method: 'B3LYP', basisSet: 'LanL2DZ', jobType: 'Opt' },
      title: 'Pd with LanL2DZ',
      charge: 0,
      multiplicity: 1,
      atoms: PALLADIUM_ATOMS,
    });

    expect(gjf).toContain('#N B3LYP/LanL2DZ Opt');
    expect(gjf).not.toContain('GenECP');
    expect(gjf).not.toContain('****');
  });
});

describe('Issue #12 — defaults stay byte-identical', () => {
  it('produces exactly the previous GJF for a normal single-basis job', () => {
    const gjf = generateGJF({
      link0: { memory: '4GB', nproc: 4, checkpoint: 'water.chk' },
      route: {
        verbosity: '#N',
        method: 'B3LYP',
        basisSet: '6-31G(d)',
        jobType: 'Opt Freq',
      },
      title: 'Water optimization',
      charge: 0,
      multiplicity: 1,
      atoms: WATER_ATOMS,
    });

    expect(gjf).toBe(DEFAULT_GJF);
  });
});

describe('Issue #12 — invalid ECP assignments are rejected, not guessed', () => {
  const base = () => mixedConfig();

  it('rejects an unknown ECP keyword', () => {
    const config = base();
    config.route.ecp = [{ elements: ['Pd'], ecp: 'MY-ECP' }];
    expect(() => generateGJF(config)).toThrow(/not a Gaussian basis keyword with a stored ECP/);
  });

  it('rejects a raw/legacy potential name such as LANL2', () => {
    const config = base();
    config.route.ecp = [{ elements: ['Pd'], ecp: 'LANL2' }];
    expect(() => generateGJF(config)).toThrow(/not a Gaussian basis keyword with a stored ECP/);
  });

  it('rejects an ECP that does not belong to the assigned basis', () => {
    const config = base();
    config.route.elementBasis = [
      { elements: ['C', 'O'], basis: '6-31G(d)' },
      { elements: ['Pd'], basis: '6-31G(d)' },
    ];
    config.route.ecp = [{ elements: ['Pd'], ecp: 'LanL2DZ' }];
    expect(() => generateGJF(config)).toThrow(/has no documented ECP/);
  });

  it('rejects an ECP assigned to an element with no basis entry', () => {
    const config = base();
    config.route.ecp = [
      { elements: ['Pd'], ecp: 'LanL2DZ' },
      { elements: ['Pt'], ecp: 'LanL2DZ' },
    ];
    expect(() => generateGJF(config)).toThrow(/Pt has no route\.elementBasis entry/);
  });

  it('rejects duplicate ECP assignments for one element', () => {
    const config = base();
    config.route.ecp = [
      { elements: ['Pd'], ecp: 'LanL2DZ' },
      { elements: ['Pd'], ecp: 'LanL2DZ' },
    ];
    expect(() => generateGJF(config)).toThrow(/more than one ECP assignment/);
  });

  it('rejects an element assigned two different basis sets', () => {
    const config = base();
    config.route.elementBasis = [
      { elements: ['C', 'O', 'Pd'], basis: '6-31G(d)' },
      { elements: ['Pd'], basis: 'LanL2DZ' },
    ];
    expect(() => generateGJF(config)).toThrow(/more than one basis set/);
  });

  it('rejects GenECP without elementBasis', () => {
    const config = base();
    delete config.route.elementBasis;
    expect(() => generateGJF(config)).toThrow(/requires route\.elementBasis/);
  });

  it('rejects GenECP combined with a single route.basisSet', () => {
    const config = base();
    config.route.basisSet = '6-31G(d)';
    expect(() => generateGJF(config)).toThrow(/remove route\.basisSet/);
  });

  it('rejects an unknown basisMode value', () => {
    expect(() =>
      buildRouteSection({ method: 'B3LYP', basisSet: 'SDD', basisMode: 'Gen' })
    ).toThrow(/Unknown basis mode/);
  });

  it('rejects an ECP-bearing GenECP basis when route.ecp is omitted', () => {
    const config = base();
    delete config.route.ecp;
    expect(() => generateGJF(config)).toThrow(/no route\.ecp assignment/);
  });
});

describe('Issue #12 — basis metadata integrity', () => {
  it('gives every basis a documented metadata shape', () => {
    for (const entry of basisSets) {
      expect(typeof entry.ecpIncluded, entry.keyword).toBe('boolean');
      expect(entry, entry.keyword).toHaveProperty('ecpName');
      expect(entry, entry.keyword).toHaveProperty('coverage');

      if (entry.coverage !== null) {
        expect(Array.isArray(entry.coverage), entry.keyword).toBe(true);
        expect(entry.coverage.length, entry.keyword).toBeGreaterThan(0);
        for (const [low, high] of entry.coverage) {
          expect(Number.isInteger(low), entry.keyword).toBe(true);
          expect(Number.isInteger(high), entry.keyword).toBe(true);
          expect(low, entry.keyword).toBeLessThanOrEqual(high);
          expect(low, entry.keyword).toBeGreaterThanOrEqual(1);
          expect(high, entry.keyword).toBeLessThanOrEqual(118);
        }
      }
    }
  });

  it('does not invent coverage for a basis Gaussian does not list', () => {
    const sto3g = basisSets.find((b) => b.keyword === 'STO-3G');
    expect(sto3g.coverage).toBeNull();
    expect(sto3g.coverageNote).toMatch(/unknown/i);
  });

  it('marks the def2 family as ECP-bearing with the documented `def2` potential', () => {
    const karlsruhe = basisSets.filter((b) => b.category === 'Karlsruhe');
    expect(karlsruhe.length).toBeGreaterThan(0);
    for (const entry of karlsruhe) {
      expect(entry.ecpIncluded, entry.keyword).toBe(true);
      expect(entry.ecpName, entry.keyword).toBe('def2');
    }
  });
});
