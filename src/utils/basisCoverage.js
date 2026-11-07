/**
 * @fileoverview Basis-set element-coverage checks.
 *
 * Gaussian's internally stored basis sets are only defined for the elements
 * listed in the "range of applicability" table at
 * https://gaussian.com/basissets/. The app previously let a user pair any basis
 * with any atom, so `B3LYP/6-31G(d)` on Pd produced an input that Gaussian
 * cannot run. This module turns the documented coverage metadata in
 * `src/data/basisSets.js` into a small, reusable API.
 *
 * The coverage answer is deliberately three-valued:
 *   - 'yes'     — the documentation states the basis covers this element
 *   - 'no'      — the documentation states it does not
 *   - 'unknown' — we have no documented coverage for the basis, or the symbol
 *                 is outside the periodic-table data this app carries (H–Xe)
 *
 * 'unknown' is never treated as 'yes'. Do not add element data here that is not
 * traceable to Gaussian's documentation.
 *
 * @module utils/basisCoverage
 */

import { basisSets } from '../data/basisSets.js';
import { getAtomicNumber } from './elements.js';

/** Possible answers from {@link basisCoversElement}. */
export const COVERAGE = Object.freeze({
  YES: 'yes',
  NO: 'no',
  UNKNOWN: 'unknown',
});

/**
 * First atomic number conventionally treated as a "heavy element" for ECP
 * purposes: Rb (37), i.e. beyond Kr. All-electron treatment beyond Kr is
 * expensive and frequently unavailable; ECP bases are the standard choice.
 */
export const HEAVY_ELEMENT_Z = 37;

/** @type {Map<string, Object>} */
const entriesByKeyword = new Map(
  basisSets.map((entry) => [entry.keyword.toUpperCase(), entry])
);

/**
 * Normalise an element symbol to title case (`pd` → `Pd`, `PD` → `Pd`).
 * @param {unknown} symbol
 * @returns {string}
 */
export function normalizeSymbol(symbol) {
  if (typeof symbol !== 'string') return '';
  const trimmed = symbol.trim();
  if (!trimmed) return '';
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}

/**
 * Look up a basis-set entry by keyword (case-insensitive), or pass through an
 * entry object that already carries metadata.
 *
 * @param {string|Object|null|undefined} basis - Keyword or basis-set entry.
 * @returns {Object|null} The matching entry, or null when unknown.
 */
export function getBasisEntry(basis) {
  if (basis && typeof basis === 'object') {
    const keyword = typeof basis.keyword === 'string' ? basis.keyword.trim().toUpperCase() : '';
    const known = entriesByKeyword.get(keyword);
    if (known) return known;
    // Accept a caller-supplied entry carrying its own coverage metadata.
    return Object.prototype.hasOwnProperty.call(basis, 'coverage') ? basis : null;
  }
  if (typeof basis !== 'string') return null;
  const keyword = basis.trim().toUpperCase();
  if (!keyword) return null;
  return entriesByKeyword.get(keyword) || null;
}

/**
 * Does the basis set define functions for this element?
 *
 * @param {string|Object} basis - Basis-set keyword or entry.
 * @param {string} symbol - Element symbol (e.g. 'Pd').
 * @returns {'yes'|'no'|'unknown'} Documented coverage answer.
 */
export function basisCoversElement(basis, symbol) {
  const atomicNumber = getAtomicNumber(symbol);
  if (atomicNumber === null) return COVERAGE.UNKNOWN;

  const entry = getBasisEntry(basis);
  if (!entry || !Array.isArray(entry.coverage)) return COVERAGE.UNKNOWN;

  const covered = entry.coverage.some(
    ([low, high]) => atomicNumber >= low && atomicNumber <= high
  );
  return covered ? COVERAGE.YES : COVERAGE.NO;
}

/**
 * Whether this app treats the element as heavy (Z >= 37, i.e. beyond Kr).
 * Returns false for symbols outside the bundled periodic-table data (H–Xe).
 *
 * @param {string} symbol
 * @returns {boolean}
 */
export function isHeavyElement(symbol) {
  const atomicNumber = getAtomicNumber(symbol);
  return atomicNumber !== null && atomicNumber >= HEAVY_ELEMENT_Z;
}

/**
 * Whether the basis keyword already carries an effective core potential for
 * the elements that need one.
 *
 * `null` means the basis keyword is unknown to this app.
 *
 * @param {string|Object} basis
 * @returns {boolean|null}
 */
export function basisIncludesEcp(basis) {
  const entry = getBasisEntry(basis);
  if (!entry) return null;
  return Boolean(entry.ecpIncluded);
}

