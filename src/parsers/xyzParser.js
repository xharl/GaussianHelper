/**
 * @fileoverview Parser for the XYZ molecular coordinate format.
 * @module parsers/xyzParser
 */

import { getSymbol, getAtomicNumber } from '../utils/elements.js';

/**
 * @typedef {Object} XyzAtom
 * @property {string} symbol - Element symbol.
 * @property {number} x - X coordinate in Ångströms.
 * @property {number} y - Y coordinate in Ångströms.
 * @property {number} z - Z coordinate in Ångströms.
 */

/**
 * @typedef {Object} XyzResult
 * @property {XyzAtom[]} atoms - Array of parsed atom data.
 * @property {string} title - The title/comment from line 2 of the file.
 */

/**
 * Parse an XYZ-format coordinate string.
 *
 * XYZ format:
 * ```
 * N                          ← number of atoms
 * Title / comment line       ← arbitrary text
 * Symbol  x  y  z           ← one line per atom
 * Symbol  x  y  z
 * ...
 * ```
 *
 * The parser is tolerant of:
 * - Leading/trailing whitespace and blank lines
 * - Mixed tab/space delimiters
 * - Atomic numbers used in place of symbols (converted via the periodic table)
 * - Blank lines between atom records
 * - A complete set of atom records matching the declared count is required
 *
 * @param {string} content - The XYZ file content.
 * @returns {XyzResult} Parsed atom coordinates and title.
 * @throws {Error} If the content is empty or the header is unparseable.
 */
export function parseXYZ(content) {
  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('XYZ file content must be a non-empty string.');
  }

  const lines = content
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n');

  // Strip leading blank lines
  let startIdx = 0;
  while (startIdx < lines.length && lines[startIdx].trim() === '') {
    startIdx++;
  }

  if (startIdx >= lines.length) {
    throw new Error('XYZ file contains no non-blank lines.');
  }

  // Line 1: atom count
  const countLine = lines[startIdx].trim();
  const declaredCount = Number(countLine);

  if (!/^\d+$/.test(countLine) || !Number.isSafeInteger(declaredCount) || declaredCount < 1) {
    throw new Error(
      `First line of XYZ file must be a positive integer atom count, got "${countLine}".`
    );
  }

  // Line 2: title / comment (may be empty)
  const title = (startIdx + 1 < lines.length) ? lines[startIdx + 1].trim() : '';

  // Lines 3+: read declared atom records, ignoring blank lines between them.
  const atoms = [];
  let i = startIdx + 2;
  while (i < lines.length && atoms.length < declaredCount) {
    const line = lines[i].trim();
    i++;
    if (line === '') continue;

    const parts = line.split(/\s+/);
    if (parts.length < 4) {
      throw new Error(
        `XYZ atom line ${i - startIdx} has ${parts.length} fields (need ≥ 4): "${line}".`
      );
    }

    const rawSymbol = parts[0];
    let symbol;
    if (/^\d+$/.test(rawSymbol)) {
      symbol = getSymbol(Number(rawSymbol));
    } else {
      symbol = rawSymbol.charAt(0).toUpperCase() + rawSymbol.slice(1).toLowerCase();
    }

    if (!symbol || getAtomicNumber(symbol) === null) {
      throw new Error(`Unknown element in XYZ atom line ${i - startIdx}: "${rawSymbol}".`);
    }

    const coordinates = parts.slice(1, 4).map(Number);
    if (!coordinates.every(Number.isFinite)) {
      throw new Error(
        `Invalid coordinates on XYZ line ${i - startIdx}: "${line}".`
      );
    }

    atoms.push({ symbol, x: coordinates[0], y: coordinates[1], z: coordinates[2] });
  }

  if (atoms.length !== declaredCount) {
    throw new Error(
      `XYZ file declares ${declaredCount} atoms but only found ${atoms.length}.`
    );
  }

  return { atoms, title };
}
