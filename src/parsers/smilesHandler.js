/**
 * @fileoverview SMILES input handler for GaussianHelper.
 * Validates SMILES strings and generates 3D molecular coordinates
 * via the coordGenerator utility.
 * @module parsers/smilesHandler
 */

import { smilesTo3D } from '../utils/coordGenerator.js';

/**
 * @typedef {Object} SmilesResult
 * @property {Array<{symbol: string, x: number, y: number, z: number}>} atoms
 *   Atom coordinates in Ångströms.
 * @property {string} molfile - MOL file representation with 3D coordinates.
 * @property {string} smiles - The original (cleaned) SMILES string.
 */

/**
 * Characters that are valid in SMILES notation.
 * This is a permissive set — full validation is deferred to OpenChemLib.
 * @type {RegExp}
 */
const SMILES_VALID_CHARS = /^[A-Za-z0-9@+\-\[\]\(\)\\\/=#%.$:~*!]+$/;

/**
 * Process a SMILES string: validate it, generate 3D coordinates, and
 * return the resulting atom list, MOL file, and canonical SMILES.
 *
 * Validation performs two levels of checking:
 * 1. A fast syntactic pre-check (character set, balanced brackets).
 * 2. Full chemical validation via OpenChemLib's SMILES parser.
 *
 * @param {string} smiles - A SMILES string to process.
 * @returns {SmilesResult} The parsed and 3D-optimised molecule data.
 * @throws {Error} If the SMILES string is empty, syntactically invalid,
 *   or chemically unparseable.
 */
export function processSMILES(smiles) {
  // --- Basic input validation ---
  if (!smiles || typeof smiles !== 'string') {
    throw new Error('SMILES input must be a non-empty string.');
  }

  const cleaned = smiles.trim();
  if (cleaned.length === 0) {
    throw new Error('SMILES input must be a non-empty string.');
  }

  // --- Quick syntactic pre-checks ---

  // 1. Character set
  if (!SMILES_VALID_CHARS.test(cleaned)) {
    // Find the offending character for a helpful message
    const invalid = [...cleaned].find((ch) => !SMILES_VALID_CHARS.test(ch));
    throw new Error(
      `SMILES string contains invalid character "${invalid}". ` +
      `Only atoms, bonds, branches, rings, and stereochemistry tokens are allowed.`
    );
  }

  // 2. Balanced square brackets
  let bracketDepth = 0;
  for (const ch of cleaned) {
    if (ch === '[') bracketDepth++;
    if (ch === ']') bracketDepth--;
    if (bracketDepth < 0) {
      throw new Error('SMILES string has an unmatched closing bracket "]".');
    }
  }
  if (bracketDepth !== 0) {
    throw new Error('SMILES string has an unmatched opening bracket "[".');
  }

  // 3. Balanced parentheses
  let parenDepth = 0;
  for (const ch of cleaned) {
    if (ch === '(') parenDepth++;
    if (ch === ')') parenDepth--;
    if (parenDepth < 0) {
      throw new Error('SMILES string has an unmatched closing parenthesis ")".');
    }
  }
  if (parenDepth !== 0) {
    throw new Error('SMILES string has an unmatched opening parenthesis "(".');
  }

  // --- Generate 3D coordinates via OpenChemLib ---
  try {
    const result = smilesTo3D(cleaned);

    if (!result.atoms || result.atoms.length === 0) {
      throw new Error('SMILES produced a molecule with no atoms.');
    }

    return {
      atoms: result.atoms,
      molfile: result.molfile,
      smiles: cleaned,
    };
  } catch (error) {
    // Re-throw with a more descriptive message if it came from OCL
    if (error.message.includes('Invalid SMILES')) {
      throw error; // already descriptive
    }
    throw new Error(
      `Failed to process SMILES "${cleaned}": ${error.message}`
    );
  }
}
