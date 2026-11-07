/**
 * @fileoverview Validation utilities for Gaussian calculation input.
 * Checks charge/multiplicity consistency, method/basis compatibility,
 * and overall input completeness.
 * @module utils/validation
 */

import { getAtomicNumber } from './elements.js';
import { getMethodByKeyword, methodIncludesDispersion } from '../data/methods.js';
import { basisSets } from '../data/basisSets.js';
import * as basisCoverage from './basisCoverage.js';

/**
 * Semi-empirical methods that do not require a basis set.
 * @type {Set<string>}
 */
const SEMIEMPIRICAL_METHODS = new Set([
  'AM1', 'PM3', 'PM6', 'PM7', 'MNDO', 'MINDO3', 'INDO', 'CNDO',
  'ZINDO', 'PDDG', 'RM1',
]);

/**
 * Molecular mechanics methods that do not require a basis set.
 * @type {Set<string>}
 */
const MM_METHODS = new Set([
  'UFF', 'DREIDING', 'AMBER', 'MM2', 'MM3', 'MM4',
]);

/**
 * Composite methods that define their own basis set internally.
 * @type {Set<string>}
 */
const COMPOSITE_METHODS = new Set([
  'CBS-QB3', 'CBS-4M', 'CBS-APNO',
  'G1', 'G2', 'G2MP2', 'G3', 'G3B3', 'G3MP2', 'G3MP2B3',
  'G4', 'G4MP2',
  'W1U', 'W1BD', 'W1RO', 'W2U', 'W2BD',
]);

/**
 * Check whether a method is one that does not require a basis set.
 * @param {string} method - The method name.
 * @returns {boolean}
 */
function methodNeedsBasis(method) {
  if (!method) return false;
  const upper = method.toUpperCase().trim();
  if (SEMIEMPIRICAL_METHODS.has(upper)) return false;
  if (MM_METHODS.has(upper)) return false;
  if (COMPOSITE_METHODS.has(upper)) return false;
  return true;
}

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} valid - Whether the validation passed.
 * @property {string} message - Human-readable description of the result.
 */

/**
 * Validate that the charge and spin multiplicity are consistent with the
 * atom composition of the molecule.
 *
 * Total electrons = sum of atomic numbers − charge.
 * Multiplicity parity rule: (totalElectrons + multiplicity) must be odd
 * (i.e. multiplicity = 2S+1, so unpaired = multiplicity − 1, and
 *  totalElectrons and unpaired must share the same parity).
 *
 * @param {number} charge - The molecular charge (integer).
 * @param {number} multiplicity - The spin multiplicity (positive integer ≥ 1).
 * @param {Array<{symbol: string}>|Array<string>} atomCounts - Array of atoms
 *   (each element is either a string symbol or an object with a `symbol` property).
 * @returns {ValidationResult}
 */
export function validateChargeMultiplicity(charge, multiplicity, atomCounts) {
  try {
    if (!Number.isInteger(charge)) {
      return { valid: false, message: 'Charge must be an integer.' };
    }
    if (!Number.isInteger(multiplicity) || multiplicity < 1) {
      return { valid: false, message: 'Multiplicity must be a positive integer (≥ 1).' };
    }
    if (!Array.isArray(atomCounts) || atomCounts.length === 0) {
      return { valid: false, message: 'At least one atom is required to validate charge/multiplicity.' };
    }

    // Sum total electrons
    let totalElectrons = 0;
    for (const atom of atomCounts) {
      const symbol = typeof atom === 'string' ? atom : atom.symbol;
      const z = getAtomicNumber(symbol);
      if (z === null) {
        return { valid: false, message: `Unknown element symbol: "${symbol}".` };
      }
      totalElectrons += z;
    }
    totalElectrons -= charge;

    if (totalElectrons < 0) {
      return {
        valid: false,
        message: `Charge of ${charge} would result in a negative electron count (${totalElectrons}).`,
      };
    }

    // Parity check: totalElectrons and (multiplicity - 1) must have the same parity
    // Equivalently: (totalElectrons + multiplicity) must be odd
    const unpairedElectrons = multiplicity - 1;
    if ((totalElectrons % 2) !== (unpairedElectrons % 2)) {
      return {
        valid: false,
        message:
          `Multiplicity ${multiplicity} is inconsistent with ${totalElectrons} electrons. ` +
          `An ${totalElectrons % 2 === 0 ? 'even' : 'odd'} electron count requires ` +
          `${totalElectrons % 2 === 0 ? 'odd' : 'even'} multiplicity (1, 3, 5, … or 2, 4, 6, …).`,
      };
    }

    // Check that unpaired electrons don't exceed total electrons
    if (unpairedElectrons > totalElectrons) {
      return {
        valid: false,
        message:
          `Multiplicity ${multiplicity} requires ${unpairedElectrons} unpaired electrons, ` +
          `but only ${totalElectrons} electrons are available.`,
      };
    }

    return { valid: true, message: 'Charge and multiplicity are consistent.' };
  } catch (error) {
    return { valid: false, message: `Validation error: ${error.message}` };
  }
}

