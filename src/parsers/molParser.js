/**
 * @fileoverview Parser for MDL MOL V2000 and SDF file formats.
 * Extracts atom coordinates, element symbols, and bond connectivity.
 * @module parsers/molParser
 */

/**
 * @typedef {Object} MolAtom
 * @property {string} symbol - Element symbol.
 * @property {number} x - X coordinate in Ångströms.
 * @property {number} y - Y coordinate in Ångströms.
 * @property {number} z - Z coordinate in Ångströms.
 */

/**
 * @typedef {Object} MolBond
 * @property {number} from - 1-based index of the first atom.
 * @property {number} to - 1-based index of the second atom.
 * @property {number} order - Bond order (1=single, 2=double, 3=triple, etc.).
 */

/**
 * @typedef {Object} MolResult
 * @property {MolAtom[]} atoms - Parsed atom data.
 * @property {MolBond[]} bonds - Parsed bond data.
 * @property {string} name - Molecule name from the header.
 */

/**
 * Parse a MOL V2000 format string into atoms and bonds.
 *
 * MOL V2000 layout:
 * ```
 * Line 1:  Molecule name
 * Line 2:  Program/timestamp info
 * Line 3:  Comment
 * Line 4:  Counts line — aaabbblllfffcccsssxxxrrrpppiiimmmvvvvvv
 *          aaa = #atoms (cols 1-3), bbb = #bonds (cols 4-6)
 * Lines 5..(4+aaa):  Atom block
 *          xxxxx.xxxxyyyyy.yyyyzzzzz.zzzz aaaddcccssshhhbbbvvvHHHrrriiimmmnnneee
 *          x (cols 1-10), y (cols 11-20), z (cols 21-30), symbol (cols 31-33)
 * Lines (5+aaa)..(4+aaa+bbb):  Bond block
 *          111222tttsssxxxrrrccc
 *          atom1 (cols 1-3), atom2 (cols 4-6), type (cols 7-9)
 * ...
 * M  END
 * ```
 *
 * @param {string} content - The MOL file content.
 * @returns {MolResult} Parsed molecule data.
 * @throws {Error} If the format is invalid or unreadable.
 */
export function parseMOL(content) {
  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('MOL file content must be a non-empty string.');
  }

  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  if (lines.length < 5) {
    throw new Error('MOL file is too short — at least 5 lines are required (header + counts + M END).');
  }

  // Header
  const name = lines[0].trim();

  // Counts line (line index 3)
  const countsLine = lines[3];
  if (countsLine.length < 6) {
    throw new Error('Invalid counts line in MOL file (line 4 is too short).');
  }

  const numAtoms = parseInt(countsLine.substring(0, 3).trim(), 10);
  const numBonds = parseInt(countsLine.substring(3, 6).trim(), 10);

  if (isNaN(numAtoms) || numAtoms < 0) {
    throw new Error(`Invalid atom count "${countsLine.substring(0, 3).trim()}" in MOL counts line.`);
  }
  if (isNaN(numBonds) || numBonds < 0) {
    throw new Error(`Invalid bond count "${countsLine.substring(3, 6).trim()}" in MOL counts line.`);
  }

  // Check we have enough lines for the declared atoms and bonds
  const requiredLines = 4 + numAtoms + numBonds;
  if (lines.length < requiredLines) {
    throw new Error(
      `MOL file declares ${numAtoms} atoms and ${numBonds} bonds but has only ${lines.length} lines ` +
      `(need at least ${requiredLines}).`
    );
  }

  // Parse atom block
  const atoms = [];
  for (let i = 0; i < numAtoms; i++) {
    const line = lines[4 + i];
    if (line.length < 34) {
      throw new Error(`Atom line ${i + 1} is too short (${line.length} chars, need ≥ 34).`);
    }

    const x = parseFloat(line.substring(0, 10).trim());
    const y = parseFloat(line.substring(10, 20).trim());
    const z = parseFloat(line.substring(20, 30).trim());
    const symbol = line.substring(30, 34).trim();

    if (isNaN(x) || isNaN(y) || isNaN(z)) {
      throw new Error(`Invalid coordinates on atom line ${i + 1}: "${line.substring(0, 30)}".`);
    }
    if (!symbol) {
      throw new Error(`Missing element symbol on atom line ${i + 1}.`);
    }

    atoms.push({ symbol, x, y, z });
  }

  // Parse bond block
  const bonds = [];
  for (let i = 0; i < numBonds; i++) {
    const line = lines[4 + numAtoms + i];
    if (line.length < 9) {
      throw new Error(`Bond line ${i + 1} is too short (${line.length} chars, need ≥ 9).`);
    }

    const from = parseInt(line.substring(0, 3).trim(), 10);
    const to = parseInt(line.substring(3, 6).trim(), 10);
    const order = parseInt(line.substring(6, 9).trim(), 10);

    if (isNaN(from) || isNaN(to)) {
      throw new Error(`Invalid atom indices on bond line ${i + 1}: "${line.substring(0, 6)}".`);
    }
    if (from < 1 || from > numAtoms || to < 1 || to > numAtoms) {
      throw new Error(
        `Bond line ${i + 1} references atom ${from} or ${to}, ` +
        `but only ${numAtoms} atoms are defined.`
      );
    }

    bonds.push({
      from,
      to,
      order: isNaN(order) ? 1 : order,
    });
  }

  return { atoms, bonds, name };
}

/**
 * Parse an SDF (Structure-Data File) and extract the first molecule.
 *
 * SDF files contain one or more MOL blocks, each terminated by a line of
 * `$$$$`.  This function extracts and parses only the first molecule.
 *
 * @param {string} content - The SDF file content.
 * @returns {MolResult} Parsed molecule data (first entry only).
 * @throws {Error} If the format is invalid or no molecule is found.
 */
export function parseSDF(content) {
  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('SDF file content must be a non-empty string.');
  }

  // Find the first $$$$ delimiter or M  END marker
  const delimiter = '$$$$';
  const delimiterIndex = content.indexOf(delimiter);

  let molBlock;
  if (delimiterIndex !== -1) {
    molBlock = content.substring(0, delimiterIndex);
  } else {
    // No $$$$ found — treat the entire content as a single MOL block
    molBlock = content;
  }

  // Trim any trailing data properties (lines after M  END but before $$$$)
  const mEndIndex = molBlock.indexOf('M  END');
  if (mEndIndex !== -1) {
    molBlock = molBlock.substring(0, mEndIndex + 'M  END'.length);
  }

  return parseMOL(molBlock);
}
