import { describe, it, expect } from 'vitest';
import {
  methods,
  getMethodByKeyword,
  methodIncludesDispersion,
} from '../src/data/methods.js';
import { dispersionCorrections } from '../src/data/keywords.js';
import { buildRouteSection, generateGJF } from '../src/generators/gjfGenerator.js';
import {
  validateInputCompleteness,
  getTheoryRecommendations,
} from '../src/utils/validation.js';

/**
 * Issue #4: `methods.js` offered a method whose display name was `B2PLYP-D3`.
 *
 * B2PLYPD3 **is** a real Gaussian 16 method keyword: it requests B2PLYP with
 * Grimme's D3 dispersion using Becke-Johnson damping already included. Per
 * https://gaussian.com/dft/ (G16 Rev. C.01, GD3BJ section): "The functionals
 * highlighted in bold include this dispersion model by default when the
 * indicated keyword is specified (e.g., B2PLYPD3)." The GD3BJ parameter table
 * lists B2PLYPD3, and https://gaussian.com/mp/ states "B2PLYPD3 requests the
 * B2PLYP method combined with Grimme's D3BJ dispersion".
 *
 * So the keyword must be kept, and the real hazard is the separate
 * EmpiricalDispersion selector: B2PLYPD3 + EmpiricalDispersion=GD3BJ would
 * double-count dispersion. These tests pin all three behaviours:
 *   1. every methods.js keyword is a valid standalone G16 method token,
 *   2. B2PLYPD3 emits no EmpiricalDispersion by itself,
 *   3. B2PLYP + EmpiricalDispersion=GD3BJ still works, and
 *   4. the double-dispersion combination is rejected.
 */

/**
 * Documented allow-list of standalone Gaussian 16 method keywords, grouped by
 * the gaussian.com page that documents them. This is deliberately an explicit
 * registry rather than a character-class regex: hyphens are legal inside real
 * method tokens (CAM-B3LYP, SAC-CI, LC-wPBE) and would be wrongly rejected by
 * a naive `^[A-Za-z0-9]+$` check, while a token that merely *looks* like a
 * keyword (e.g. a hyphenated display name) would wrongly pass one.
 *
 * A method keyword missing from this registry must be verified against the
 * G16 documentation and added here with its source URL before shipping.
 */
const G16_METHOD_SOURCES = [
  {
    // Hybrid/pure functionals, double-hybrid-adjacent dispersion variants,
    // APFD and B97D; pure functionals are named <exchange><correlation>.
    url: 'https://gaussian.com/dft/',
    keywords: [
      'BLYP', 'BP86', 'PBEPBE', 'PW91PW91', 'TPSSTPSS', 'M06L',
      'B3LYP', 'B3PW91', 'PBE1PBE', 'BHandHLYP', 'O3LYP', 'X3LYP',
      'M05', 'M052X', 'M06', 'M062X', 'M11', 'MN15', 'BMK',
      'CAM-B3LYP', 'wB97', 'wB97X', 'wB97XD', 'LC-wPBE',
      'APFD', 'B97D',
    ],
  },
  {
    // MPn and the double hybrids, including B2PLYPD3 and DSDPBEP86.
    url: 'https://gaussian.com/mp/',
    keywords: ['MP2', 'MP3', 'MP4', 'B2PLYP', 'B2PLYPD3', 'mPW2PLYP', 'DSDPBEP86'],
  },
  {
    // "CCSD-T is a synonym for CCSD(T)".
    url: 'https://gaussian.com/cc/',
    keywords: ['CCSD', 'CCSD(T)'],
  },
  {
    url: 'https://gaussian.com/qci/',
    keywords: ['QCISD', 'QCISD(T)'],
  },
  {
    url: 'https://gaussian.com/cid/',
    keywords: ['CISD'],
  },
  {
    url: 'https://gaussian.com/cas/',
    keywords: ['CASSCF'],
  },
  {
    url: 'https://gaussian.com/cis/',
    keywords: ['CIS'],
  },
  {
    url: 'https://gaussian.com/sacci/',
    keywords: ['SAC-CI'],
  },
  {
    url: 'https://gaussian.com/hf/',
    keywords: ['HF'],
  },
  {
    url: 'https://gaussian.com/gn/',
    keywords: ['G3', 'G3MP2', 'G3B3', 'G3MP2B3', 'G4', 'G4MP2'],
  },
  {
    url: 'https://gaussian.com/cbs/',
    keywords: ['CBS-QB3', 'CBS-4M', 'CBS-APNO'],
  },
  {
    url: 'https://gaussian.com/w1/',
    keywords: ['W1BD'],
  },
  {
    url: 'https://gaussian.com/semiempirical/',
    keywords: ['AM1', 'PM3', 'PM6', 'PM7', 'MNDO', 'INDO'],
  },
  {
    url: 'https://gaussian.com/mm/',
    keywords: ['UFF', 'AMBER', 'DREIDING'],
  },
];

