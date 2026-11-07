/**
 * @fileoverview Conformer ensemble generation and Boltzmann ranking.
 *
 * The app used to ship exactly one 3D conformer. For flexible molecules that
 * choice silently determines the reported energy, so this module generates a
 * small ensemble, minimises every member with MMFF94, removes duplicates by
 * heavy-atom RMSD, and reports the Boltzmann population of each retained
 * conformer at 298.15 K.
 *
 * Everything here is deterministic for a given seed. No energy or population
 * is ever estimated: when MMFF94 cannot type the molecule (or the minimisation
 * fails to converge) the conformer keeps `energyKcal: null` and populations are
 * withheld for the whole ensemble.
 *
 * Tautomer/protomer enumeration is intentionally absent: OpenChemLib 9.22 has
 * no tautomer generator (only canonicalisation flags), so shipping one would
 * mean hand-rolling chemistry this project cannot verify. The ensemble follows
 * the structure exactly as entered.
 *
 * @module utils/conformerEnsemble
 */

import OCL from 'openchemlib';
import { ensureChemResources } from './chemResources.js';
import { moleculeToAtoms } from './coordGenerator.js';
import {
  CONFORMER_METHOD,
  MAX_CONFORMER_COUNT,
  createConformerMetadata,
} from './conformerMetadata.js';

/** Default number of conformers requested. */
export const DEFAULT_CONFORMER_LIMIT = 10;

/** Hard cap, independent of what the caller asks for. */
export const MAX_CONFORMER_LIMIT = MAX_CONFORMER_COUNT;

/** Default heavy-atom RMSD below which two conformers are duplicates (Å). */
export const DEFAULT_RMSD_THRESHOLD = 0.5;

/** Reference temperature for Boltzmann populations (K). */
export const BOLTZMANN_TEMPERATURE_K = 298.15;

/** Boltzmann constant in kcal/(mol·K). */
export const GAS_CONSTANT_KCAL_PER_MOL_K = 0.0019872041;

/** Ensemble spread above which the UI warns that the value is conformer-dependent. */
export const ENSEMBLE_SPREAD_WARNING_KCAL = 2;

const DEFAULT_SEED = 42;

/**
 * @typedef {Object} ConformerRecord
 * @property {number} index - Zero-based rank (energy ascending).
 * @property {number|null} energyKcal - MMFF94 energy, or null when unavailable.
 * @property {number|null} relativeKcal - Energy above the lowest conformer.
 * @property {number|null} population - Boltzmann population at 298.15 K.
 * @property {number} rmsdToLowest - Heavy-atom RMSD to the lowest conformer (Å).
 * @property {number} heavyAtomCount
 * @property {Array<{symbol: string, x: number, y: number, z: number}>} atoms
 * @property {string} molfile - MOL V3000 text for the 3D viewer.
 * @property {import('./conformerMetadata.js').ConformerMetadata} metadata
 */

/**
 * @typedef {Object} ConformerEnsemble
 * @property {ConformerRecord[]} conformers - Retained, energy-sorted conformers.
 * @property {number} generatedCount - Conformers delivered by the generator.
 * @property {number} retainedCount - Conformers left after RMSD pruning.
 * @property {number} requestedCount - Limit the caller asked for.
 * @property {number|null} spreadKcal - Highest minus lowest retained energy.
 * @property {number} temperatureK
 * @property {'MMFF94'} method
 * @property {boolean} energyAvailable - False when any energy is unavailable.
 * @property {string[]} warnings - Human-readable, already user-facing.
 */

/**
 * Clamp a requested conformer count into the supported range.
 *
 * @param {unknown} value
 * @returns {number}
 */
export function normalizeConformerLimit(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_CONFORMER_LIMIT;
  return Math.max(1, Math.min(MAX_CONFORMER_LIMIT, Math.trunc(numeric)));
}

/**
 * Compute Boltzmann populations for a list of energies.
 *
 * Energies are in kcal/mol and are shifted by the minimum before exponentiation
 * so the largest weight is always 1. Returns nulls (never guesses) when an
 * energy is missing or the normalisation is degenerate.
 *
 * @param {Array<number|null>} energies
 * @param {number} [temperatureK=BOLTZMANN_TEMPERATURE_K]
 * @returns {Array<number|null>}
 */
