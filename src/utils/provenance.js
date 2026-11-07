/**
 * @fileoverview Reproducibility provenance for exported Gaussian inputs.
 *
 * A `.gjf` records the method and basis, but not which app build wrote it, when,
 * from which geometry, or what the bytes hashed to. This module builds a
 * stable, diffable provenance record and its bounded compact form for the
 * workflow project file.
 *
 * Design rules:
 * - No invented values. A field is `null` when the caller did not supply it;
 *   geometry entry method is never inferred from coordinates.
 * - No volatile data beyond `generatedAt`; object keys are sorted recursively
 *   so two exports of the same job differ only in the timestamp.
 * - Tautomer/protomer enumeration is not implemented, so both fields are
 *   `null` with an explicit note rather than a guessed structure.
 *
 * @module utils/provenance
 */

import packageJson from '../../package.json';
import { generateGJF } from '../generators/gjfGenerator.js';
import { getHillFormula } from './elements.js';
import {
  normalizeConformerMetadata,
  validateConformerMetadata,
} from './conformerMetadata.js';

/** Version of the provenance record shape. */
export const PROVENANCE_SCHEMA_VERSION = 1;

/** Suffix appended to the input filename for the sidecar file. */
export const PROVENANCE_SUFFIX = '.provenance.json';

/** Application name written into every record. */
export const APP_NAME = packageJson.name;

/** Application version from package.json. */
export const APP_VERSION = packageJson.version;

/** Placeholder commit used when no build-time SHA was injected. */
export const UNKNOWN_COMMIT = 'unknown';

/** Explanation stored next to the always-null tautomer/protomer fields. */
export const TAUTOMER_NOTE =
  'Tautomer and protomer enumeration is not implemented; the structure is recorded exactly as entered.';

/** Geometry entry methods the app can name truthfully. */
export const GEOMETRY_SOURCE_KINDS = Object.freeze(['drawn', 'smiles', 'file', 'checkpoint', 'unknown']);

const GEOMETRY_KIND_SET = new Set(GEOMETRY_SOURCE_KINDS);
const MAX_SMILES_CHARS = 1000;
const MAX_FILENAME_CHARS = 255;
const MAX_NOTE_CHARS = 300;
const MAX_ROUTE_FIELD_CHARS = 2000;
const MAX_TASK_ID_CHARS = 80;
const MAX_TASK_IDS = 100;
const MAX_FORMULA_CHARS = 200;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const APP_FIELD = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const geometrySourceKeys = ['filename', 'kind', 'note', 'smiles'];
const compactKeys = ['app', 'conformer', 'generatedAt', 'geometrySource', 'inputSha256', 'schemaVersion'];
const recordKeys = ['app', 'calculation', 'generatedAt', 'input', 'molecule', 'schemaVersion', 'task'];
const appKeys = ['commit', 'name', 'version'];
const compactAppKeys = ['commit', 'version'];
const inputKeys = ['filename', 'sha256'];
const calculationKeys = ['basisSet', 'custom', 'dispersion', 'grid', 'jobType', 'method', 'pop', 'scf', 'solvation'];
const moleculeKeys = [
  'atomCount',
  'charge',
  'conformer',
  'geometrySource',
  'hillFormula',
  'multiplicity',
  'protomer',
  'tautomer',
  'tautomerNote',
];
const taskKeys = ['id', 'parentTaskIds'];

/**
 * Resolve the git commit injected at build time.
 *
 * Anything that is not a plausible hex SHA becomes `'unknown'`; a dev server,
 * a source checkout, or a tarball without git metadata must not claim a commit.
 *
 * @param {unknown} value
 * @returns {string} Lowercase hex SHA, or `'unknown'`.
 */
export function resolveAppCommit(value) {
  if (typeof value !== 'string') return UNKNOWN_COMMIT;
  const commit = value.trim();
  return /^[0-9a-f]{7,40}$/i.test(commit) ? commit.toLowerCase() : UNKNOWN_COMMIT;
}

/**
 * Build-time commit injected by Vite's `define`. Tests and unbundled source
 * runs have no such global, so the fallback is part of the contract.
 */
export const APP_COMMIT = resolveAppCommit(
  typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : undefined
);

/**
 * Normalise a caller-supplied geometry source.
 *
 * @param {unknown} value
 * @returns {string[]} Human-readable problems; empty when valid.
 */