/**
 * @typedef {Object} CoverageWarning
 * @property {'basis-not-defined-for-element'|'heavy-element-without-ecp'|'genecp-element-unassigned'|'genecp-element-not-in-molecule'} code
 * @property {'error'|'warning'} severity
 * @property {string} element - Element symbol.
 * @property {string|null} basis - Basis keyword involved, if any.
 * @property {string} message - Human-readable explanation.
 */

/**
 * Find atoms whose basis assignment is documented as missing or unsuitable.
 *
 * Works for both the single-basis route (`route.basisSet`) and the explicit
 * mixed-basis mode (`route.basisMode === 'GenECP'` with `route.elementBasis`).
 * One warning per (code, element) pair, in first-seen atom order.
 *
 * This is a pure analysis helper: it never mutates the configuration and never
 * throws for unknown symbols or unknown basis keywords.
 *
 * @param {{atoms?: Array<{symbol?: string}>, route?: Object}} config
 * @returns {CoverageWarning[]}
 */
export function findUncoveredElements(config) {
  const atoms = Array.isArray(config?.atoms) ? config.atoms : [];
  const route = config?.route || {};
  const usesGenECP = String(route.basisMode || '').trim().toLowerCase() === 'genecp';

  /** @type {Map<string, string>} */
  const elementBasis = new Map();
  if (usesGenECP && Array.isArray(route.elementBasis)) {
    for (const assignment of route.elementBasis) {
      const elements = Array.isArray(assignment?.elements) ? assignment.elements : [];
      const basis = typeof assignment?.basis === 'string' ? assignment.basis.trim() : '';
      for (const element of elements) {
        const symbol = normalizeSymbol(element);
        if (symbol) elementBasis.set(symbol, basis);
      }
    }
  }

  const singleBasis = typeof route.basisSet === 'string' ? route.basisSet.trim() : '';
  /** @type {CoverageWarning[]} */
  const warnings = [];
  const seen = new Set();

  const addWarning = (warning) => {
    const key = `${warning.code}|${warning.element}`;
    if (seen.has(key)) return;
    seen.add(key);
    warnings.push(warning);
  };

  for (const atom of atoms) {
    const symbol = normalizeSymbol(atom?.symbol);
    if (!symbol) continue;

    const basis = usesGenECP ? elementBasis.get(symbol) : singleBasis;

    if (!basis) {
      if (usesGenECP) {
        addWarning({
          code: 'genecp-element-unassigned',
          severity: 'error',
          element: symbol,
          basis: null,
          message:
            `${symbol} has no GenECP basis assignment. Add it to route.elementBasis ` +
            'so the basis section defines every atom in the molecule.',
        });
      }
      continue;
    }

    const status = basisCoversElement(basis, symbol);
    if (status === COVERAGE.NO) {
      addWarning({
        code: 'basis-not-defined-for-element',
        severity: 'error',
        element: symbol,
        basis,
        message:
          `${symbol} is not covered by ${basis}. Gaussian has no basis functions ` +
          `for this element in that set; use an ECP basis such as SDD, LanL2DZ or ` +
          `CEP-31G, or assign a per-element basis with GenECP.`,
      });
      continue;
    }

    if (isHeavyElement(symbol) && basisIncludesEcp(basis) === false) {
      addWarning({
        code: 'heavy-element-without-ecp',
        severity: 'warning',
        element: symbol,
        basis,
        message:
          `${symbol} is a heavy element (Z >= ${HEAVY_ELEMENT_Z}) being treated ` +
          `all-electron with ${basis}, which supplies no effective core potential. ` +
          'Use an ECP basis such as SDD, LanL2DZ or CEP-31G, or a def2 set.',
      });
    }
  }

  // Gaussian aborts when a GenECP centre definition block names an atom that is
  // not in the molecule (gaussian.com/gen), so surface those assignments too.
  if (usesGenECP && atoms.length > 0 && Array.isArray(route.elementBasis)) {
    const present = new Set(
      atoms.map((atom) => normalizeSymbol(atom?.symbol)).filter(Boolean)
    );
    for (const assignment of route.elementBasis) {
      const elements = Array.isArray(assignment?.elements) ? assignment.elements : [];
      for (const value of elements) {
        const symbol = normalizeSymbol(value);
        if (symbol && !present.has(symbol)) {
          addWarning({
            code: 'genecp-element-not-in-molecule',
            severity: 'error',
            element: symbol,
            basis: typeof assignment?.basis === 'string' ? assignment.basis.trim() : null,
            message:
              `${symbol} has a GenECP basis assignment but does not appear in the geometry; ` +
              'Gaussian aborts when a centre definition block names an absent atom.',
          });
        }
      }
    }
  }

  return warnings;
}

export default {
  COVERAGE,
  HEAVY_ELEMENT_Z,
  getBasisEntry,
  basisCoversElement,
  basisIncludesEcp,
  isHeavyElement,
  findUncoveredElements,
};