export function boltzmannPopulations(energies, temperatureK = BOLTZMANN_TEMPERATURE_K) {
  if (!Array.isArray(energies) || energies.length === 0) return [];
  if (!Number.isFinite(temperatureK) || temperatureK <= 0) return energies.map(() => null);
  if (!energies.every(value => typeof value === 'number' && Number.isFinite(value))) {
    return energies.map(() => null);
  }
  const lowest = Math.min(...energies);
  const kT = GAS_CONSTANT_KCAL_PER_MOL_K * temperatureK;
  if (!Number.isFinite(kT) || kT <= 0) return energies.map(() => null);
  const weights = energies.map(energy => Math.exp(-(energy - lowest) / kT));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (!Number.isFinite(total) || total <= 0) return energies.map(() => null);
  return weights.map(weight => weight / total);
}

function isHeavy(atom) {
  return atom && atom.symbol && atom.symbol !== 'H' && atom.symbol !== 'D' && atom.symbol !== 'T';
}

function centroid(points) {
  const sum = points.reduce((acc, point) => ({
    x: acc.x + point.x,
    y: acc.y + point.y,
    z: acc.z + point.z,
  }), { x: 0, y: 0, z: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length, z: sum.z / points.length };
}

/**
 * Jacobi eigen-decomposition of a small symmetric matrix.
 * Returns eigenvalues and the matching eigenvector (largest first).
 */
function largestEigenpair(matrix) {
  const n = matrix.length;
  const a = matrix.map(row => [...row]);
  const vectors = Array.from({ length: n }, (_, row) =>
    Array.from({ length: n }, (_, column) => (row === column ? 1 : 0)));

  for (let sweep = 0; sweep < 100; sweep += 1) {
    let offDiagonal = 0;
    for (let p = 0; p < n; p += 1) {
      for (let q = p + 1; q < n; q += 1) offDiagonal += a[p][q] * a[p][q];
    }
    if (offDiagonal < 1e-20) break;

    for (let p = 0; p < n; p += 1) {
      for (let q = p + 1; q < n; q += 1) {
        if (Math.abs(a[p][q]) < 1e-15) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const sign = theta >= 0 ? 1 : -1;
        const t = sign / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        const app = a[p][p];
        const aqq = a[q][q];
        const apq = a[p][q];

        a[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq;
        a[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq;
        a[p][q] = 0;
        a[q][p] = 0;

        for (let k = 0; k < n; k += 1) {
          if (k === p || k === q) continue;
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[p][k] = a[k][p];
          a[k][q] = s * akp + c * akq;
          a[q][k] = a[k][q];
        }
        for (let k = 0; k < n; k += 1) {
          const vkp = vectors[k][p];
          const vkq = vectors[k][q];
          vectors[k][p] = c * vkp - s * vkq;
          vectors[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }

  let best = 0;
  for (let i = 1; i < n; i += 1) {
    if (a[i][i] > a[best][best]) best = i;
  }
  return {
    value: a[best][best],
    vector: vectors.map(row => row[best]),
  };
}

/**
 * Heavy-atom RMSD between two atom lists after optimal superposition
 * (Kabsch/Horn quaternion method, proper rotations only).
 *
 * Both lists are filtered to heavy atoms in order, so conformers of the same
 * molecule compare atom-to-atom. Mismatched atom counts or elements return
 * Infinity rather than a misleadingly small number.
 *
 * @param {Array<{symbol: string, x: number, y: number, z: number}>} atomsA
 * @param {Array<{symbol: string, x: number, y: number, z: number}>} atomsB
 * @returns {number} RMSD in Ångströms.
 */
export function heavyAtomRmsd(atomsA, atomsB) {
  const a = (Array.isArray(atomsA) ? atomsA : []).filter(isHeavy);
  const b = (Array.isArray(atomsB) ? atomsB : []).filter(isHeavy);
  if (a.length === 0 || a.length !== b.length) return Infinity;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].symbol !== b[i].symbol) return Infinity;
    if (!Number.isFinite(a[i].x) || !Number.isFinite(a[i].y) || !Number.isFinite(a[i].z)) return Infinity;
    if (!Number.isFinite(b[i].x) || !Number.isFinite(b[i].y) || !Number.isFinite(b[i].z)) return Infinity;
  }
  if (a.length === 1) return 0;

  const centerA = centroid(a);
  const centerB = centroid(b);

  // Correlation matrix S[a][b] = sum over atoms of p_a * q_b (centred).
  const s = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < a.length; i += 1) {
    const p = [a[i].x - centerA.x, a[i].y - centerA.y, a[i].z - centerA.z];
    const q = [b[i].x - centerB.x, b[i].y - centerB.y, b[i].z - centerB.z];
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) s[row][column] += p[row] * q[column];
    }
  }

  const [sxx, sxy, sxz] = s[0];
  const [syx, syy, syz] = s[1];
  const [szx, szy, szz] = s[2];

  const horn = [
    [sxx + syy + szz, syz - szy, szx - sxz, sxy - syx],
    [syz - szy, sxx - syy - szz, sxy + syx, szx + sxz],
    [szx - sxz, sxy + syx, -sxx + syy - szz, syz + szy],
    [sxy - syx, szx + sxz, syz + szy, -sxx - syy + szz],
  ];

  const { vector } = largestEigenpair(horn);
  const norm = Math.hypot(vector[0], vector[1], vector[2], vector[3]) || 1;
  const [w, x, y, z] = vector.map(value => value / norm);

  const rotation = [
    [w * w + x * x - y * y - z * z, 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), w * w - x * x + y * y - z * z, 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), w * w - x * x - y * y + z * z],
  ];

  let sumSquares = 0;
  for (let i = 0; i < a.length; i += 1) {
    const p = [a[i].x - centerA.x, a[i].y - centerA.y, a[i].z - centerA.z];
    const q = [b[i].x - centerB.x, b[i].y - centerB.y, b[i].z - centerB.z];
    for (let row = 0; row < 3; row += 1) {
      const rotated = rotation[row][0] * p[0] + rotation[row][1] * p[1] + rotation[row][2] * p[2];
      const delta = rotated - q[row];
      sumSquares += delta * delta;
    }
  }
  return Math.sqrt(sumSquares / a.length);
}