export function validateGeometrySource(value) {
  if (!isRecord(value)) return ['geometry source must be an object'];
  const errors = [];
  for (const key of Object.keys(value)) {
    if (!geometrySourceKeys.includes(key)) errors.push(`geometry source has unknown field "${key}"`);
  }
  if (!GEOMETRY_KIND_SET.has(value.kind)) {
    errors.push(`geometry source kind must be one of ${GEOMETRY_SOURCE_KINDS.join(', ')}`);
  }
  validateOptionalText(value.smiles, MAX_SMILES_CHARS, 'geometry source smiles', errors);
  validateOptionalText(value.filename, MAX_FILENAME_CHARS, 'geometry source filename', errors);
  validateOptionalText(value.note, MAX_NOTE_CHARS, 'geometry source note', errors);
  if (typeof value.filename === 'string' && /[\\/]/.test(value.filename)) {
    errors.push('geometry source filename must be a basename without path separators');
  }
  if (value.kind === 'smiles' && (typeof value.smiles !== 'string' || value.smiles.trim() === '')) {
    errors.push('geometry source smiles is required when kind is "smiles"');
  }
  if (value.kind === 'file' && (typeof value.filename !== 'string' || value.filename.trim() === '')) {
    errors.push('geometry source filename is required when kind is "file"');
  }
  return errors;
}

/**
 * Normalise an untrusted geometry source to the exact stored shape.
 *
 * @param {unknown} value
 * @returns {{kind: string, smiles: string|null, filename: string|null, note: string|null}|null}
 *   Null when the value is missing or invalid.
 */
export function normalizeGeometrySource(value) {
  if (!isRecord(value)) return null;
  if (validateGeometrySource(value).length > 0) return null;
  return {
    filename: value.filename ?? null,
    kind: value.kind,
    note: value.note ?? null,
    smiles: value.smiles ?? null,
  };
}

/**
 * Derive the only geometry source a workflow task can prove: a route that
 * reads the geometry from a checkpoint. Everything else stays unknown rather
 * than guessing "drawn".
 *
 * @param {Object} config
 * @returns {{kind: string, smiles: null, filename: string|null, note: string|null}|null}
 */
export function inferGeometrySource(config) {
  const routeText = `${config?.route?.jobType || ''} ${config?.route?.custom || ''}`;
  const readsCheckpoint = /\bGeom\s*=\s*(?:\(\s*)?(?:AllCheck|Checkpoint)\b/i.test(routeText)
    || /\bGuess\s*=\s*Read\b/i.test(routeText);
  if (!readsCheckpoint) return null;
  return {
    filename: typeof config?.link0?.checkpoint === 'string' ? config.link0.checkpoint : null,
    kind: 'checkpoint',
    note: 'Geometry is read from a checkpoint file by the route section.',
    smiles: null,
  };
}

function routeHasGeomOption(config, option) {
  const routeText = `${config?.route?.jobType || ''} ${config?.route?.custom || ''}`;
  return new RegExp(`\\bGeom\\s*=\\s*(?:\\(\\s*)?${option}\\b`, 'i').test(routeText);
}

function unknownGeometrySource() {
  return {
    filename: null,
    kind: 'unknown',
    note: 'Geometry entry method was not recorded; it is not inferred from the coordinates.',
    smiles: null,
  };
}

/**
 * Compute the lowercase hex SHA-256 of a string synchronously.
 *
 * The workflow bundle and the single-task download must both produce the
 * record before returning, while `crypto.subtle` is asynchronous. This pure-JS
 * implementation is the synchronous path; `sha256Hex()` uses WebCrypto when it
 * is available. Tests compare both against `node:crypto`.
 *
 * @param {string} text
 * @returns {string} 64 lowercase hex characters.
 */
export function sha256HexSync(text) {
  return bytesToHex(sha256Bytes(new TextEncoder().encode(String(text))));
}

/**
 * Compute the lowercase hex SHA-256 of a string with WebCrypto.
 *
 * @param {string} text
 * @returns {Promise<string>} 64 lowercase hex characters.
 */
export async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(String(text));
  if (globalThis.crypto?.subtle?.digest) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return bytesToHex(new Uint8Array(digest));
  }
  return bytesToHex(sha256Bytes(bytes));
}