/**
 * @typedef {Object} FragmentSpec
 * @property {number} charge - Charge of the fragment (integer).
 * @property {number} multiplicity - Spin multiplicity of the fragment (integer ≥ 1).
 * @property {[number, number]} atomRange - Inclusive, 0-based [startIndex, endIndex].
 */

/**
 * Validate an explicit fragment specification against the atom list.
 *
 * Gaussian 16 defines fragments with a `(Fragment=N)` parameter on the atom
 * lines and a single charge/spin line that carries the total pair followed by
 * one pair per fragment — `total_charge,total_spin frag1_charge,frag1_spin …`
 * (https://gaussian.com/molspec/). This validator enforces what must hold
 * before such a line is emitted:
 *
 *   1. every fragment has an integer charge and a positive integer
 *      multiplicity;
 *   2. the atom ranges are inclusive, in bounds, and tile the atom list
 *      exactly once — no overlaps, no gaps, no unassigned atoms;
 *   3. the fragment charges sum to the molecular total charge;
 *   4. each fragment's charge/multiplicity pair is parity-consistent with the
 *      electrons of its own atoms.
 *
 * Malformed input is reported, never repaired.
 *
 * @param {FragmentSpec[]} fragments - Ordered fragment specifications
 *   (fragment 1 first); index + 1 is the Gaussian fragment number.
 * @param {Array<{symbol: string}>|Array<string>} atoms - The full atom list.
 * @param {number} totalCharge - The molecular total charge.
 * @param {Object} [options]
 * @param {boolean} [options.checkParity=true] - When false, only the structural
 *   and charge-sum rules run. Used for a single fragment, whose parity is the
 *   same check as the molecule's total charge/multiplicity.
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateFragmentSpec(fragments, atoms, totalCharge, { checkParity = true } = {}) {
  const errors = [];

  if (!Array.isArray(fragments) || fragments.length === 0) {
    return {
      valid: false,
      errors: ['fragments must be a non-empty array of { charge, multiplicity, atomRange }.'],
    };
  }
  if (!Array.isArray(atoms) || atoms.length === 0) {
    return { valid: false, errors: ['Fragment atom ranges require the atom list to validate against.'] };
  }
  if (!Number.isInteger(totalCharge)) {
    errors.push('The total molecular charge must be an integer when fragments are specified.');
  }

  const total = atoms.length;
  let expectedStart = 0;
  let chargeSum = 0;
  let rangesWellFormed = true;

  fragments.forEach((fragment, index) => {
    const label = `Fragment ${index + 1}`;

    if (!fragment || typeof fragment !== 'object') {
      rangesWellFormed = false;
      errors.push(`${label}: must be an object { charge, multiplicity, atomRange }.`);
      return;
    }

    if (!Number.isInteger(fragment.charge)) {
      errors.push(`${label}: charge must be an integer.`);
    } else {
      chargeSum += fragment.charge;
    }

    if (!Number.isInteger(fragment.multiplicity) || fragment.multiplicity < 1) {
      errors.push(
        `${label}: multiplicity must be a positive integer (≥ 1). ` +
        'Gaussian\'s negative-multiplicity Guess=Fragment β-spin convention is not supported.'
      );
    }

    const range = fragment.atomRange;
    if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isInteger)) {
      rangesWellFormed = false;
      errors.push(`${label}: atomRange must be [startIndex, endIndex] inclusive 0-based integers.`);
      return;
    }

    const [start, end] = range;
    if (start < 0 || end >= total) {
      rangesWellFormed = false;
      errors.push(
        `${label}: atomRange [${start}, ${end}] is outside the molecule ` +
        `(${total} atoms; valid indices 0–${total - 1}).`
      );
      return;
    }
    if (start > end) {
      rangesWellFormed = false;
      errors.push(`${label}: atomRange [${start}, ${end}] is empty; start must not exceed end.`);
      return;
    }

    if (start < expectedStart) {
      errors.push(
        `${label}: atomRange [${start}, ${end}] overlaps an earlier fragment; ` +
        `the next unassigned atom is ${expectedStart}.`
      );
    } else if (start > expectedStart) {
      const skipped = start - expectedStart === 1
        ? `atom ${expectedStart}`
        : `atoms ${expectedStart}–${start - 1}`;
      errors.push(
        `${label}: atomRange [${start}, ${end}] skips ${skipped}; ` +
        'fragment ranges must cover every atom exactly once.'
      );
    }
    expectedStart = end + 1;

    if (
      checkParity &&
      Number.isInteger(fragment.charge) &&
      Number.isInteger(fragment.multiplicity) &&
      fragment.multiplicity >= 1
    ) {
      const result = validateChargeMultiplicity(
        fragment.charge,
        fragment.multiplicity,
        atoms.slice(start, end + 1)
      );
      if (!result.valid) {
        errors.push(`${label}: ${result.message}`);
      }
    }
  });

  if (rangesWellFormed && expectedStart < total) {
    errors.push(
      `Fragment ranges cover ${expectedStart} of ${total} atoms; ` +
      `atoms ${expectedStart}–${total - 1} (0-based) are unassigned.`
    );
  }

  if (Number.isInteger(totalCharge) && chargeSum !== totalCharge) {
    errors.push(
      `Fragment charges sum to ${chargeSum}, but the total molecular charge is ${totalCharge}.`
    );
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate that the chosen method and basis set are compatible.
 *
 * Semi-empirical and molecular mechanics methods do not use a basis set,
 * and composite methods define their own internally.
 *
 * @param {string} method - The computational method (e.g. 'B3LYP', 'PM6', 'UFF').
 * @param {string} basisSet - The basis set (e.g. '6-31G(d)', '' for none).
 * @returns {ValidationResult}
 */