/** Flattened keyword -> documenting URL registry (upper-cased keys). */
const G16_METHOD_REGISTRY = new Map();
for (const { url, keywords } of G16_METHOD_SOURCES) {
  for (const keyword of keywords) {
    const key = keyword.toUpperCase();
    if (G16_METHOD_REGISTRY.has(key)) {
      throw new Error(`Duplicate allow-list entry for ${keyword}`);
    }
    G16_METHOD_REGISTRY.set(key, url);
  }
}

const WATER = [
  { symbol: 'O', x: 0, y: 0, z: 0 },
  { symbol: 'H', x: 0.757, y: 0.586, z: 0 },
  { symbol: 'H', x: -0.757, y: 0.586, z: 0 },
];

function waterConfig(route) {
  return {
    route: { jobType: 'SP', basisSet: 'def2-TZVP', ...route },
    title: 'B2PLYPD3 dispersion test',
    charge: 0,
    multiplicity: 1,
    atoms: WATER,
  };
}

describe('issue #4 — every method keyword is a valid standalone G16 token', () => {
  it('registers every methods.js keyword in the documented allow-list', () => {
    const unregistered = methods
      .map((m) => m.keyword)
      .filter((keyword) => !G16_METHOD_REGISTRY.has(keyword.toUpperCase()));

    expect(unregistered).toEqual([]);
  });

  it('does not silently drop a documented keyword from the registry', () => {
    const used = new Set(methods.map((m) => m.keyword.toUpperCase()));
    const unused = [...G16_METHOD_REGISTRY.keys()].filter((k) => !used.has(k));

    expect(unused).toEqual([]);
  });

  it('has unique, whitespace-free keywords', () => {
    const keywords = methods.map((m) => m.keyword.toUpperCase());

    expect(new Set(keywords).size).toBe(keywords.length);
    for (const m of methods) {
      expect(m.keyword).toBe(m.keyword.trim());
      expect(/\s/.test(m.keyword)).toBe(false);
    }
  });

  it('documents a gaussian.com source for every allow-listed token', () => {
    for (const [keyword, url] of G16_METHOD_REGISTRY) {
      expect(url, keyword).toMatch(/^https:\/\/gaussian\.com\//);
    }
  });
});

describe('issue #4 — B2PLYPD3 already includes D3(BJ)', () => {
  it('keeps the B2PLYPD3 method with dispersion metadata', () => {
    const method = getMethodByKeyword('B2PLYPD3');

    expect(method).toBeDefined();
    expect(method.keyword).toBe('B2PLYPD3');
    expect(method.category).toBe('DFT');
    expect(method.needsBasis).toBe(true);
    expect(method.alreadyIncludesDispersion).toBe(true);
    expect(method.description).toMatch(/D3\(BJ\)/);
  });

  it('does not present the hyphenated `B2PLYP-D3` pseudo-method', () => {
    expect(getMethodByKeyword('B2PLYP-D3')).toBeUndefined();
    expect(methods.some((m) => m.keyword.includes('B2PLYP-D3'))).toBe(false);
    expect(methods.some((m) => m.name === 'B2PLYP-D3')).toBe(false);
    expect(methods.some((m) => /B2PLYP-D3/.test(m.name))).toBe(false);
  });

  it('looks up method metadata case-insensitively', () => {
    expect(getMethodByKeyword('b2plypd3')?.keyword).toBe('B2PLYPD3');
    expect(methodIncludesDispersion('b2plypd3')).toBe(true);
    expect(methodIncludesDispersion('B2PLYP')).toBe(false);
    expect(methodIncludesDispersion('B3LYP')).toBe(false);
    expect(methodIncludesDispersion('')).toBe(false);
  });

  it('emits B2PLYPD3 without any EmpiricalDispersion keyword', () => {
    const route = buildRouteSection({
      verbosity: '#N',
      method: 'B2PLYPD3',
      basisSet: 'def2-TZVP',
      jobType: 'SP',
      dispersion: '',
    });

    expect(route).toBe('#N B2PLYPD3/def2-TZVP SP');
    expect(route).toContain('B2PLYPD3');
    expect(route).not.toContain('EmpiricalDispersion');
    expect(route).not.toContain('B2PLYP-D3');
  });

  it('generates a .gjf whose route line is plain B2PLYPD3', () => {
    const gjf = generateGJF(waterConfig({ method: 'B2PLYPD3' }));
    const routeLine = gjf.split('\n').find((line) => line.startsWith('#N'));

    expect(routeLine).toBe('#N B2PLYPD3/def2-TZVP SP');
    expect(gjf).not.toContain('EmpiricalDispersion');
  });

  it('does not advise adding a dispersion correction to B2PLYPD3', () => {
    const recommendations = getTheoryRecommendations(waterConfig({ method: 'B2PLYPD3' }));

    expect(recommendations.some((r) => r.includes('without dispersion correction'))).toBe(false);
  });
});

describe('issue #4 — double dispersion is blocked', () => {
  it('rejects B2PLYPD3 with EmpiricalDispersion in the route builder', () => {
    expect(() =>
      buildRouteSection({
        method: 'B2PLYPD3',
        basisSet: 'def2-TZVP',
        jobType: 'SP',
        dispersion: 'EmpiricalDispersion=GD3BJ',
      })
    ).toThrow(/already includes an empirical dispersion correction/i);
  });

  it('rejects the combination regardless of keyword casing', () => {
    expect(() =>
      buildRouteSection({
        method: 'b2plypd3',
        basisSet: 'def2-TZVP',
        jobType: 'SP',
        dispersion: 'EmpiricalDispersion=GD3',
      })
    ).toThrow(/already includes an empirical dispersion correction/i);
  });

  it('refuses to generate a .gjf for the double-dispersion combination', () => {
    expect(() =>
      generateGJF(waterConfig({ method: 'B2PLYPD3', dispersion: 'EmpiricalDispersion=GD3BJ' }))
    ).toThrow(/already includes an empirical dispersion correction/i);
  });

  it('reports the double-dispersion configuration as invalid', () => {
    const result = validateInputCompleteness(
      waterConfig({ method: 'B2PLYPD3', dispersion: 'EmpiricalDispersion=GD3BJ' })
    );

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /double-counting dispersion/i.test(e))).toBe(true);
  });

  it('accepts B2PLYPD3 when no separate dispersion is selected', () => {
    const result = validateInputCompleteness(waterConfig({ method: 'B2PLYPD3' }));

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

describe('issue #4 — plain B2PLYP + dispersion still works', () => {
  it('builds B2PLYP with EmpiricalDispersion=GD3BJ', () => {
    const route = buildRouteSection({
      verbosity: '#N',
      method: 'B2PLYP',
      basisSet: '6-31G(d)',
      jobType: 'Opt',
      dispersion: 'EmpiricalDispersion=GD3BJ',
    });

    expect(route).toBe('#N B2PLYP/6-31G(d) Opt EmpiricalDispersion=GD3BJ');
    expect(route).toContain('B2PLYP');
    expect(route).not.toContain('B2PLYPD3');
  });

  it('keeps B2PLYP and the GD3BJ option selectable', () => {
    expect(methods.some((m) => m.keyword === 'B2PLYP')).toBe(true);
    expect(
      dispersionCorrections.some((d) => d.keyword === 'EmpiricalDispersion=GD3BJ')
    ).toBe(true);
    expect(methodIncludesDispersion('B2PLYP')).toBe(false);
  });

  it('validates B2PLYP + GD3BJ as a complete input', () => {
    const result = validateInputCompleteness(
      waterConfig({ method: 'B2PLYP', dispersion: 'EmpiricalDispersion=GD3BJ' })
    );

    expect(result.valid).toBe(true);
  });
});