/**
 * Build a stable provenance record for one generated input.
 *
 * @param {Object} config Gaussian configuration the input was built from.
 * @param {Object} [context]
 * @param {string} [context.inputText] Exact `.gjf` text that was/will be
 *   exported. When omitted, `generateGJF(config)` is used; callers that add
 *   `%OldChk` must pass the final text so the hash covers the exported bytes.
 * @param {string} [context.inputName] Exported filename.
 * @param {Date|string|number} [context.generatedAt] Defaults to now.
 * @param {string} [context.taskId]
 * @param {string[]} [context.parentTaskIds]
 * @param {Object} [context.geometrySource] `{ kind, smiles?, filename?, note? }`.
 * @param {Object} [context.conformer] Overrides `config.conformer`.
 * @param {string} [context.appCommit] Overrides the build-time commit.
 * @param {string} [context.appVersion] Overrides the package version.
 * @returns {Promise<Object>} Sorted, diffable record.
 */
export async function buildProvenanceRecord(config, context = {}) {
  const inputText = resolveInputText(config, context);
  return buildRecord(config, context, await sha256Hex(inputText));
}

/**
 * Synchronous counterpart of {@link buildProvenanceRecord}.
 *
 * @param {Object} config
 * @param {Object} [context] Same fields as {@link buildProvenanceRecord}.
 * @returns {Object} Sorted, diffable record.
 */
export function buildProvenanceRecordSync(config, context = {}) {
  const inputText = resolveInputText(config, context);
  return buildRecord(config, context, sha256HexSync(inputText));
}

/**
 * Serialise a record the way the sidecar is written: two-space JSON with a
 * trailing newline, keys sorted recursively.
 *
 * @param {Object} record
 * @returns {string}
 */
export function stringifyProvenanceRecord(record) {
  return `${JSON.stringify(sortKeysDeep(record), null, 2)}\n`;
}

/**
 * Reduce a full record to the bounded subset stored in a project file.
 *
 * @param {Object} record
 * @returns {Object}
 * @throws {TypeError} When the record is incomplete.
 */
export function createCompactProvenance(record) {
  if (!isRecord(record) || !isRecord(record.app) || !isRecord(record.input) || !isRecord(record.molecule)) {
    throw new TypeError('A complete provenance record is required.');
  }
  return sortKeysDeep({
    schemaVersion: PROVENANCE_SCHEMA_VERSION,
    app: {
      commit: record.app.commit,
      version: record.app.version,
    },
    generatedAt: record.generatedAt,
    geometrySource: normalizeGeometrySource(record.molecule.geometrySource),
    conformer: record.molecule.conformer ? { ...record.molecule.conformer } : null,
    inputSha256: record.input.sha256,
  });
}

/**
 * Validate the compact provenance block stored per task in a project file.
 *
 * @param {unknown} value
 * @returns {string[]} Problems; empty when valid.
 */