export function validateMethodBasis(method, basisSet) {
  try {
    if (!method || method.trim().length === 0) {
      return { valid: false, message: 'A computational method must be specified.' };
    }

    const trimmedMethod = method.trim();
    const upperMethod = trimmedMethod.toUpperCase();
    const hasBasis = basisSet && basisSet.trim().length > 0;
    const needsBasis = methodNeedsBasis(trimmedMethod);

    if (!needsBasis && hasBasis) {
      // Determine the category for a better message
      let category = 'This method';
      if (SEMIEMPIRICAL_METHODS.has(upperMethod)) category = `Semi-empirical method "${trimmedMethod}"`;
      else if (MM_METHODS.has(upperMethod)) category = `Molecular mechanics method "${trimmedMethod}"`;
      else if (COMPOSITE_METHODS.has(upperMethod)) category = `Composite method "${trimmedMethod}"`;

      return {
        valid: false,
        message: `${category} does not use an external basis set. Remove the basis set or choose a different method.`,
      };
    }

    if (needsBasis && !hasBasis) {
      return {
        valid: false,
        message: `Method "${trimmedMethod}" requires a basis set.`,
      };
    }

    return { valid: true, message: 'Method and basis set are compatible.' };
  } catch (error) {
    return { valid: false, message: `Validation error: ${error.message}` };
  }
}

/**
 * Validate that all required fields in the application state are filled
 * before generating a Gaussian input file.
 *
 * @param {Object} state - The application state object.
 * @param {Object} state.route - Route section configuration.
 * @param {string} state.route.method - Computational method.
 * @param {string} [state.route.basisSet] - Basis set.
 * @param {string} state.route.jobType - Job type keywords.
 * @param {string} state.title - Job title.
 * @param {number} state.charge - Molecular charge.
 * @param {number} state.multiplicity - Spin multiplicity.
 * @param {Array<{symbol: string, x: number, y: number, z: number}>} state.atoms - Atom coordinates.
 * @param {Array<{charge: number, multiplicity: number, atomRange: [number, number]}>} [state.fragments]
 *   Optional explicit fragment specification (see {@link validateFragmentSpec}).
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateInputCompleteness(state) {
  const errors = [];

  try {
    // Method is always required
    if (!state?.route?.method || state.route.method.trim().length === 0) {
      errors.push('Computational method is required.');
    }

    // Basis set required only for methods that need one
    if (state?.route?.method && methodNeedsBasis(state.route.method.trim())) {
      if (!state.route.basisSet || state.route.basisSet.trim().length === 0) {
        errors.push('Basis set is required for this method.');
      }
    }

    // Methods that already include dispersion (e.g. B2PLYPD3) must not also
    // request EmpiricalDispersion, which would double-count the correction.
    const dispersion = (state?.route?.dispersion || '').trim();
    if (dispersion && state?.route?.method && methodIncludesDispersion(state.route.method.trim())) {
      errors.push(
        `Method ${state.route.method.trim()} already includes an empirical dispersion correction; ` +
        `remove ${dispersion} to avoid double-counting dispersion.`
      );
    }

    // Job type
    if (!state?.route?.jobType || state.route.jobType.trim().length === 0) {
      errors.push('Job type is required (e.g. "Opt", "Freq", "SP").');
    }

    // Title
    if (!state?.title || state.title.trim().length === 0) {
      errors.push('A title/description is required.');
    }

    // Charge and multiplicity
    if (state?.charge === undefined || state?.charge === null || !Number.isInteger(state.charge)) {
      errors.push('Charge must be specified as an integer.');
    }
    if (
      state?.multiplicity === undefined ||
      state?.multiplicity === null ||
      !Number.isInteger(state.multiplicity) ||
      state.multiplicity < 1
    ) {
      errors.push('Multiplicity must be a positive integer (≥ 1).');
    }

    // Atoms
    if (!Array.isArray(state?.atoms) || state.atoms.length === 0) {
      errors.push('At least one atom with coordinates is required.');
    } else {
      // Verify each atom has the necessary fields
      for (let i = 0; i < state.atoms.length; i++) {
        const atom = state.atoms[i];
        if (!atom.symbol || typeof atom.symbol !== 'string') {
          errors.push(`Atom ${i + 1}: missing or invalid element symbol.`);
        } else if (getAtomicNumber(atom.symbol) === null) {
          errors.push(`Atom ${i + 1}: unknown element symbol "${atom.symbol}".`);
        }
        if (![atom.x, atom.y, atom.z].every(Number.isFinite)) {
          errors.push(`Atom ${i + 1} (${atom.symbol || '?'}): coordinates must be finite numbers.`);
        }
      }

      // Cross-validate charge/multiplicity against atoms if we have valid values.
      // With fragments this checks the total pair; each fragment's own pair is
      // checked separately below.
      const explicitFragments = Array.isArray(state?.fragments) && state.fragments.length > 0;
      const multiFragment = Array.isArray(state?.fragments) && state.fragments.length > 1;

      if (
        errors.length === 0 &&
        Number.isInteger(state.charge) &&
        Number.isInteger(state.multiplicity)
      ) {
        const cmResult = validateChargeMultiplicity(state.charge, state.multiplicity, state.atoms);
        if (!cmResult.valid) {
          errors.push(cmResult.message);
        }
      }

      if (explicitFragments) {
        const fragmentResult = validateFragmentSpec(
          state.fragments,
          state.atoms,
          state.charge,
          { checkParity: multiFragment }
        );
        errors.push(...fragmentResult.errors);
      }
    }

    // Cross-validate method/basis
    if (state?.route?.method) {
      const mbResult = validateMethodBasis(state.route.method, state.route.basisSet);
      if (!mbResult.valid) {
        errors.push(mbResult.message);
      }
    }
  } catch (error) {
    errors.push(`Unexpected validation error: ${error.message}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * @typedef {Object} LintIssue
 * @property {string} id - Stable rule identifier (used by tests and the UI).
 * @property {'warning'|'info'} severity - `warning` for configurations that
 *   are likely wrong or wasteful, `info` for advice that does not invalidate
 *   the job.
 * @property {string} message - Human-readable explanation.
 */

