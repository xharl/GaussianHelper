/**
 * @fileoverview Parser for ChemDraw CDXML (XML) files.
 * Extracts atom coordinates and bond connectivity from the CDXML format.
 * @module parsers/cdxmlParser
 */

import { elementByNumber } from '../utils/elements.js';

/**
 * Scale factor to convert CDXML coordinate units (typographic points,
 * 1/72 inch ≈ 0.353 mm) into a reasonable Ångström-scale coordinate system.
 * CDXML coords are typically in the range of hundreds of points;
 * dividing by ~30 produces bond lengths roughly in the 1–2 Å range.
 * @type {number}
 */
const CDXML_SCALE = 30.0;

/**
 * @typedef {Object} CdxmlAtom
 * @property {number|string} id - Atom identifier from the CDXML node.
 * @property {string} symbol - Element symbol.
 * @property {number} x - X coordinate (scaled to Ångströms).
 * @property {number} y - Y coordinate (scaled to Ångströms).
 * @property {number} z - Z coordinate (always 0 for 2D CDXML).
 */

/**
 * @typedef {Object} CdxmlBond
 * @property {number|string} from - ID of the begin atom.
 * @property {number|string} to - ID of the end atom.
 * @property {number} order - Bond order (1 = single, 2 = double, 3 = triple).
 */

/**
 * @typedef {Object} CdxmlResult
 * @property {CdxmlAtom[]} atoms - Parsed atom data.
 * @property {CdxmlBond[]} bonds - Parsed bond data.
 * @property {string|null} smiles - Always null; SMILES generation is delegated to OpenChemLib.
 */

/**
 * Determine whether a `<n>` node represents a real atom.
 * CDXML node types include text labels, attachment points, etc.
 * Only untyped nodes or those with NodeType="Unspecified"/"GenericNickname"/"Element"
 * are considered atoms.
 *
 * @param {Element} node - A `<n>` DOM element.
 * @returns {boolean}
 */
function isAtomNode(node) {
  const nodeType = node.getAttribute('NodeType');
  if (!nodeType) return true; // default is atom
  const validTypes = new Set([
    'Unspecified',
    'Element',
    'GenericNickname',
    'Fragment',
    '',
  ]);
  return validTypes.has(nodeType);
}

/**
 * Parse a CDXML position string into x and y coordinates.
 * CDXML uses the "p" attribute with space-separated values.
 * Format is typically "x y" (2 values) or "x1 y1 x2 y2" (bounding box).
 *
 * @param {string|null} pAttr - The "p" attribute value.
 * @returns {{ x: number, y: number }} The parsed and scaled coordinates.
 */
function parsePosition(pAttr) {
  if (!pAttr) return { x: 0, y: 0 };
  const parts = pAttr.trim().split(/\s+/).map(Number);
  return {
    x: (parts[0] || 0) / CDXML_SCALE,
    y: (parts[1] || 0) / CDXML_SCALE,
  };
}

/**
 * Parse a ChemDraw CDXML XML string into atom and bond data.
 *
 * CDXML structure:
 * - Root element: `<CDXML>`
 * - Molecules are in `<fragment>` elements
 * - Atoms are `<n>` elements with attributes:
 *   - `id`: unique identifier
 *   - `Element`: atomic number (default 6 for carbon when absent)
 *   - `p`: 2D position as space-separated coordinates in points
 *   - `NodeType`: optional, filters non-atom nodes
 * - Bonds are `<b>` elements with attributes:
 *   - `B`: begin atom ID
 *   - `E`: end atom ID
 *   - `Order`: bond order (default 1)
 *
 * @param {string} xmlString - The complete CDXML file content.
 * @returns {CdxmlResult} Parsed molecule data.
 * @throws {Error} If the XML is malformed or contains no valid atoms.
 */
export function parseCDXML(xmlString) {
  if (!xmlString || typeof xmlString !== 'string' || xmlString.trim().length === 0) {
    throw new Error('CDXML input must be a non-empty string.');
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'application/xml');

  // Check for XML parsing errors
  const parserError = doc.querySelector('parsererror');
  if (parserError) {
    throw new Error(`Malformed CDXML: ${parserError.textContent.slice(0, 200)}`);
  }

  const atoms = [];
  const bonds = [];
  const atomIdSet = new Set();

  // Collect all <n> nodes across all fragments
  const nodeElements = doc.querySelectorAll('n');

  for (const node of nodeElements) {
    if (!isAtomNode(node)) continue;

    const id = node.getAttribute('id');
    if (!id) continue;

    // Element attribute: atomic number, defaults to 6 (carbon) when absent
    const elementAttr = node.getAttribute('Element');
    const atomicNumber = elementAttr ? parseInt(elementAttr, 10) : 6;

    // Look up symbol from our periodic table
    const elData = elementByNumber[atomicNumber];
    const symbol = elData ? elData.symbol : `X${atomicNumber}`;

    // Parse 2D position
    const pos = parsePosition(node.getAttribute('p') || node.getAttribute('2DPosition'));

    atoms.push({
      id,
      symbol,
      x: pos.x,
      y: pos.y,
      z: 0,
    });

    atomIdSet.add(id);
  }

  // Collect all <b> (bond) nodes
  const bondElements = doc.querySelectorAll('b');

  for (const bond of bondElements) {
    const beginId = bond.getAttribute('B');
    const endId = bond.getAttribute('E');

    if (!beginId || !endId) continue;

    // Only include bonds that reference atoms we actually parsed
    if (!atomIdSet.has(beginId) || !atomIdSet.has(endId)) continue;

    const orderAttr = bond.getAttribute('Order');
    const order = orderAttr ? parseInt(orderAttr, 10) : 1;

    bonds.push({
      from: beginId,
      to: endId,
      order: isNaN(order) ? 1 : order,
    });
  }

  if (atoms.length === 0) {
    throw new Error('No valid atoms found in CDXML file. Ensure the file contains <n> elements within <fragment> elements.');
  }

  return {
    atoms,
    bonds,
    smiles: null, // SMILES generation is deferred to OpenChemLib
  };
}