export function validateCompactProvenance(value) {
  if (!isRecord(value)) return ['must be an object'];
  const errors = [];
  for (const key of Object.keys(value)) {
    if (!compactKeys.includes(key)) errors.push(`has unknown field "${key}"`);
  }
  if (value.schemaVersion !== PROVENANCE_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${PROVENANCE_SCHEMA_VERSION}`);
  }
  if (!isRecord(value.app)) {
    errors.push('app must be an object');
  } else {
    for (const key of Object.keys(value.app)) {
      if (!compactAppKeys.includes(key)) errors.push(`app has unknown field "${key}"`);
    }
    for (const field of ['version', 'commit']) {
      if (typeof value.app[field] !== 'string' || !APP_FIELD.test(value.app[field])) {
        errors.push(`app ${field} must be a short identifier`);
      }
    }
  }
  if (typeof value.generatedAt !== 'string' || Number.isNaN(Date.parse(value.generatedAt))) {
    errors.push('generatedAt must be an ISO timestamp');
  }
  errors.push(...validateGeometrySource(value.geometrySource).map(message => `geometry source: ${message}`));
  if (value.conformer !== null) {
    errors.push(...validateConformerMetadata(value.conformer).map(message => `conformer: ${message}`));
  }
  if (typeof value.inputSha256 !== 'string' || !SHA256_HEX.test(value.inputSha256)) {
    errors.push('inputSha256 must be 64 lowercase hex characters');
  }
  return errors;
}

/**
 * Normalise a compact provenance block.
 *
 * @param {unknown} value
 * @returns {Object|null} Null when missing or invalid.
 */
export function normalizeCompactProvenance(value) {
  if (!isRecord(value)) return null;
  if (validateCompactProvenance(value).length > 0) return null;
  return sortKeysDeep({
    schemaVersion: PROVENANCE_SCHEMA_VERSION,
    app: {
      commit: value.app.commit,
      version: value.app.version,
    },
    generatedAt: value.generatedAt,
    geometrySource: normalizeGeometrySource(value.geometrySource),
    conformer: value.conformer ? { ...value.conformer } : null,
    inputSha256: value.inputSha256,
  });
}

/**
 * Validate a full provenance record (the sidecar shape).
 *
 * @param {unknown} value
 * @returns {string[]} Problems; empty when valid.
 */
export function validateProvenanceRecord(value) {
  if (!isRecord(value)) return ['record must be an object'];
  const errors = [];
  for (const key of Object.keys(value)) {
    if (!recordKeys.includes(key)) errors.push(`record has unknown field "${key}"`);
  }
  if (value.schemaVersion !== PROVENANCE_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${PROVENANCE_SCHEMA_VERSION}`);
  }
  if (!isRecord(value.app)) {
    errors.push('app must be an object');
  } else {
    for (const key of Object.keys(value.app)) {
      if (!appKeys.includes(key)) errors.push(`app has unknown field "${key}"`);
    }
    for (const field of ['name', 'version', 'commit']) {
      if (typeof value.app[field] !== 'string' || !APP_FIELD.test(value.app[field])) {
        errors.push(`app ${field} must be a short identifier`);
      }
    }
  }
  if (typeof value.generatedAt !== 'string' || Number.isNaN(Date.parse(value.generatedAt))) {
    errors.push('generatedAt must be an ISO timestamp');
  }
  if (!isRecord(value.input)) {
    errors.push('input must be an object');
  } else {
    for (const key of Object.keys(value.input)) {
      if (!inputKeys.includes(key)) errors.push(`input has unknown field "${key}"`);
    }
    if (value.input.filename !== null
      && (typeof value.input.filename !== 'string' || value.input.filename.length === 0
        || value.input.filename.length > MAX_FILENAME_CHARS || /[\\/]/.test(value.input.filename))) {
      errors.push('input filename must be a basename or null');
    }
    if (typeof value.input.sha256 !== 'string' || !SHA256_HEX.test(value.input.sha256)) {
      errors.push('input sha256 must be 64 lowercase hex characters');
    }
  }
  if (!isRecord(value.calculation)) {
    errors.push('calculation must be an object');
  } else {
    for (const key of Object.keys(value.calculation)) {
      if (!calculationKeys.includes(key)) errors.push(`calculation has unknown field "${key}"`);
    }
    for (const key of calculationKeys) {
      const field = value.calculation[key];
      if (field !== null && (typeof field !== 'string' || field.length > MAX_ROUTE_FIELD_CHARS)) {
        errors.push(`calculation ${key} must be a bounded string or null`);
      }
    }
  }
  if (!isRecord(value.molecule)) {
    errors.push('molecule must be an object');
  } else {
    for (const key of Object.keys(value.molecule)) {
      if (!moleculeKeys.includes(key)) errors.push(`molecule has unknown field "${key}"`);
    }
    if (!Number.isInteger(value.molecule.atomCount) || value.molecule.atomCount < 0) {
      errors.push('molecule atomCount must be a non-negative integer');
    }
    if (value.molecule.hillFormula !== null
      && (typeof value.molecule.hillFormula !== 'string'
        || value.molecule.hillFormula.length === 0
        || value.molecule.hillFormula.length > MAX_FORMULA_CHARS)) {
      errors.push('molecule hillFormula must be a bounded string or null');
    }
    if (value.molecule.charge !== null && !Number.isInteger(value.molecule.charge)) {
      errors.push('molecule charge must be an integer or null');
    }
    if (value.molecule.multiplicity !== null
      && (!Number.isInteger(value.molecule.multiplicity) || value.molecule.multiplicity < 1)) {
      errors.push('molecule multiplicity must be a positive integer or null');
    }
    errors.push(...validateGeometrySource(value.molecule.geometrySource)
      .map(message => `molecule geometry source: ${message}`));
    if (value.molecule.conformer !== null) {
      errors.push(...validateConformerMetadata(value.molecule.conformer)
        .map(message => `molecule conformer: ${message}`));
    }
    if (value.molecule.tautomer !== null) errors.push('molecule tautomer must be null (enumeration is not implemented)');
    if (value.molecule.protomer !== null) errors.push('molecule protomer must be null (enumeration is not implemented)');
    if (value.molecule.tautomerNote !== TAUTOMER_NOTE) errors.push('molecule tautomerNote is missing or unexpected');
  }
  if (!isRecord(value.task)) {
    errors.push('task must be an object');
  } else {
    for (const key of Object.keys(value.task)) {
      if (!taskKeys.includes(key)) errors.push(`task has unknown field "${key}"`);
    }
    if (value.task.id !== null
      && (typeof value.task.id !== 'string' || value.task.id.length === 0 || value.task.id.length > MAX_TASK_ID_CHARS)) {
      errors.push('task id must be a bounded string or null');
    }
    if (!Array.isArray(value.task.parentTaskIds) || value.task.parentTaskIds.length > MAX_TASK_IDS
      || value.task.parentTaskIds.some(id => typeof id !== 'string' || id.length === 0 || id.length > MAX_TASK_ID_CHARS)) {
      errors.push(`task parentTaskIds must be at most ${MAX_TASK_IDS} bounded strings`);
    }
  }
  return errors;
}