/**
 * Bridge to src/utils/basisCoverage.js. The API is three-valued:
 * `basisCoversElement(basis, symbol)` returns 'yes' | 'no' | 'unknown', and
 * `basisIncludesEcp(basis)` reports whether the keyword carries an ECP.
 */
const optionalBasisCoverage =
  typeof basisCoverage.basisCoversElement === 'function' ? basisCoverage : null;

/** DFT rungs that carry exact-exchange and therefore need a polarized basis. */
const HYBRID_RUNGS = new Set(['hybrid', 'meta-hybrid']);

/** Transition-metal Z ranges used by the ECP/SCF hints. */
const TRANSITION_METAL_RANGES = [
  [21, 30],
  [39, 48],
  [72, 80],
];

/** @param {string} upperBasis @returns {boolean} */
function isPopleBasisName(upperBasis) {
  return upperBasis.includes('6-31') || upperBasis.includes('3-21') || upperBasis.startsWith('STO-');
}

/** @param {string} upperBasis @returns {boolean} */
function isDunningBasisName(upperBasis) {
  return upperBasis.startsWith('CC-PV') || upperBasis.startsWith('AUG-CC-PV');
}

/**
 * Small Pople double-zeta (or minimal) basis. 6-311G and larger are excluded;
 * def2-SVP/cc-pVDZ are handled separately by the correlation-method rule.
 *
 * @param {string} upperBasis
 * @returns {boolean}
 */
function isSmallPopleDoubleZeta(upperBasis) {
  if (!upperBasis || upperBasis.startsWith('6-311')) return false;
  return /^(STO-3G|3-21G|6-31G)/.test(upperBasis);
}

/**
 * Ask basisCoverage.js whether `basis` is usable for `symbol`. Returns true
 * when the basis defines functions and carries an ECP where the element needs
 * one, false when the basis is documented as missing or all-electron for a
 * heavy element, and undefined when the answer cannot be established (so the
 * caller can fall back to the built-in heuristic).
 *
 * Accepts both the three-valued string API and a plain boolean API so the
 * bridge does not depend on one exact revision of the helper.
 *
 * @param {string} basis
 * @param {string} symbol
 * @returns {boolean|undefined}
 */
function lookupBasisCoverage(basis, symbol) {
  if (!optionalBasisCoverage || !basis) return undefined;
  try {
    const status = optionalBasisCoverage.basisCoversElement(basis, symbol);
    if (status === 'no' || status === false) return false;
    if (status === 'unknown' || status === null || status === undefined) return undefined;

    // 'yes' / true only says the basis has functions for the element. A heavy
    // element additionally needs an ECP, which the companion helper reports.
    if (typeof optionalBasisCoverage.basisIncludesEcp === 'function') {
      const includesEcp = optionalBasisCoverage.basisIncludesEcp(basis);
      if (includesEcp === false) return false;
      if (includesEcp === true) return true;
    }
    return true;
  } catch {
    return undefined;
  }
}

/**
 * Collect unique element symbols from an atom list.
 * @param {Array<{symbol?: string}|string>} atoms
 * @returns {string[]}
 */
function uniqueSymbols(atoms) {
  const symbols = [];
  for (const atom of atoms) {
    const symbol = typeof atom === 'string' ? atom : atom?.symbol;
    if (typeof symbol === 'string' && symbol.trim() !== '' && !symbols.includes(symbol.trim())) {
      symbols.push(symbol.trim());
    }
  }
  return symbols;
}

/**
 * Whether the route text (job type + custom keywords) requests a TS search.
 * @param {string} routeText
 * @returns {boolean}
 */
function requestsTsOptimization(routeText) {
  const match = /\bOPT\s*=\s*(?:\(\s*)?([^)\s]*)/i.exec(routeText);
  return Boolean(match && /\bTS\b/i.test(match[1]));
}