/**
 * Minimise a conformer with MMFF94 and read its energy.
 *
 * `mol` is mutated in place (that is what minimisation means). A non-zero
 * return code or a non-finite energy is treated as "energy unavailable":
 * reporting it would silently turn an unparameterised atom into 0.0 kcal/mol.
 *
 * @param {OCL.Molecule} mol
 * @returns {{ energyKcal: number|null, reason: string|null }}
 */
export function minimiseConformerEnergy(mol) {
  try {
    const forceField = new OCL.ForceFieldMMFF94(mol, CONFORMER_METHOD);
    const code = forceField.minimise();
    const energy = forceField.getTotalEnergy();
    if (code !== 0) {
      return { energyKcal: null, reason: `MMFF94 minimisation did not converge (code ${code})` };
    }
    if (!Number.isFinite(energy)) {
      return { energyKcal: null, reason: 'MMFF94 returned a non-finite energy' };
    }
    return { energyKcal: energy, reason: null };
  } catch (error) {
    const detail = String(error?.message || error || '').split('\n')[0].slice(0, 160);
    return { energyKcal: null, reason: `MMFF94 energy unavailable: ${detail}` };
  }
}

/**
 * Build the user-facing warnings for an ensemble summary.
 *
 * @param {{ spreadKcal: number|null, energyFailures: number, generatedCount: number, requestedCount: number }} summary
 * @returns {string[]}
 */
export function buildEnsembleWarnings({ spreadKcal, energyFailures = 0, generatedCount = 0 }) {
  const warnings = [];
  if (energyFailures > 0) {
    warnings.push(
      `MMFF94 energy is unavailable for ${energyFailures} of ${generatedCount} generated conformer(s); `
      + 'populations and relative energies are not reported for this ensemble.',
    );
  }
  if (typeof spreadKcal === 'number' && Number.isFinite(spreadKcal)
    && spreadKcal > ENSEMBLE_SPREAD_WARNING_KCAL) {
    warnings.push(
      `ensemble spread ${spreadKcal.toFixed(2)} kcal/mol — the reported value depends on conformer choice`,
    );
  }
  return warnings;
}

/**
 * Informational notes (not warnings) about the ensemble size.
 *
 * @param {{ generatedCount: number, requestedCount: number }} summary
 * @returns {string[]}
 */
export function buildEnsembleNotes({ generatedCount = 0, requestedCount = 0 }) {
  if (generatedCount > 1 && generatedCount < requestedCount) {
    return [`Only ${generatedCount} conformers were available from the generator (requested ${requestedCount}).`];
  }
  return [];
}

