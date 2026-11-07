import { describe, it, expect } from 'vitest';
import {
  buildFragmentAssignment,
  buildFragmentChargeLine,
  generateGJF,
} from '../src/generators/gjfGenerator.js';
import {
  validateFragmentSpec,
  validateInputCompleteness,
} from '../src/utils/validation.js';

/**
 * Issue #13 — fragment charge/multiplicity separators for multi-fragment input.
 *
 * Verified syntax (Gaussian 16 manual, "Molecule Specifications" → Fragments,
 * https://gaussian.com/molspec/):
 *
 *   "Fragments within a molecular system may be defined using the Fragment
 *    parameter, which appears in parentheses following the atom label …"
 *   "total charge, total spin, fragment1 charge, fragment1 spin,
 *    fragment2 charge, fragment2 spin"
 *
 * i.e. the fragments are NOT separated by a line containing only `-`. That
 * dash-separated form belongs to other programs (Q-Chem and friends); Gaussian
 * puts every fragment's charge/spin pair on the single charge-and-spin line,
 * comma-separated inside a pair and space-separated between pairs, and tags
 * each atom with `(Fragment=N)`. The counterpoise page shows the same layout:
 *   1,2 1,2 0,1
 *   O(Fragment=1) 0.00 0.00 0.00
 *   O(Fragment=2) 0.00 0.00 2.98 …
 * (https://gaussian.com/counterpoise/). This implementation follows the
 * documentation.
 *
 * Fragment numbers are 1-based and must run consecutively for Guess=Fragment
 * and Counterpoise; the atom ranges below are ordered, so index + 1 is the
 * Gaussian fragment number.
 */

const WATER_DIMER_ATOMS = [
  { symbol: 'O', x: 0.0, y: 0.0, z: 0.0 },
  { symbol: 'H', x: 0.49, y: 0.76, z: -0.29 },
  { symbol: 'H', x: 0.49, y: -0.76, z: -0.29 },
  { symbol: 'O', x: 0.0, y: 0.0, z: 2.98 },
  { symbol: 'H', x: -0.91, y: 0.0, z: 3.24 },
  { symbol: 'H', x: -0.01, y: 0.0, z: 2.03 },
];

function dimerConfig(overrides = {}) {
  return {
    link0: { memory: '4GB', nproc: 4, checkpoint: 'dimer.chk' },
    route: {
      verbosity: '#N',
      method: 'B3LYP',
      basisSet: '6-31G(d)',
      jobType: 'Opt',
      custom: 'Counterpoise=2',
    },
    title: 'Water dimer counterpoise',
    charge: 0,
    multiplicity: 1,
    atoms: WATER_DIMER_ATOMS,
    ...overrides,
  };
}

const TWO_FRAGMENTS = [
  { charge: 0, multiplicity: 1, atomRange: [0, 2] },
  { charge: 0, multiplicity: 1, atomRange: [3, 5] },
];

/**
 * Output before issue #13 — no fragment specification. Must stay
 * byte-identical: a single `charge multiplicity` line and untagged atoms.
 */
const SINGLE_FRAGMENT_GJF = [
  '%Mem=4GB',
  '%NProcShared=4',
  '%Chk=dimer.chk',
  '#N B3LYP/6-31G(d) Opt Counterpoise=2',
  '',
  'Water dimer counterpoise',
  '',
  '0 1',
  ' O       0.000000    0.000000    0.000000',
  ' H       0.490000    0.760000   -0.290000',
  ' H       0.490000   -0.760000   -0.290000',
  ' O       0.000000    0.000000    2.980000',
  ' H      -0.910000    0.000000    3.240000',
  ' H      -0.010000    0.000000    2.030000',
  '',
].join('\n');