/**
 * Run the pre-flight chemistry lint over a GJF configuration.
 *
 * Rules (all metadata-driven):
 *   1. DFT without an explicit dispersion correction, unless the method
 *      keyword already includes one (B2PLYPD3, wB97XD, APFD, B97D, DSDPBEP86).
 *   2. Hybrid / meta-hybrid DFT on a small Pople double-zeta basis.
 *   3. Freq without explicit Temperature/Pressure (informational).
 *   4. Opt=(TS,...) without CalcFC or NoEigenTest.
 *   5. TD with a DFT functional that is not range-separated (informational).
 *   6. Transition metal with no SCF= keyword (informational).
 *   7. Heavy element (Z > 36) on a basis without ECP coverage.
 *   8. A method that does not take a basis set (semi-empirical, MM,
 *      composite) given one anyway.
 *
 * Retained from the previous recommendation list: ECP advice for transition
 * metals, diffuse functions for anions/excited states, and the small-basis
 * warning for correlation methods.
 *
 * @param {Object} config - The GJF configuration.
 * @returns {{issues: LintIssue[], estimate: Object|null}}
 */
export function lintTheoryLevel(config) {
  const issues = [];
  if (!config || typeof config !== 'object') return { issues, estimate: null };

  const atoms = Array.isArray(config.atoms) ? config.atoms : [];
  const route = config.route || {};
  const methodKeyword = (route.method || '').trim();
  const methodDef = getMethodByKeyword(methodKeyword);
  const basisRaw = (route.basisSet || '').trim();
  const basisSet = basisRaw.toUpperCase();
  const charge = Number.isInteger(config.charge) ? config.charge : 0;
  const jobType = (route.jobType || '').trim().toUpperCase();
  const custom = (route.custom || '').trim().toUpperCase();
  const scfKeyword = (route.scf || '').trim();
  const dispersion = (route.dispersion || '').trim();
  const routeText = `${jobType} ${custom}`.trim();

  const push = (id, severity, message) => issues.push({ id, severity, message });

  const symbols = uniqueSymbols(atoms);
  const heavySymbols = symbols.filter((symbol) => {
    const z = getAtomicNumber(symbol);
    return z !== null && z > 36;
  });
  const transitionMetalSymbols = symbols.filter((symbol) => {
    const z = getAtomicNumber(symbol);
    if (z === null) return false;
    return TRANSITION_METAL_RANGES.some(([min, max]) => z >= min && z <= max);
  });

  // ── Rule 7: heavy element on a basis without ECP coverage ───────────
  if (heavySymbols.length > 0) {
    const uncovered = heavySymbols.filter((symbol) => {
      const coverage = lookupBasisCoverage(basisRaw, symbol);
      if (coverage === true) return false;
      if (coverage === false) return true;
      // No coverage helper available: keep the historical conservative
      // heuristic — Pople and Dunning all-electron sets do not carry ECPs.
      return isPopleBasisName(basisSet) || isDunningBasisName(basisSet);
    });

    if (uncovered.length > 0) {
      push(
        'heavy-element-ecp',
        'warning',
        `Heavy elements (Z > 36) are present (${uncovered.join(', ')}). ${basisRaw || 'none'} does not provide ` +
        `ECP coverage for them and may fail or lack parameters. Consider using an Effective Core Potential (ECP) ` +
        `basis set (e.g., LanL2DZ or SDD) or a Karlsruhe basis set with ECP coverage (e.g., def2-TZVP).`
      );
    }
  }

  // ── Retained: transition-metal ECP advice on a Pople basis ──────────
  if (
    heavySymbols.length === 0 &&
    transitionMetalSymbols.length > 0 &&
    isPopleBasisName(basisSet) &&
    !basisSet.includes('LANL') &&
    !basisSet.includes('SDD')
  ) {
    push(
      'transition-metal-ecp',
      'warning',
      `Transition metals are present. Pople basis sets (like ${basisRaw || 'none'}) are often poor or unavailable. ` +
      `An ECP basis set (e.g., LanL2DZ or SDD) is recommended for transition metal centers.`
    );
  }

  // ── Retained: diffuse functions for anions / excited states ─────────
  const isAnion = charge < 0;
  const isTdRequest = /\bTD\b/.test(jobType) || /\bNSTATES\s*=/.test(jobType);
  const hasDiffuse = basisSet.includes('+') || basisSet.startsWith('AUG-');

  if (isAnion && !hasDiffuse && methodNeedsBasis(methodKeyword)) {
    push(
      'diffuse-anion',
      'warning',
      `For systems with a negative charge (anions), adding diffuse functions (e.g., + in 6-31+G(d) or aug- in Dunning basis sets) ` +
      `is highly recommended to describe weakly bound electron density.`
    );
  } else if (isTdRequest && !hasDiffuse && methodNeedsBasis(methodKeyword)) {
    push(
      'diffuse-excited-state',
      'warning',
      `For excited-state calculations (TD-DFT), adding diffuse functions (e.g., 6-31+G(d) or aug-cc-pVDZ) is recommended ` +
      `to properly capture diffuse excited state wavefunctions (Rydberg states).`
    );
  }

  // ── Rule 1: DFT without dispersion, driven by method metadata ───────
  if (methodDef?.isDft === true && methodDef.alreadyIncludesDispersion !== true && !dispersion) {
    push(
      'dispersion-missing',
      'warning',
      `Method ${methodKeyword} is a DFT functional without dispersion correction. For geometries and non-covalent interactions, ` +
      `consider adding a dispersion correction (e.g., EmpiricalDispersion=GD3BJ).`
    );
  }

  // ── Retained: small basis for a correlation method ──────────────────
  const upperMethod = methodKeyword.toUpperCase();
  const isCorrelationMethod = methodDef?.rung === 'double-hybrid' ||
    ['MP2', 'MP3', 'MP4', 'CCSD', 'QCISD'].some((kw) => upperMethod.startsWith(kw));
  // Historical definition: 6-31G(d) contains a 'D' and is therefore not
  // treated as "small" here; the hybrid double-zeta rule below covers that.
  const isSmallBasis = basisSet.includes('3-21') ||
    (basisSet.includes('6-31') && !basisSet.includes('6-311') && !basisSet.includes('+') && !basisSet.includes('D'));

  if (isCorrelationMethod && isSmallBasis) {
    push(
      'correlation-small-basis',
      'warning',
      `Electron correlation methods (like ${methodKeyword}) converge very slowly with basis set size. ` +
      `Using small double-zeta basis sets (like ${basisRaw || 'none'}) is not recommended. Consider using cc-pVTZ or def2-TZVP.`
    );
  }

  // ── Rule 2: hybrid / meta-hybrid DFT on a small Pople basis ─────────
  if (methodDef?.isDft === true && HYBRID_RUNGS.has(methodDef.rung) && isSmallPopleDoubleZeta(basisSet)) {
    push(
      'hybrid-small-basis',
      'warning',
      `Method ${methodKeyword} is a ${methodDef.rung} functional on a small Pople basis (${basisRaw}). ` +
      `Hybrid and meta-hybrid DFT usually need at least a triple-zeta basis (e.g., 6-311G(d,p), def2-TZVP or cc-pVTZ) ` +
      `for reliable energetics.`
    );
  }

  // ── Rule 3: Freq without explicit thermochemistry conditions ────────
  const hasFreq = /\bFREQ\b/.test(jobType);
  const hasTemperature = /\bTEMPERATURE\s*=/.test(routeText);
  const hasPressure = /\bPRESSURE\s*=/.test(routeText);
  if (hasFreq && !hasTemperature && !hasPressure) {
    push(
      'freq-thermochemistry-defaults',
      'info',
      `Freq is requested without explicit Temperature/Pressure. Gaussian defaults to 298.15 K and 1 atm; ` +
      `set Temperature=... and Pressure=... in the route section if you need other conditions or want them recorded.`
    );
  }

  // ── Rule 4: TS optimization without a Hessian or eigenvector test ───
  const tsHessian = /\bCALCFC\b|\bNOEIGENTEST\b/.test(routeText);
  if (requestsTsOptimization(routeText) && !tsHessian) {
    push(
      'ts-opt-missing-hessian',
      'warning',
      `Opt=(TS,...) is requested without CalcFC or NoEigenTest. A saddle-point search started without a Hessian ` +
      `(or without relaxing the eigenvector test) often fails or converges to the wrong stationary point; ` +
      `consider Opt=(TS,CalcFC) or at least NoEigenTest.`
    );
  }

  // ── Rule 5: TD with a global (non-range-separated) functional ───────
  if (isTdRequest && methodDef?.isDft === true && methodDef.isRangeSeparated !== true) {
    push(
      'td-non-range-separated',
      'info',
      `TD is requested with ${methodKeyword}, which is not range-separated. Charge-transfer and Rydberg excitations ` +
      `are often badly described by global hybrids; consider a range-separated functional (e.g., CAM-B3LYP or wB97XD) ` +
      `if CT states matter.`
    );
  }

  // ── Rule 6: transition metal with default SCF settings ──────────────
  const hasScfKeyword = /\bSCF\s*=/.test(`${routeText} ${scfKeyword}`.toUpperCase());
  if (transitionMetalSymbols.length > 0 && !hasScfKeyword) {
    push(
      'transition-metal-scf',
      'info',
      `Transition metals are present but no SCF keyword is specified. SCF convergence for metal complexes is often ` +
      `improved by SCF=(XQC) (or SCF=(Tight,XQC)); set it explicitly if the default DIIS cycles oscillate.`
    );
  }

  // ── Rule 8: basis supplied to a method that does not use one ────────
  if (methodDef && methodDef.needsBasis === false && basisRaw) {
    const kind = methodDef.category === 'Semi-Empirical'
      ? 'a semi-empirical method'
      : methodDef.category === 'Molecular Mechanics'
        ? 'a force field'
        : methodDef.category === 'Composite'
          ? 'a composite method'
          : 'a method that defines its own basis';
    push(
      'unsupported-method-basis',
      'warning',
      `${methodKeyword} is ${kind} and does not use an external basis set; remove ${basisRaw}. ` +
      `Gaussian would ignore or reject the basis keyword for this method.`
    );
  }

  return { issues, estimate: estimateCalculationCost(config) };
}