function resolveMolecule(input) {
  if (typeof input === 'string') {
    const text = input.trim();
    if (!text) throw new Error('A SMILES string or MOL file is required.');
    return /\bM\s+END\b/.test(text)
      ? OCL.Molecule.fromMolfile(text)
      : OCL.Molecule.fromSmiles(text);
  }
  if (input && typeof input.getAllAtoms === 'function') {
    return typeof input.getCompactCopy === 'function' ? input.getCompactCopy() : input;
  }
  if (input && typeof input === 'object' && typeof input.smiles === 'string') {
    return OCL.Molecule.fromSmiles(input.smiles);
  }
  if (input && typeof input === 'object' && typeof input.molfile === 'string') {
    return OCL.Molecule.fromMolfile(input.molfile);
  }
  throw new Error('Unsupported molecule input; pass SMILES, a MOL file, or an OCL molecule.');
}

function emptyEnsemble(requestedCount, warnings) {
  return {
    conformers: [],
    generatedCount: 0,
    retainedCount: 0,
    requestedCount,
    spreadKcal: null,
    temperatureK: BOLTZMANN_TEMPERATURE_K,
    method: CONFORMER_METHOD,
    energyAvailable: false,
    warnings,
    notes: [],
  };
}

/**
 * Generate, minimise, prune and Boltzmann-rank a conformer ensemble.
 *
 * @param {string|OCL.Molecule|{smiles?: string, molfile?: string}} input
 * @param {Object} [options]
 * @param {number} [options.count=10] - Requested conformers (capped at 50).
 * @param {number} [options.seed=42] - Conformer generator seed.
 * @param {number} [options.rmsdThreshold=0.5] - Duplicate pruning threshold (Å).
 * @param {number} [options.maxTorsionSets] - Generator torsion-set budget.
 * @param {(mol: OCL.Molecule) => { energyKcal: number|null, reason?: string|null }} [options.energyFn]
 *   Injectable minimiser, used by tests to exercise the unavailable-energy path.
 * @returns {ConformerEnsemble}
 */
