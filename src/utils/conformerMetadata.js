/**
 * @fileoverview Validation for the conformer provenance block stored in a
 * Gaussian configuration / workflow task.
 *
 * The metadata is deliberately numeric-only: it records which conformer was
 * chosen from a generated ensemble, what MMFF94 said about it, and how wide
 * the ensemble was. It never carries coordinates (those live in `atoms`) and
 * it never carries free-form log text, so a workflow project file stays small
 * and bounded.
 *
 * Invariants:
 * - `method` is the force field that produced the energies.
 * - `index` refers to the retained (post-prune, energy-sorted) list.
 * - When `energyKcal` is null the energy was unavailable, so `relativeKcal`
 *   and `population` must also be null. Nothing is invented.
 *
 * @module utils/conformerMetadata
 */

/** Force field used to rank the ensemble. */
export const CONFORMER_METHOD = 'MMFF94';

/** Hard cap on generated/retained conformers (mirrors the generator cap). */
export const MAX_CONFORMER_COUNT = 50;

/** Sanity bound for any kcal/mol value written into a project file. */
export const MAX_ABS_KCAL = 1e6;

/**
 * @typedef {Object} ConformerMetadata
 * @property {number} index - Zero-based position in the retained ensemble.
 * @property {number|null} energyKcal - MMFF94 energy in kcal/mol, or null.
 * @property {number|null} relativeKcal - Energy above the lowest conformer.
 * @property {number|null} population - Boltzmann population at 298.15 K (0..1).
 * @property {number|null} ensembleSpreadKcal - Highest minus lowest energy.
 * @property {'MMFF94'} method - Force field used for ranking.
 * @property {number} generatedCount - Conformers delivered by the generator.
 * @property {number} retainedCount - Conformers left after RMSD pruning.
 */

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNullish(value) {
  return value === null || value === undefined;
}

/**
 * Validate a conformer provenance block.
 *
 * @param {unknown} value
 * @returns {string[]} Human-readable problems; empty when valid.
 */
export function validateConformerMetadata(value) {
  if (!isRecord(value)) return ['conformer provenance must be an object'];

  const errors = [];
  const {
    index,
    energyKcal,
    relativeKcal,
    population,
    ensembleSpreadKcal,
    method,
    generatedCount,
    retainedCount,
  } = value;

  if (!Number.isInteger(index) || index < 0) errors.push('index must be a non-negative integer');
  if (!Number.isInteger(generatedCount) || generatedCount < 1 || generatedCount > MAX_CONFORMER_COUNT) {
    errors.push(`generatedCount must be an integer between 1 and ${MAX_CONFORMER_COUNT}`);
  }
  if (!Number.isInteger(retainedCount) || retainedCount < 1 || retainedCount > MAX_CONFORMER_COUNT) {
    errors.push(`retainedCount must be an integer between 1 and ${MAX_CONFORMER_COUNT}`);
  }
  if (Number.isInteger(generatedCount) && Number.isInteger(retainedCount) && retainedCount > generatedCount) {
    errors.push('retainedCount cannot exceed generatedCount');
  }
  if (Number.isInteger(index) && Number.isInteger(retainedCount) && index >= retainedCount) {
    errors.push('index must be smaller than retainedCount');
  }
  if (method !== CONFORMER_METHOD) errors.push(`method must be "${CONFORMER_METHOD}"`);

  if (!isNullish(energyKcal)
    && (!isFiniteNumber(energyKcal) || Math.abs(energyKcal) > MAX_ABS_KCAL)) {
    errors.push('energyKcal must be a finite number within bounds, or null');
  }
  if (!isNullish(relativeKcal)
    && (!isFiniteNumber(relativeKcal) || relativeKcal < 0 || relativeKcal > MAX_ABS_KCAL)) {
    errors.push('relativeKcal must be a finite non-negative number within bounds, or null');
  }
  if (!isNullish(population)
    && (!isFiniteNumber(population) || population < 0 || population > 1)) {
    errors.push('population must be a finite fraction between 0 and 1, or null');
  }
  if (!isNullish(ensembleSpreadKcal)
    && (!isFiniteNumber(ensembleSpreadKcal) || ensembleSpreadKcal < 0 || ensembleSpreadKcal > MAX_ABS_KCAL)) {
    errors.push('ensembleSpreadKcal must be a finite non-negative number within bounds, or null');
  }

  if (isNullish(energyKcal) && !isNullish(relativeKcal)) {
    errors.push('relativeKcal cannot be reported when energyKcal is unavailable');
  }
  if (isNullish(energyKcal) && !isNullish(population)) {
    errors.push('population cannot be reported when energyKcal is unavailable');
  }

  return errors;
}

/**
 * Build a validated provenance block.
 *
 * @param {Partial<ConformerMetadata>} input
 * @returns {ConformerMetadata}
 * @throws {TypeError} When the values are out of bounds or inconsistent.
 */
export function createConformerMetadata(input) {
  if (!isRecord(input)) throw new TypeError('Conformer provenance must be an object.');
  const metadata = {
    index: input.index,
    energyKcal: isNullish(input.energyKcal) ? null : input.energyKcal,
    relativeKcal: isNullish(input.relativeKcal) ? null : input.relativeKcal,
    population: isNullish(input.population) ? null : input.population,
    ensembleSpreadKcal: isNullish(input.ensembleSpreadKcal) ? null : input.ensembleSpreadKcal,
    method: input.method ?? CONFORMER_METHOD,
    generatedCount: input.generatedCount,
    retainedCount: input.retainedCount,
  };
  const errors = validateConformerMetadata(metadata);
  if (errors.length > 0) {
    throw new TypeError(`Invalid conformer provenance: ${errors.join('; ')}.`);
  }
  return metadata;
}

/**
 * Normalise an untrusted provenance block to the exact stored shape.
 *
 * @param {unknown} value
 * @returns {ConformerMetadata|null} Null when the block is missing or invalid.
 */
export function normalizeConformerMetadata(value) {
  if (!isRecord(value)) return null;
  try {
    return createConformerMetadata(value);
  } catch {
    return null;
  }
}

/**
 * Format the ensemble-spread warning shown in the UI.
 *
 * @param {number|null} spreadKcal - Highest minus lowest retained energy.
 * @param {number} [thresholdKcal=2] - Warn above this spread.
 * @returns {string|null} Warning text, or null when the spread is acceptable
 *   or unknown.
 */
export function describeEnsembleSpread(spreadKcal, thresholdKcal = 2) {
  if (!isFiniteNumber(spreadKcal) || !isFiniteNumber(thresholdKcal)) return null;
  if (spreadKcal <= thresholdKcal) return null;
  return `ensemble spread ${spreadKcal.toFixed(2)} kcal/mol — the reported value depends on conformer choice`;
}