/**
 * Backwards-compatible string list used by existing callers/tests.
 * New UI code should use {@link lintTheoryLevel} so it gets severities and the
 * cost estimate.
 *
 * @param {Object} config - The GJF configuration.
 * @returns {string[]} Recommendation/lint messages.
 */
export function getTheoryRecommendations(config) {
  return lintTheoryLevel(config).issues.map((issue) => issue.message);
}

// ─── Heuristic cost estimate ──────────────────────────────────────────────

/**
 * Order-of-magnitude cost model.
 *
 * All numbers below are ENGINEERING ASSUMPTIONS, not measured runtimes and not
 * benchmarks. They exist only to separate a laptop-sized job from a
 * cluster-sized one. The reference point is a 10-atom molecule in a
 * double-zeta basis, gas phase, single point, one core:
 *
 *   core-hours ≈ anchor × (N_eff / 10)^exponent × job-type multiplier
 *
 * `anchor` is the reference-size cost in core-hours, `exponent` the textbook
 * N-scaling of the method class (HF/DFT N^3–N^4, MP2 N^5, CCSD N^6,
 * CCSD(T) N^7), and N_eff = atoms × basis-size weight.
 *
 * `anchor` and `exponent` are [low, high] pairs; the low end of the range uses
 * both low values, the high end both high values.
 */
