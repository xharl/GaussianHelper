/**
 * @fileoverview Periodic table data and lookup utilities for GaussianHelper.
 * Provides element data for the first 54 elements (H through Xe) with
 * accurate IUPAC atomic masses.
 * @module utils/elements
 */

/**
 * @typedef {Object} ElementData
 * @property {string} symbol - Chemical symbol (e.g. 'H', 'He')
 * @property {string} name - Full element name (e.g. 'Hydrogen')
 * @property {number} atomicNumber - Atomic number (proton count)
 * @property {number} mass - Standard atomic weight in amu
 */

/** @type {ElementData[]} */
const elements = [
  { symbol: 'H',  name: 'Hydrogen',      atomicNumber: 1,  mass: 1.00794 },
  { symbol: 'He', name: 'Helium',         atomicNumber: 2,  mass: 4.002602 },
  { symbol: 'Li', name: 'Lithium',        atomicNumber: 3,  mass: 6.941 },
  { symbol: 'Be', name: 'Beryllium',      atomicNumber: 4,  mass: 9.012182 },
  { symbol: 'B',  name: 'Boron',          atomicNumber: 5,  mass: 10.811 },
  { symbol: 'C',  name: 'Carbon',         atomicNumber: 6,  mass: 12.0107 },
  { symbol: 'N',  name: 'Nitrogen',       atomicNumber: 7,  mass: 14.0067 },
  { symbol: 'O',  name: 'Oxygen',         atomicNumber: 8,  mass: 15.9994 },
  { symbol: 'F',  name: 'Fluorine',       atomicNumber: 9,  mass: 18.9984032 },
  { symbol: 'Ne', name: 'Neon',           atomicNumber: 10, mass: 20.1797 },
  { symbol: 'Na', name: 'Sodium',         atomicNumber: 11, mass: 22.98977 },
  { symbol: 'Mg', name: 'Magnesium',      atomicNumber: 12, mass: 24.305 },
  { symbol: 'Al', name: 'Aluminium',      atomicNumber: 13, mass: 26.981538 },
  { symbol: 'Si', name: 'Silicon',        atomicNumber: 14, mass: 28.0855 },
  { symbol: 'P',  name: 'Phosphorus',     atomicNumber: 15, mass: 30.973762 },
  { symbol: 'S',  name: 'Sulfur',         atomicNumber: 16, mass: 32.065 },
  { symbol: 'Cl', name: 'Chlorine',       atomicNumber: 17, mass: 35.453 },
  { symbol: 'Ar', name: 'Argon',          atomicNumber: 18, mass: 39.948 },
  { symbol: 'K',  name: 'Potassium',      atomicNumber: 19, mass: 39.0983 },
  { symbol: 'Ca', name: 'Calcium',        atomicNumber: 20, mass: 40.078 },
  { symbol: 'Sc', name: 'Scandium',       atomicNumber: 21, mass: 44.955912 },
  { symbol: 'Ti', name: 'Titanium',       atomicNumber: 22, mass: 47.867 },
  { symbol: 'V',  name: 'Vanadium',       atomicNumber: 23, mass: 50.9415 },
  { symbol: 'Cr', name: 'Chromium',       atomicNumber: 24, mass: 51.9961 },
  { symbol: 'Mn', name: 'Manganese',      atomicNumber: 25, mass: 54.938045 },
  { symbol: 'Fe', name: 'Iron',           atomicNumber: 26, mass: 55.845 },
  { symbol: 'Co', name: 'Cobalt',         atomicNumber: 27, mass: 58.933195 },
  { symbol: 'Ni', name: 'Nickel',         atomicNumber: 28, mass: 58.6934 },
  { symbol: 'Cu', name: 'Copper',         atomicNumber: 29, mass: 63.546 },
  { symbol: 'Zn', name: 'Zinc',           atomicNumber: 30, mass: 65.38 },
  { symbol: 'Ga', name: 'Gallium',        atomicNumber: 31, mass: 69.723 },
  { symbol: 'Ge', name: 'Germanium',      atomicNumber: 32, mass: 72.64 },
  { symbol: 'As', name: 'Arsenic',        atomicNumber: 33, mass: 74.9216 },
  { symbol: 'Se', name: 'Selenium',       atomicNumber: 34, mass: 78.96 },
  { symbol: 'Br', name: 'Bromine',        atomicNumber: 35, mass: 79.904 },
  { symbol: 'Kr', name: 'Krypton',        atomicNumber: 36, mass: 83.798 },
  { symbol: 'Rb', name: 'Rubidium',       atomicNumber: 37, mass: 85.4678 },
  { symbol: 'Sr', name: 'Strontium',      atomicNumber: 38, mass: 87.62 },
  { symbol: 'Y',  name: 'Yttrium',        atomicNumber: 39, mass: 88.90585 },
  { symbol: 'Zr', name: 'Zirconium',      atomicNumber: 40, mass: 91.224 },
  { symbol: 'Nb', name: 'Niobium',        atomicNumber: 41, mass: 92.90638 },
  { symbol: 'Mo', name: 'Molybdenum',     atomicNumber: 42, mass: 95.96 },
  { symbol: 'Tc', name: 'Technetium',     atomicNumber: 43, mass: 98.0 },
  { symbol: 'Ru', name: 'Ruthenium',      atomicNumber: 44, mass: 101.07 },
  { symbol: 'Rh', name: 'Rhodium',        atomicNumber: 45, mass: 102.9055 },
  { symbol: 'Pd', name: 'Palladium',      atomicNumber: 46, mass: 106.42 },
  { symbol: 'Ag', name: 'Silver',         atomicNumber: 47, mass: 107.8682 },
  { symbol: 'Cd', name: 'Cadmium',        atomicNumber: 48, mass: 112.411 },
  { symbol: 'In', name: 'Indium',         atomicNumber: 49, mass: 114.818 },
  { symbol: 'Sn', name: 'Tin',            atomicNumber: 50, mass: 118.71 },
  { symbol: 'Sb', name: 'Antimony',       atomicNumber: 51, mass: 121.76 },
  { symbol: 'Te', name: 'Tellurium',      atomicNumber: 52, mass: 127.6 },
  { symbol: 'I',  name: 'Iodine',         atomicNumber: 53, mass: 126.90447 },
  { symbol: 'Xe', name: 'Xenon',          atomicNumber: 54, mass: 131.293 },
];

