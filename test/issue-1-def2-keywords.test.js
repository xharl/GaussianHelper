import { describe, it, expect } from 'vitest';
import { basisSets, basisSetCategories } from '../src/data/basisSets.js';
import { buildRouteSection, generateGJF } from '../src/generators/gjfGenerator.js';

/**
 * Issue #1: the Karlsruhe (def2-*) entries used hyphenated `keyword` values, so
 * `method/basisSet` concatenation produced `B3LYP/def2-TZVP`, which Gaussian
 * rejects. Gaussian's keywords for this family are unhyphenated:
 * Def2SVP, Def2TZVP, Def2TZVPP, Def2QZVP, Def2QZVPP (gaussian.com/basissets).
 *
 * The published basis-set *names* keep the hyphen, and so does the display
 * `name` field; only `keyword` reaches the route section.
 */
const EXPECTED_DEF2_ROUTES = [
  ['def2-SVP', 'def2SVP'],
  ['def2-TZVP', 'def2TZVP'],
  ['def2-TZVPP', 'def2TZVPP'],
  ['def2-QZVP', 'def2QZVP'],
  ['def2-QZVPP', 'def2QZVPP'],
];

/**
 * Characters that can legally occur inside a single Gaussian route token.
 *
 * This is deliberately not the bare `^[A-Za-z0-9()+*]+$` suggested in the
 * issue: that class rejects keywords the app must support. A hyphen is a legal
 * route-token character and is required by the Pople (6-31G, STO-3G), Dunning
 * (cc-pVTZ, aug-cc-pVQZ) and ECP (CEP-31G) keywords, and a comma is how
 * Gaussian separates polarization options inside parentheses (6-31G(d,p)).
 *
 * What must never appear in a keyword is whitespace (it splits the token), `/`
 * (it separates method from basis), `=`/`#`/`%` (route-level syntax) and
 * control characters. Parentheses must balance, and commas may only occur
 * inside them.
 */
const ROUTE_TOKEN_CHARS = /^[A-Za-z0-9()+*,\-]+$/;

/**
 * Structural check for a basis-set keyword used as a `/basis` route token.
 * @param {string} keyword
 * @returns {boolean}
 */
function isRouteSafeBasisKeyword(keyword) {
  if (typeof keyword !== 'string' || keyword.length === 0) return false;
  if (keyword !== keyword.trim()) return false;
  if (!ROUTE_TOKEN_CHARS.test(keyword)) return false;

  let depth = 0;
  for (const char of keyword) {
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth < 0) return false;
    } else if (char === ',' && depth === 0) {
      return false;
    }
  }
  return depth === 0;
}

/**
 * Karlsruhe keywords are strictly alphanumeric — Gaussian's own docs note the
 * hyphen is removed for this family, so no punctuation belongs in them at all.
 */
const KARLSRUHE_KEYWORD_CHARS = /^[A-Za-z0-9]+$/;

/**
 * The characters that can never appear in a route token at all, independent of
 * basis-set family.
 */