const COST_REFERENCE_ATOMS = 10;

const COST_RUNG_MODEL = Object.freeze({
  MM: { exponent: [2, 2], anchor: [1e-5, 2e-5] },
  'semi-empirical': { exponent: [2, 3], anchor: [2e-4, 5e-4] },
  HF: { exponent: [3, 3.5], anchor: [0.05, 0.1] },
  LDA: { exponent: [3, 3.5], anchor: [0.05, 0.1] },
  GGA: { exponent: [3, 3.5], anchor: [0.08, 0.16] },
  'meta-GGA': { exponent: [3, 3.5], anchor: [0.12, 0.3] },
  hybrid: { exponent: [3, 3.5], anchor: [0.2, 0.4] },
  'meta-hybrid': { exponent: [3.5, 4], anchor: [0.3, 0.6] },
  'double-hybrid': { exponent: [5, 5], anchor: [1.2, 2.4] },
  'post-HF': { exponent: [5, 5], anchor: [1.5, 3] },
  composite: { exponent: [7, 8], anchor: [60, 120] },
});

/**
 * Anchors for post-HF methods whose metadata sets `costExponent` (N-scaling is
 * too method-specific for the single 'post-HF' rung). Same units as above.
 */
const POST_HF_ANCHORS = Object.freeze({
  4: [0.4, 0.8],   // CIS (N^4 σ/τ build; iterative diagonalisation ignored)
  5: [1.5, 3],     // MP2
  6: [8, 16],      // CCSD, QCISD, CISD, SAC-CI
  7: [50, 100],    // CCSD(T), MP4, QCISD(T)
});

/**
 * Relative number of basis functions per atom, from the catalogue's 1–5 size
 * scale. A double-zeta set is 1.0 by definition.
 */
const BASIS_WEIGHT_BY_SIZE = Object.freeze({ 1: 0.35, 2: 1, 3: 1.8, 4: 2.8, 5: 4 });

/**
 * Job-type multipliers relative to a single-point energy. Ranges reflect that
 * optimisations need many SCF cycles and frequencies need second derivatives.
 */
const JOB_MULTIPLIERS = Object.freeze({
  SP: [1, 1, 'single point'],
  Opt: [8, 25, 'Opt'],
  Freq: [5, 15, 'Freq'],
  'Opt Freq': [15, 45, 'Opt Freq'],
  IRC: [40, 120, 'IRC'],
  TD: [5, 20, 'TD'],
  NMR: [2, 6, 'NMR'],
  Polar: [2, 5, 'Polar/Volume'],
});

/** @param {number|number[]} value @returns {number[]} */
function normalisePair(value) {
  return Array.isArray(value) ? [value[0], value[1]] : [value, value];
}

/**
 * Round to one significant figure, because the model does not support more.
 * @param {number} value
 * @returns {number}
 */
function toOneSigFig(value) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Number(value.toPrecision(1));
}

/**
 * Basis-size weight for the cost model.
 * @param {string} basisRaw
 * @returns {{weight: number, known: boolean}}
 */
function getBasisWeight(basisRaw) {
  // Route keywords are unhyphenated for some families (def2TZVP) while the
  // display name is hyphenated (def2-TZVP); compare with separators removed.
  const target = (basisRaw || '').replace(/[\s-]/g, '').toUpperCase();
  if (!target) return { weight: 1, known: true };
  const match = basisSets.find((basis) => basis.keyword.replace(/[\s-]/g, '').toUpperCase() === target);
  const weight = match ? BASIS_WEIGHT_BY_SIZE[match.size] : undefined;
  return typeof weight === 'number' ? { weight, known: true } : { weight: 1, known: false };
}

/**
 * Pick the job-type multiplier from the route's job type.
 * @param {string} jobType
 * @returns {[number, number, string]}
 */