/**
 * Lookup table mapping atomic number to element data.
 * @type {Object<number, ElementData>}
 */
export const elementByNumber = Object.freeze(
  Object.fromEntries(elements.map((el) => [el.atomicNumber, Object.freeze({ ...el })]))
);

/**
 * Lookup table mapping element symbol (case-sensitive) to element data.
 * @type {Object<string, ElementData>}
 */
export const elementBySymbol = Object.freeze(
  Object.fromEntries(elements.map((el) => [el.symbol, Object.freeze({ ...el })]))
);

/**
 * Get the chemical symbol for a given atomic number.
 * @param {number} atomicNumber - The atomic number to look up.
 * @returns {string|null} The element symbol, or null if not found.
 */
export function getSymbol(atomicNumber) {
  const el = elementByNumber[atomicNumber];
  return el ? el.symbol : null;
}

/**
 * Get the atomic number for a given chemical symbol.
 * Performs a case-insensitive lookup by normalising the input to title case.
 * @param {string} symbol - The element symbol to look up (e.g. 'C', 'He', 'he').
 * @returns {number|null} The atomic number, or null if not found.
 */
export function getAtomicNumber(symbol) {
  if (typeof symbol !== 'string' || symbol.length === 0) return null;
  // Normalise to title-case so both 'he' and 'HE' resolve
  const normalised = symbol.charAt(0).toUpperCase() + symbol.slice(1).toLowerCase();
  const el = elementBySymbol[normalised];
  return el ? el.atomicNumber : null;
}

/**
 * Generates a molecular formula using the Hill system notation:
 * Carbon first, then Hydrogen, then all other elements in alphabetical order.
 * If Carbon is not present, all elements are sorted alphabetically.
 * @param {Object[]} atoms - Array of atom objects with symbol property
 * @returns {string} The Hill system molecular formula
 */
export function getHillFormula(atoms) {
  if (!atoms || atoms.length === 0) return 'molecule';
  const counts = {};
  for (const atom of atoms) {
    const sym = atom.symbol;
    counts[sym] = (counts[sym] || 0) + 1;
  }
  
  let formula = '';
  if (counts['C']) {
    formula += `C${counts['C'] > 1 ? counts['C'] : ''}`;
    if (counts['H']) {
      formula += `H${counts['H'] > 1 ? counts['H'] : ''}`;
    }
    const elements = Object.keys(counts).filter(el => el !== 'C' && el !== 'H').sort();
    for (const el of elements) {
      formula += `${el}${counts[el] > 1 ? counts[el] : ''}`;
    }
  } else {
    const elements = Object.keys(counts).sort();
    for (const el of elements) {
      formula += `${el}${counts[el] > 1 ? counts[el] : ''}`;
    }
  }
  return formula;
}
