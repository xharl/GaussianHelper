/**
 * @fileoverview 3D coordinate generation using OpenChemLib (OCL).
 * Provides functions to convert SMILES strings and MOL file content into
 * 3D atomic coordinates, with fallback to 2D when 3D generation fails.
 * @module utils/coordGenerator
 */

import OCL from 'openchemlib';

/**
 * @typedef {Object} AtomCoord
 * @property {string} symbol - Element symbol (e.g. 'C', 'H').
 * @property {number} x - X coordinate in Ångströms.
 * @property {number} y - Y coordinate in Ångströms.
 * @property {number} z - Z coordinate in Ångströms.
 */

/**
 * @typedef {Object} CoordResult
 * @property {AtomCoord[]} atoms - Array of atom coordinates.
 * @property {string} molfile - The molecule in MOL V2000 format with 3D coordinates.
 */

/**
 * Extract atom symbols and coordinates from an OCL Molecule object.
 * Assumes coordinates have already been assigned to the molecule.
 *
 * @param {OCL.Molecule} mol - An OCL Molecule instance with coordinates.
 * @returns {AtomCoord[]} Array of atom coordinate objects.
 */
export function moleculeToAtoms(mol) {
  const atoms = [];
  const atomCount = mol.getAllAtoms();

  for (let i = 0; i < atomCount; i++) {
    const atomicNo = mol.getAtomicNo(i);
    const symbol = OCL.Molecule.cAtomLabel[atomicNo] || getSymbolFromAtomicNo(atomicNo);
    atoms.push({
      symbol,
      x: mol.getAtomX(i),
      y: mol.getAtomY(i),
      z: mol.getAtomZ(i),
    });
  }

  return atoms;
}

/**
 * Fallback symbol lookup for atomic numbers not covered by OCL's label table.
 * @param {number} atomicNo - Atomic number.
 * @returns {string} Element symbol or 'X' if unknown.
 */
function getSymbolFromAtomicNo(atomicNo) {
  const table = {
    1: 'H', 2: 'He', 3: 'Li', 4: 'Be', 5: 'B', 6: 'C', 7: 'N', 8: 'O',
    9: 'F', 10: 'Ne', 11: 'Na', 12: 'Mg', 13: 'Al', 14: 'Si', 15: 'P',
    16: 'S', 17: 'Cl', 18: 'Ar', 19: 'K', 20: 'Ca', 26: 'Fe', 29: 'Cu',
    30: 'Zn', 35: 'Br', 53: 'I',
  };
  return table[atomicNo] || 'X';
}

/**
 * Attempt to generate 3D coordinates for an OCL Molecule.
 * Falls back to 2D coordinates (with z = 0) if 3D generation fails.
 *
 * @param {OCL.Molecule} mol - The molecule to generate coordinates for.
 *   Will be modified in place.
 * @returns {{ is3D: boolean }} Whether true 3D coordinates were generated.
 */
function generate3DCoords(mol) {
  try {
    // Ensure the molecule has all implicit hydrogens added
    mol.addImplicitHydrogens();

    // Try using the ConformerGenerator for true 3D coordinates
    const gen = new OCL.ConformerGenerator(4);
    const success = gen.getOneConformerAsMolecule(mol);
    if (success) {
      return { is3D: true };
    }
  } catch (_err) {
    // 3D generation failed; fall through to 2D fallback
  }

  try {
    // Fallback: generate 2D coordinates and set z = 0
    mol.inventCoordinates();
    // Set all z coordinates to 0 (inventCoordinates produces 2D)
    const atomCount = mol.getAllAtoms();
    for (let i = 0; i < atomCount; i++) {
      mol.setAtomZ(i, 0);
    }
    return { is3D: false };
  } catch (err) {
    throw new Error(`Failed to generate any coordinates: ${err.message}`);
  }
}

/**
 * Convert a SMILES string to 3D atomic coordinates.
 *
 * @param {string} smiles - A valid SMILES string.
 * @returns {CoordResult} The atom coordinates and a MOL file string.
 * @throws {Error} If the SMILES string is invalid or coordinate generation fails.
 */
export function smilesTo3D(smiles) {
  if (!smiles || typeof smiles !== 'string' || smiles.trim().length === 0) {
    throw new Error('SMILES string must be a non-empty string.');
  }

  const trimmed = smiles.trim();

  let mol;
  try {
    mol = OCL.Molecule.fromSmiles(trimmed);
  } catch (err) {
    throw new Error(`Invalid SMILES "${trimmed}": ${err.message}`);
  }

  if (mol.getAllAtoms() === 0) {
    throw new Error(`SMILES "${trimmed}" produced a molecule with no atoms.`);
  }

  generate3DCoords(mol);

  const atoms = moleculeToAtoms(mol);
  const molfile = mol.toMolfileV3();

  return { atoms, molfile };
}

/**
 * Convert MOL file content to 3D atomic coordinates.
 * If the MOL file already contains 3D coordinates, they are preserved.
 * Otherwise, 3D coordinates are generated.
 *
 * @param {string} molfileContent - The MOL file content as a string.
 * @returns {CoordResult} The atom coordinates and an updated MOL file string.
 * @throws {Error} If the MOL file is invalid or coordinate generation fails.
 */
export function molTo3D(molfileContent) {
  if (!molfileContent || typeof molfileContent !== 'string' || molfileContent.trim().length === 0) {
    throw new Error('MOL file content must be a non-empty string.');
  }

  let mol;
  try {
    mol = OCL.Molecule.fromMolfile(molfileContent);
  } catch (err) {
    throw new Error(`Invalid MOL file: ${err.message}`);
  }

  if (mol.getAllAtoms() === 0) {
    throw new Error('MOL file produced a molecule with no atoms.');
  }

  // Check if the molecule already has meaningful 3D coordinates
  // by testing whether any atom has a non-zero z coordinate
  let has3D = false;
  const atomCount = mol.getAllAtoms();
  for (let i = 0; i < atomCount; i++) {
    if (Math.abs(mol.getAtomZ(i)) > 1e-6) {
      has3D = true;
      break;
    }
  }

  if (!has3D) {
    generate3DCoords(mol);
  }

  const atoms = moleculeToAtoms(mol);
  const molfile = mol.toMolfileV3();

  return { atoms, molfile };
}
