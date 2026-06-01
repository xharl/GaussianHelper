/**
 * @fileoverview Validation utilities for Gaussian calculation input.
 * Checks charge/multiplicity consistency, method/basis compatibility,
 * and overall input completeness.
 * @module utils/validation
 */

import { getAtomicNumber } from './elements.js';

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
        }
        if (typeof atom.x !== 'number' || typeof atom.y !== 'number' || typeof atom.z !== 'number') {
          errors.push(`Atom ${i + 1} (${atom.symbol || '?'}): missing or invalid coordinates.`);
        }
      }

      // Cross-validate charge/multiplicity against atoms if we have valid values
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
