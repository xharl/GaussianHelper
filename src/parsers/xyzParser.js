/**
 * @fileoverview Parser for the XYZ molecular coordinate format.
 * @module parsers/xyzParser
 */

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
 * - Atomic numbers used in place of symbols (converted via a basic lookup)
 * - Files with fewer atom lines than declared (parses what is available
 *   but warns in a non-fatal way)
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
  const declaredCount = parseInt(countLine, 10);

  if (isNaN(declaredCount) || declaredCount < 0) {
    throw new Error(
      `First line of XYZ file must be the number of atoms, got "${countLine}".`
    );
  }

  // Line 2: title / comment (may be empty)
  const title = (startIdx + 1 < lines.length) ? lines[startIdx + 1].trim() : '';

  // Lines 3+: atom data
  const atoms = [];
  const atomLinesStart = startIdx + 2;
  const atomLinesEnd = Math.min(atomLinesStart + declaredCount, lines.length);

  for (let i = atomLinesStart; i < atomLinesEnd; i++) {
    const line = lines[i].trim();
    if (line === '') continue; // skip blank lines within the block

    const parts = line.split(/\s+/);
    if (parts.length < 4) {
      throw new Error(
        `XYZ atom line ${i - startIdx + 1} has ${parts.length} fields (need ≥ 4): "${line}".`
      );
    }

    let symbol = parts[0];
    const x = parseFloat(parts[1]);
    const y = parseFloat(parts[2]);
    const z = parseFloat(parts[3]);

    // If the symbol looks like a number, treat it as an atomic number
    if (/^\d+$/.test(symbol)) {
      symbol = atomicNumberToSymbol(parseInt(symbol, 10));
    } else {
      // Normalise case: first letter uppercase, rest lowercase
      symbol = symbol.charAt(0).toUpperCase() + symbol.slice(1).toLowerCase();
    }

    if (isNaN(x) || isNaN(y) || isNaN(z)) {
      throw new Error(
        `Invalid coordinates on XYZ line ${i - startIdx + 1}: "${line}".`
      );
    }

    atoms.push({ symbol, x, y, z });
  }

  if (atoms.length === 0) {
    throw new Error('No atom coordinate lines found in XYZ file.');
  }

  return { atoms, title };
}

/**
 * Convert an atomic number to an element symbol (basic inline lookup).
 * @param {number} num - Atomic number.
 * @returns {string} Element symbol, or `"X"` if unknown.
 */
function atomicNumberToSymbol(num) {
  const symbols = [
    '', 'H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne',
    'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar', 'K', 'Ca',
    'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn',
    'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr', 'Rb', 'Sr', 'Y', 'Zr',
    'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd', 'Ag', 'Cd', 'In', 'Sn',
    'Sb', 'Te', 'I', 'Xe',
  ];
  return (num >= 1 && num < symbols.length) ? symbols[num] : 'X';
}
