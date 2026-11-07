/**
 * @fileoverview Force-field table registration for OpenChemLib.
 *
 * OpenChemLib keeps the MMFF94 parameter tables and the conformer-generator
 * torsion statistics in a separate `resources.json` (the JS bundle is built
 * without them). Anything that touches `ForceFieldMMFF94` or
 * `ConformerGenerator.initializeConformers()` throws
 * "static resources must be registered first" until those tables are
 * registered, and a thrown ConformerGenerator used to fall back silently to a
 * flat 2D structure.
 *
 * Registration is idempotent and cheap after the first call. The tables are
 * bundled through the `openchemlib-resources` Vite alias so the portable,
 * offline build never has to fetch them at runtime.
 *
 * @module utils/chemResources
 */

import { Resources } from 'openchemlib';
import resources from 'openchemlib-resources';

let state = 'uninitialised';

/**
 * Register OpenChemLib's static tables once.
 *
 * @returns {boolean} True when the tables are available. A false result means
 *   force-field energies and conformer generation cannot run in this build;
 *   callers must report that instead of inventing numbers.
 */
export function ensureChemResources() {
  if (state === 'ready') return true;
  if (state === 'failed') return false;
  try {
    Resources.register(resources);
    state = 'ready';
  } catch (error) {
    state = 'failed';
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('OpenChemLib static resources could not be registered:', error?.message || error);
    }
  }
  return state === 'ready';
}

/**
 * Whether the static tables have been registered successfully.
 * @returns {boolean}
 */
export function chemResourcesReady() {
  return state === 'ready';
}

/**
 * Reset the registration cache. Only intended for tests that need to exercise
 * the unavailable-resources path.
 */
export function resetChemResourcesForTests() {
  state = 'uninitialised';
}