export function generateConformerEnsemble(input, options = {}) {
  const requestedCount = normalizeConformerLimit(options.count ?? DEFAULT_CONFORMER_LIMIT);
  const threshold = Number.isFinite(options.rmsdThreshold) && options.rmsdThreshold >= 0
    ? options.rmsdThreshold
    : DEFAULT_RMSD_THRESHOLD;
  const seed = Number.isInteger(options.seed) ? options.seed : DEFAULT_SEED;
  const energyFn = typeof options.energyFn === 'function' ? options.energyFn : minimiseConformerEnergy;

  if (!ensureChemResources()) {
    return emptyEnsemble(requestedCount, [
      'OpenChemLib force-field resources are unavailable in this build; conformers cannot be ranked.',
    ]);
  }

  let mol;
  try {
    mol = resolveMolecule(input);
  } catch (error) {
    return emptyEnsemble(requestedCount, [`Could not read the molecule: ${String(error?.message || error)}`]);
  }
  if (!mol || mol.getAllAtoms() === 0) {
    return emptyEnsemble(requestedCount, ['The molecule has no atoms.']);
  }

  const generator = new OCL.ConformerGenerator(seed);
  let initialized = false;
  try {
    mol.addImplicitHydrogens();
    initialized = generator.initializeConformers(mol, {
      strategy: OCL.ConformerGenerator.STRATEGY_LIKELY_SYSTEMATIC,
      maxTorsionSets: options.maxTorsionSets ?? Math.min(200, Math.max(20, requestedCount * 8)),
      use60degreeSteps: true,
    });
  } catch (error) {
    return emptyEnsemble(requestedCount, [
      `Conformer generation failed: ${String(error?.message || error).split('\n')[0]}`,
    ]);
  }
  if (!initialized) {
    return emptyEnsemble(requestedCount, ['Conformer generation failed for this molecule.']);
  }

  const candidates = [];
  let generatedCount = 0;
  let generatedEnergyFailures = 0;

  for (let i = 0; i < requestedCount; i += 1) {
    let conformer = null;
    try {
      conformer = generator.getNextConformerAsMolecule();
    } catch (error) {
      return emptyEnsemble(requestedCount, [
        `Conformer generation failed: ${String(error?.message || error).split('\n')[0]}`,
      ]);
    }
    if (!conformer) break;

    generatedCount += 1;
    const result = energyFn(conformer) || {};
    const energyKcal = typeof result.energyKcal === 'number' && Number.isFinite(result.energyKcal)
      ? result.energyKcal
      : null;
    if (energyKcal === null) {
      generatedEnergyFailures += 1;
    }
    candidates.push({
      mol: conformer,
      atoms: moleculeToAtoms(conformer),
      energyKcal,
      reason: energyKcal === null ? (result.reason || 'MMFF94 energy unavailable') : null,
    });
  }

  // Keep the lowest-energy representative of each geometry cluster. Sorting by
  // energy first means the retained row is always the most stable duplicate.
  if (candidates.length === 0) {
    return emptyEnsemble(requestedCount, ['Conformer generation produced no structures for this molecule.']);
  }

  const ordered = [...candidates].sort((a, b) => {
    const energyA = a.energyKcal ?? Number.POSITIVE_INFINITY;
    const energyB = b.energyKcal ?? Number.POSITIVE_INFINITY;
    if (energyA !== energyB) return energyA - energyB;
    return 0;
  });

  const retained = [];
  for (const candidate of ordered) {
    const duplicate = retained.some(kept => heavyAtomRmsd(candidate.atoms, kept.atoms) <= threshold);
    if (!duplicate) retained.push(candidate);
  }

  retained.sort((a, b) => {
    const energyA = a.energyKcal ?? Number.POSITIVE_INFINITY;
    const energyB = b.energyKcal ?? Number.POSITIVE_INFINITY;
    return energyA === energyB ? 0 : energyA - energyB;
  });

  const finiteEnergies = retained
    .map(candidate => candidate.energyKcal)
    .filter(energy => typeof energy === 'number' && Number.isFinite(energy));

  // A conformer whose energy failed only disqualifies the ranking if it
  // survived deduplication; a pruned duplicate cannot widen the ensemble.
  const energyFailures = retained.filter(candidate => candidate.energyKcal === null).length;
  const prunedEnergyFailures = generatedEnergyFailures - energyFailures;
  const rankingAvailable = energyFailures === 0 && finiteEnergies.length === retained.length;
  const lowest = rankingAvailable ? Math.min(...finiteEnergies) : null;
  const spreadKcal = rankingAvailable
    ? (finiteEnergies.length > 1 ? Math.max(...finiteEnergies) - lowest : 0)
    : null;
  const populations = rankingAvailable
    ? boltzmannPopulations(retained.map(candidate => candidate.energyKcal))
    : retained.map(() => null);

  const lowestAtoms = retained[0]?.atoms ?? null;
  const conformers = retained.map((candidate, index) => {
    const energyKcal = candidate.energyKcal;
    const relativeKcal = rankingAvailable && energyKcal !== null ? energyKcal - lowest : null;
    const population = populations[index] ?? null;
    return {
      index,
      energyKcal,
      relativeKcal,
      population,
      rmsdToLowest: lowestAtoms ? heavyAtomRmsd(candidate.atoms, lowestAtoms) : 0,
      heavyAtomCount: candidate.atoms.filter(isHeavy).length,
      atoms: candidate.atoms,
      molfile: candidate.mol.toMolfileV3(),
      metadata: createConformerMetadata({
        index,
        energyKcal,
        relativeKcal,
        population,
        ensembleSpreadKcal: spreadKcal,
        method: CONFORMER_METHOD,
        generatedCount,
        retainedCount: retained.length,
      }),
    };
  });

  const warnings = buildEnsembleWarnings({
    spreadKcal,
    energyFailures,
    generatedCount,
  });
  const retainedFailure = retained.find(candidate => candidate.energyKcal === null);
  if (retainedFailure?.reason) warnings.unshift(retainedFailure.reason);

  const notes = buildEnsembleNotes({ generatedCount, requestedCount });
  if (prunedEnergyFailures > 0) {
    notes.push(`${prunedEnergyFailures} generated conformer(s) without an MMFF94 energy were pruned as duplicate geometries.`);
  }

  return {
    conformers,
    generatedCount,
    retainedCount: conformers.length,
    requestedCount,
    spreadKcal,
    temperatureK: BOLTZMANN_TEMPERATURE_K,
    method: CONFORMER_METHOD,
    energyAvailable: energyFailures === 0 && conformers.length > 0,
    warnings,
    notes,
  };
}