function getJobMultiplier(jobType) {
  const jt = (jobType || '').toUpperCase();
  if (/\bIRC\b/.test(jt)) return JOB_MULTIPLIERS.IRC;
  if (/\bOPT\b/.test(jt)) {
    return /\bFREQ\b/.test(jt) ? JOB_MULTIPLIERS['Opt Freq'] : JOB_MULTIPLIERS.Opt;
  }
  if (/\bFREQ\b/.test(jt)) return JOB_MULTIPLIERS.Freq;
  if (/\bTD\b/.test(jt)) return JOB_MULTIPLIERS.TD;
  if (/\bNMR\b/.test(jt)) return JOB_MULTIPLIERS.NMR;
  if (/\bPOLAR\b|\bVOLUME\b/.test(jt)) return JOB_MULTIPLIERS.Polar;
  return JOB_MULTIPLIERS.SP;
}

/**
 * Estimate core-hours for a job as an order-of-magnitude RANGE.
 *
 * This is a labelled heuristic, not a benchmark: it is derived from the
 * method's N-scaling and a reference-size anchor, never from a measured run.
 * Returns null when the method or atoms are unknown, because no honest
 * estimate can be made from missing metadata.
 *
 * @param {Object} config - The GJF configuration.
 * @returns {Object|null}
 */
export function estimateCalculationCost(config) {
  try {
    if (!config || typeof config !== 'object') return null;
    const atoms = Array.isArray(config.atoms) ? config.atoms : [];
    const route = config.route || {};
    const methodKeyword = (route.method || '').trim();
    if (atoms.length === 0 || !methodKeyword) return null;

    const methodDef = getMethodByKeyword(methodKeyword);
    if (!methodDef || !COST_RUNG_MODEL[methodDef.rung]) return null;

    const base = COST_RUNG_MODEL[methodDef.rung];
    const usesPostHfOverride = methodDef.rung === 'post-HF' && Number.isInteger(methodDef.costExponent);
    const rawExponent = usesPostHfOverride ? methodDef.costExponent : base.exponent;
    const rawAnchor = usesPostHfOverride
      ? (POST_HF_ANCHORS[methodDef.costExponent] || base.anchor)
      : base.anchor;

    const [exponentLow, exponentHigh] = normalisePair(rawExponent);
    const [anchorLow, anchorHigh] = normalisePair(rawAnchor);
    const { weight, known: basisKnown } = getBasisWeight(route.basisSet);
    const effectiveAtoms = Math.max(atoms.length * weight, 0.1);
    const [jobLow, jobHigh, jobLabel] = getJobMultiplier(route.jobType);

    let coreHoursLow = toOneSigFig(
      anchorLow * Math.pow(effectiveAtoms / COST_REFERENCE_ATOMS, exponentLow) * jobLow
    );
    let coreHoursHigh = toOneSigFig(
      anchorHigh * Math.pow(effectiveAtoms / COST_REFERENCE_ATOMS, exponentHigh) * jobHigh
    );
    if (coreHoursHigh < coreHoursLow) coreHoursHigh = coreHoursLow;

    const rawCores = Number.parseInt(config.link0?.nproc, 10);
    const cores = Number.isInteger(rawCores) && rawCores > 0 ? rawCores : null;
    const wallHours = cores
      ? {
          low: toOneSigFig(coreHoursLow / cores),
          high: toOneSigFig(coreHoursHigh / cores),
        }
      : null;

    const assumptions = [
      `Reference point: ${COST_REFERENCE_ATOMS} atoms, double-zeta basis, gas-phase single point, one core ` +
      `≈ ${anchorLow}–${anchorHigh} core-hours for a ${methodDef.rung} method. Assumed order of magnitude — not measured.`,
      `Size scaling: ${methodDef.rung} ≈ N^${exponentLow}–N^${exponentHigh}, where N = atoms × basis-size weight ` +
      `(${route.basisSet ? `${route.basisSet} = ${weight}` : 'no external basis = 1'}).`,
      `Job type: ${jobLabel} ≈ ${jobLow}–${jobHigh}× a single point.`,
      'Hardware: one modern CPU core; real throughput varies several-fold between machines, builds and libraries.',
      'Memory/disk: integral storage and SCF workspace grow roughly as N^4; large-basis jobs can hit memory or disk ' +
      'limits and fail before they finish. This estimate does not model either limit.',
      'Excluded: queue wait, SCRF/solvent overhead, symmetry, SCF restarts and convergence failures.',
    ];
    if (!basisKnown) {
      assumptions.push(
        `Basis set "${route.basisSet}" is not in the catalogue; it was treated as double-zeta (weight 1).`
      );
    }
    if (cores) {
      assumptions.push(
        `Wall-clock divides core-hours by ${cores} cores assuming ideal scaling; real parallel efficiency is lower.`
      );
    }

    return {
      kind: 'heuristic-estimate',
      disclaimer:
        'Estimate only — not a benchmark. Order-of-magnitude heuristic from method rung, system size and job type; ' +
        'not a measured or guaranteed runtime.',
      method: methodDef.keyword,
      rung: methodDef.rung,
      atoms: atoms.length,
      cores,
      basisWeight: weight,
      scaling: { low: exponentLow, high: exponentHigh },
      coreHours: { low: coreHoursLow, high: coreHoursHigh },
      wallHours,
      assumptions,
    };
  } catch {
    return null;
  }
}