/** The documented multi-fragment layout for the same water dimer. */
const TWO_FRAGMENT_GJF = [
  '%Mem=4GB',
  '%NProcShared=4',
  '%Chk=dimer.chk',
  '#N B3LYP/6-31G(d) Opt Counterpoise=2',
  '',
  'Water dimer counterpoise',
  '',
  '0,1 0,1 0,1',
  ' O(Fragment=1)      0.000000    0.000000    0.000000',
  ' H(Fragment=1)      0.490000    0.760000   -0.290000',
  ' H(Fragment=1)      0.490000   -0.760000   -0.290000',
  ' O(Fragment=2)      0.000000    0.000000    2.980000',
  ' H(Fragment=2)     -0.910000    0.000000    3.240000',
  ' H(Fragment=2)     -0.010000    0.000000    2.030000',
  '',
].join('\n');

describe('issue #13 — fragment-separated molecule specification', () => {
  describe('generator', () => {
    it('keeps the single-molecule output byte-identical when no fragments are given', () => {
      expect(generateGJF(dimerConfig())).toBe(SINGLE_FRAGMENT_GJF);
    });

    it('keeps the output byte-identical for an explicit single fragment', () => {
      const config = dimerConfig({
        fragments: [{ charge: 0, multiplicity: 1, atomRange: [0, 5] }],
      });
      expect(generateGJF(config)).toBe(SINGLE_FRAGMENT_GJF);
    });

    it('emits the documented two-fragment charge/spin line and (Fragment=N) labels', () => {
      const config = dimerConfig({ fragments: TWO_FRAGMENTS });
      expect(generateGJF(config)).toBe(TWO_FRAGMENT_GJF);
    });

    it('writes one charge/spin pair per fragment in fragment order', () => {
      const fragments = [
        { charge: 0, multiplicity: 1, atomRange: [0, 1] },
        { charge: -1, multiplicity: 2, atomRange: [2, 3] },
        { charge: 1, multiplicity: 1, atomRange: [4, 5] },
      ];
      expect(buildFragmentChargeLine(fragments, 0, 2)).toBe('0,2 0,1 -1,2 1,1');
    });

    it('numbers fragments consecutively from 1 in atom order', () => {
      expect(buildFragmentAssignment(TWO_FRAGMENTS, 6)).toEqual([1, 1, 1, 2, 2, 2]);
    });

    it('rejects a fragment specification without an atom list', () => {
      const config = dimerConfig({ atoms: [], fragments: TWO_FRAGMENTS });
      expect(() => generateGJF(config)).toThrow(/requires an explicit atom list/i);
    });

    it('rejects fragments combined with Geom=AllCheck', () => {
      const config = dimerConfig({
        route: { ...dimerConfig().route, jobType: 'Geom=AllCheck' },
        fragments: TWO_FRAGMENTS,
      });
      expect(() => generateGJF(config)).toThrow(/Geom=AllCheck/);
    });

    it('rejects multi-fragment specifications combined with Geom=Checkpoint', () => {
      const config = dimerConfig({
        route: { ...dimerConfig().route, jobType: 'Geom=Checkpoint' },
        fragments: TWO_FRAGMENTS,
      });
      expect(() => generateGJF(config)).toThrow(/Geom=Checkpoint/);
    });
  });

  describe('validation', () => {
    it('accepts a consistent two-fragment specification', () => {
      const result = validateFragmentSpec(TWO_FRAGMENTS, WATER_DIMER_ATOMS, 0);
      expect(result).toEqual({ valid: true, errors: [] });
    });

    it('names the fragment index in a per-fragment parity error', () => {
      const fragments = [
        { charge: 0, multiplicity: 1, atomRange: [0, 2] },
        { charge: 0, multiplicity: 2, atomRange: [3, 5] },
      ];
      const result = validateFragmentSpec(fragments, WATER_DIMER_ATOMS, 0);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatch(/^Fragment 2: /);
      expect(result.errors[0]).toMatch(/Multiplicity 2 is inconsistent with 10 electrons/);
    });

    it('names the fragment index in a parity error for the first fragment', () => {
      const fragments = [
        { charge: 0, multiplicity: 2, atomRange: [0, 2] },
        { charge: 0, multiplicity: 1, atomRange: [3, 5] },
      ];
      const result = validateFragmentSpec(fragments, WATER_DIMER_ATOMS, 0);

      expect(result.valid).toBe(false);
      expect(result.errors.some((message) => message.startsWith('Fragment 1: '))).toBe(true);
    });

    it('rejects fragment charges that do not sum to the total charge', () => {
      const result = validateFragmentSpec(TWO_FRAGMENTS, WATER_DIMER_ATOMS, 1);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Fragment charges sum to 0, but the total molecular charge is 1.'
      );
    });

    it('rejects overlapping atom ranges', () => {
      const fragments = [
        { charge: 0, multiplicity: 1, atomRange: [0, 3] },
        { charge: 0, multiplicity: 1, atomRange: [3, 5] },
      ];
      const result = validateFragmentSpec(fragments, WATER_DIMER_ATOMS, 0);

      expect(result.valid).toBe(false);
      expect(result.errors.some((message) => /Fragment 2: .*overlaps/.test(message))).toBe(true);
    });

    it('rejects gapped atom ranges', () => {
      const fragments = [
        { charge: 0, multiplicity: 1, atomRange: [0, 2] },
        { charge: 0, multiplicity: 1, atomRange: [4, 5] },
      ];
      const result = validateFragmentSpec(fragments, WATER_DIMER_ATOMS, 0);

      expect(result.valid).toBe(false);
      expect(result.errors.some((message) => /Fragment 2: .*skips atom 3/.test(message))).toBe(true);
    });

    it('rejects ranges that leave trailing atoms unassigned', () => {
      const fragments = [{ charge: 0, multiplicity: 1, atomRange: [0, 2] }];
      const result = validateFragmentSpec(fragments, WATER_DIMER_ATOMS, 0);

      expect(result.valid).toBe(false);
      expect(result.errors.some((message) => /atoms 3–5 .* unassigned/.test(message))).toBe(true);
    });

    it('rejects out-of-bounds atom ranges', () => {
      const fragments = [{ charge: 0, multiplicity: 1, atomRange: [0, 6] }];
      const result = validateFragmentSpec(fragments, WATER_DIMER_ATOMS, 0);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toMatch(/outside the molecule \(6 atoms/);
    });

    it('rejects a multiplicity below 1', () => {
      const fragments = [
        { charge: 0, multiplicity: 0, atomRange: [0, 2] },
        { charge: 0, multiplicity: 1, atomRange: [3, 5] },
      ];
      const result = validateFragmentSpec(fragments, WATER_DIMER_ATOMS, 0);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toMatch(/^Fragment 1: multiplicity must be a positive integer/);
    });

    it('rejects a non-integer charge or multiplicity instead of coercing it', () => {
      const fragments = [
        { charge: '0', multiplicity: 1, atomRange: [0, 2] },
        { charge: 0, multiplicity: 1.5, atomRange: [3, 5] },
      ];
      const result = validateFragmentSpec(fragments, WATER_DIMER_ATOMS, 0);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Fragment 1: charge must be an integer.');
      expect(result.errors.some((message) => /^Fragment 2: multiplicity/.test(message))).toBe(true);
    });

    it('refuses to validate a fragment specification without atoms', () => {
      const result = validateFragmentSpec(TWO_FRAGMENTS, [], 0);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toMatch(/require the atom list/);
    });

    it('surfaces fragment errors through validateInputCompleteness', () => {
      const result = validateInputCompleteness(
        dimerConfig({ fragments: [TWO_FRAGMENTS[0], { ...TWO_FRAGMENTS[1], multiplicity: 2 }] })
      );

      expect(result.valid).toBe(false);
      expect(result.errors.some((message) => message.startsWith('Fragment 2: '))).toBe(true);
    });

    it('accepts a consistent two-fragment configuration in validateInputCompleteness', () => {
      const result = validateInputCompleteness(dimerConfig({ fragments: TWO_FRAGMENTS }));
      expect(result).toEqual({ valid: true, errors: [] });
    });
  });
});