function buildRecord(config, context, sha256) {
  if (!isRecord(config) || !isRecord(config.route)) {
    throw new TypeError('A Gaussian configuration with a route section is required.');
  }
  if (typeof config.route.method !== 'string' || config.route.method.trim() === '') {
    throw new Error('A route method is required for a provenance record.');
  }
  if (!isRecord(context)) throw new TypeError('Provenance context must be an object.');

  const generatedAt = normalizeGeneratedAt(context.generatedAt);
  const atoms = Array.isArray(config.atoms) ? config.atoms : [];
  // Geom=AllCheck writes no title, charge, multiplicity, or coordinates;
  // Geom=Checkpoint writes charge/multiplicity but no coordinates. The record
  // describes the exported input, so it must not report molecule data the file
  // does not contain.
  const allCheck = routeHasGeomOption(config, 'AllCheck');
  const checkpointGeometry = allCheck || routeHasGeomOption(config, 'Checkpoint');
  const conformer = resolveConformer(context, config);
  const geometrySource = resolveGeometrySource(config, context);
  const taskId = context.taskId === undefined || context.taskId === null
    ? null
    : boundedIdentifier(context.taskId, 'task id', MAX_TASK_ID_CHARS);
  const parentTaskIds = normalizeParentTaskIds(context.parentTaskIds);
  const inputName = context.inputName === undefined || context.inputName === null
    ? null
    : boundedFilename(context.inputName);
  const version = context.appVersion === undefined
    ? APP_VERSION
    : boundedIdentifier(context.appVersion, 'app version', 64);
  const commit = context.appCommit === undefined
    ? APP_COMMIT
    : resolveAppCommit(context.appCommit);

  return sortKeysDeep({
    schemaVersion: PROVENANCE_SCHEMA_VERSION,
    app: {
      commit,
      name: APP_NAME,
      version,
    },
    generatedAt,
    input: {
      filename: inputName,
      sha256,
    },
    calculation: {
      basisSet: routeField(config.route.basisSet)
        ?? (String(config.route.basisMode || '').toLowerCase() === 'genecp' ? 'GenECP' : null),
      custom: routeField(config.route.custom),
      dispersion: routeField(config.route.dispersion),
      grid: routeField(config.route.grid),
      jobType: routeField(config.route.jobType),
      method: routeField(config.route.method),
      pop: routeField(config.route.pop),
      scf: routeField(config.route.scf),
      solvation: routeField(config.route.solvation),
    },
    molecule: {
      atomCount: checkpointGeometry ? 0 : atoms.length,
      charge: allCheck ? null : (Number.isInteger(config.charge) ? config.charge : null),
      conformer,
      geometrySource,
      hillFormula: !checkpointGeometry && atoms.length > 0 ? getHillFormula(atoms) : null,
      multiplicity: allCheck ? null : (Number.isInteger(config.multiplicity) ? config.multiplicity : null),
      protomer: null,
      tautomer: null,
      tautomerNote: TAUTOMER_NOTE,
    },
    task: {
      id: taskId,
      parentTaskIds,
    },
  });
}

function resolveInputText(config, context) {
  if (!isRecord(context)) throw new TypeError('Provenance context must be an object.');
  if (context.inputText !== undefined) {
    if (typeof context.inputText !== 'string' || context.inputText.length === 0) {
      throw new TypeError('Provenance inputText must be non-empty text.');
    }
    return context.inputText;
  }
  return generateGJF(config);
}