const ILLEGAL_ROUTE_CHARS = /[\s/=#%\u0000-\u001f]/;

const WATER_ATOMS = [
  { symbol: 'O', x: 0.0, y: 0.0, z: 0.1197 },
  { symbol: 'H', x: 0.0, y: 0.7615, z: -0.4789 },
  { symbol: 'H', x: 0.0, y: -0.7615, z: -0.4789 },
];

const def2Entries = basisSets.filter((b) => b.category === 'Karlsruhe');

describe('Issue #1 — def2 basis keywords are valid Gaussian route tokens', () => {
  it('builds the exact B3LYP/def2TZVP route with no hyphen', () => {
    const tzvp = basisSets.find((b) => b.name === 'def2-TZVP');

    expect(tzvp).toBeDefined();
    expect(tzvp.keyword).toBe('def2TZVP');
    expect(
      buildRouteSection({
        verbosity: '#N',
        method: 'B3LYP',
        basisSet: tzvp.keyword,
        jobType: 'Opt Freq',
      })
    ).toBe('#N B3LYP/def2TZVP Opt Freq');
  });

  it.each(EXPECTED_DEF2_ROUTES)(
    'publishes %s as the unhyphenated keyword %s and routes it verbatim',
    (displayName, expectedKeyword) => {
      const entry = basisSets.find((b) => b.name === displayName);

      expect(entry).toBeDefined();
      expect(entry.keyword).toBe(expectedKeyword);

      const route = buildRouteSection({
        verbosity: '#N',
        method: 'B3LYP',
        basisSet: entry.keyword,
        jobType: 'Opt Freq',
      });

      expect(route).toBe(`#N B3LYP/${expectedKeyword} Opt Freq`);
      // The method/basis token is the second whitespace-delimited field.
      expect(route.split(' ')[1]).toBe(`B3LYP/${expectedKeyword}`);
      expect(route.split(' ')[1]).not.toContain('-');
    }
  );

  it('keeps the readable hyphenated display names for the UI', () => {
    expect(def2Entries.map((b) => b.name)).toEqual([
      'def2-SVP',
      'def2-TZVP',
      'def2-TZVPP',
      'def2-QZVP',
      'def2-QZVPP',
    ]);
    // Display name and route keyword are intentionally different strings.
    def2Entries.forEach((entry) => {
      expect(entry.name).toContain('-');
      expect(entry.keyword).not.toContain('-');
    });
  });

  it('never emits a hyphenated def2 keyword in a generated .gjf file', () => {
    const tzvp = basisSets.find((b) => b.name === 'def2-TZVP');
    const gjf = generateGJF({
      link0: { memory: '4GB', nproc: 4, checkpoint: 'water.chk' },
      route: {
        verbosity: '#N',
        method: 'B3LYP',
        basisSet: tzvp.keyword,
        jobType: 'Opt Freq',
      },
      title: 'Water optimization',
      charge: 0,
      multiplicity: 1,
      atoms: WATER_ATOMS,
    });

    expect(gjf).toContain('#N B3LYP/def2TZVP Opt Freq');
    expect(gjf).not.toMatch(/def2-/);
  });

  it('has a Karlsruhe family made up only of alphanumeric keywords', () => {
    expect(basisSetCategories).toContain('Karlsruhe');
    expect(def2Entries.length).toBeGreaterThan(0);

    def2Entries.forEach((entry) => {
      expect(entry.keyword, `keyword for ${entry.name}`).toMatch(KARLSRUHE_KEYWORD_CHARS);
      expect(entry.keyword, `keyword for ${entry.name}`).not.toContain('-');
    });
  });
});

describe('Basis keyword data guard (no illegal route characters)', () => {
  it('gives every basis set a non-empty keyword that is a single route token', () => {
    expect(basisSets.length).toBeGreaterThan(0);

    basisSets.forEach((entry) => {
      expect(typeof entry.keyword, `keyword for ${entry.name}`).toBe('string');
      expect(entry.keyword.trim(), `keyword for ${entry.name}`).not.toBe('');
      expect(entry.keyword, `keyword for ${entry.name}`).toBe(entry.keyword.trim());
      expect(entry.keyword, `keyword for ${entry.name}`).toMatch(ROUTE_TOKEN_CHARS);
      expect(isRouteSafeBasisKeyword(entry.keyword), `keyword "${entry.keyword}" (${entry.name}) is not a usable route token`).toBe(true);
    });
  });

  it('contains no whitespace, slash, assignment or control character in any keyword', () => {
    basisSets.forEach((entry) => {
      expect(ILLEGAL_ROUTE_CHARS.test(entry.keyword), `illegal route character in "${entry.keyword}" (${entry.name})`).toBe(false);
    });
  });

  it('rejects the characters and shapes that would corrupt a route token', () => {
    // Sanity check on the guard itself, so a future loosening is caught.
    ['def2 TZVP', 'def2/TZVP', 'def2,TZVP', 'def2=TZVP', 'def2TZVP\n', 'def2#TZVP', 'def2TZVP '].forEach((bad) => {
      expect(isRouteSafeBasisKeyword(bad), `route-token guard should reject ${JSON.stringify(bad)}`).toBe(false);
    });
    // Unbalanced parentheses would break the route too.
    ['6-31G(d', '6-31Gd)'].forEach((bad) => {
      expect(isRouteSafeBasisKeyword(bad), `route-token guard should reject ${JSON.stringify(bad)}`).toBe(false);
    });

    // ...while the real, currently-shipped spellings stay valid.
    ['6-31G(d)', '6-31G(d,p)', '6-311++G(2df,2pd)', 'aug-cc-pVQZ', 'def2TZVP'].forEach((good) => {
      expect(isRouteSafeBasisKeyword(good), `route-token guard should accept ${JSON.stringify(good)}`).toBe(true);
    });

    // The Karlsruhe rule is what catches this bug: the old value had a hyphen.
    ['def2-SVP', 'def2-TZVP', 'def2 TZVP', 'def2TZVP/6-31G'].forEach((bad) => {
      expect(KARLSRUHE_KEYWORD_CHARS.test(bad), `Karlsruhe guard should reject ${JSON.stringify(bad)}`).toBe(false);
    });
  });
});