function resolveConformer(context, config) {
  const source = context.conformer !== undefined ? context.conformer : config.conformer;
  if (source === undefined || source === null) return null;
  const conformer = normalizeConformerMetadata(source);
  if (!conformer) throw new TypeError('Provenance conformer metadata is invalid.');
  return conformer;
}

function resolveGeometrySource(config, context) {
  if (context.geometrySource !== undefined && context.geometrySource !== null) {
    const supplied = normalizeGeometrySource(context.geometrySource);
    if (!supplied) throw new TypeError('Provenance geometrySource is invalid.');
    return supplied;
  }
  const stored = normalizeGeometrySource(config.geometrySource);
  if (stored) return stored;
  return inferGeometrySource(config) || unknownGeometrySource();
}

function normalizeParentTaskIds(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_TASK_IDS) {
    throw new TypeError(`Provenance parentTaskIds must be an array of at most ${MAX_TASK_IDS} ids.`);
  }
  const seen = new Set();
  return value.map(id => {
    const normalized = boundedIdentifier(id, 'parent task id', MAX_TASK_ID_CHARS);
    if (seen.has(normalized)) throw new TypeError(`Duplicate parent task id "${normalized}".`);
    seen.add(normalized);
    return normalized;
  });
}

function normalizeGeneratedAt(value) {
  if (value === undefined || value === null) return new Date().toISOString();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError('A valid provenance timestamp is required.');
  return date.toISOString();
}

function routeField(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new TypeError('Route fields in a provenance record must be text.');
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_ROUTE_FIELD_CHARS) {
    throw new TypeError(`Route fields must be at most ${MAX_ROUTE_FIELD_CHARS} characters.`);
  }
  return trimmed;
}

function boundedIdentifier(value, label, max) {
  if (typeof value !== 'string') throw new TypeError(`Provenance ${label} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max || /[\0\r\n]/.test(trimmed)) {
    throw new TypeError(`Provenance ${label} must be 1 to ${max} characters on one line.`);
  }
  return trimmed;
}

function boundedFilename(value) {
  const name = boundedIdentifier(value, 'input filename', MAX_FILENAME_CHARS);
  if (/[\\/]/.test(name)) throw new TypeError('Provenance input filename must be a basename.');
  return name;
}

function validateOptionalText(value, max, label, errors) {
  if (value === undefined || value === null) return;
  if (typeof value !== 'string') {
    errors.push(`${label} must be text or null`);
  } else if (value.length > max) {
    errors.push(`${label} must be at most ${max} characters`);
  } else if (/[\0\r\n]/.test(value)) {
    errors.push(`${label} must be a single line`);
  }
}

/**
 * Recursively sort object keys so JSON output is stable and diffable. Array
 * order (dependencies, conformer ranking) is preserved because it is data.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
export function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortKeysDeep(value[key])]));
  }
  return value;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// ── SHA-256 (synchronous path) ──────────────────────────────────────────────
// Standard FIPS 180-4 implementation. It exists because the ZIP bundle is
// assembled synchronously; WebCrypto is used by the async API.

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function sha256Bytes(bytes) {
  const length = bytes.length;
  const paddedLength = (((length + 9) + 63) >> 6) << 6;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  const bitLength = length * 8;
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      w[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotr(w[index - 15], 7) ^ rotr(w[index - 15], 18) ^ (w[index - 15] >>> 3);
      const s1 = rotr(w[index - 2], 17) ^ rotr(w[index - 2], 19) ^ (w[index - 2] >>> 10);
      w[index] = (w[index - 16] + s0 + w[index - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let index = 0; index < 64; index += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + SHA256_K[index] + w[index]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return new Uint8Array([
    ...wordBytes(h0), ...wordBytes(h1), ...wordBytes(h2), ...wordBytes(h3),
    ...wordBytes(h4), ...wordBytes(h5), ...wordBytes(h6), ...wordBytes(h7),
  ]);
}

function rotr(value, shift) {
  return ((value >>> shift) | (value << (32 - shift))) >>> 0;
}

function wordBytes(word) {
  return [word >>> 24, (word >>> 16) & 0xff, (word >>> 8) & 0xff, word & 0xff];
}

function bytesToHex(bytes) {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}
