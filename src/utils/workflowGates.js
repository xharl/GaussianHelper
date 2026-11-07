import { getMethodByKeyword } from '../data/methods.js';
import { basisSets } from '../data/basisSets.js';
import { jobTypes } from '../data/keywords.js';
import { finalEnergyLabelFamily, normalizeRouteTokens } from '../parsers/gaussianLogParser.js';

/**
 * Method rungs whose reported answer is a post-SCF/composite step, not the
 * `SCF Done` reference. `SCF Done` is still the reference energy for these jobs,
 * which is why the gate exists rather than treating the SCF record as the answer.
 */
const POST_SCF_RUNGS = new Set(['post-HF', 'double-hybrid', 'composite']);

/**
 * Fallback for when `methods.js` loses its `rung` metadata for a post-SCF
 * method. Only explicit post-SCF/composite keywords are listed: an unrecognized
 * route token is never assumed to require a final energy.
 */
const POST_SCF_KEYWORDS = new Set([
  'MP2', 'MP3', 'MP4', 'MP4SDQ', 'CCSD', 'CCSD(T)', 'CCSD-T', 'QCISD', 'QCISD(T)',
  'CISD', 'CIS', 'CASSCF', 'SAC-CI',
  'CBS-QB3', 'CBS-4M', 'CBS-APNO',
  'G3', 'G3MP2', 'G3B3', 'G3MP2B3', 'G4', 'G4MP2', 'W1BD',
  'B2PLYP', 'B2PLYPD3', 'mPW2PLYP', 'DSDPBEP86',
]);

/**
 * Accepted final-energy families per route keyword. A method can print more than
 * one label for the same quantity (B2PLYPD3 reports the underlying B2PLYP
 * energy), so each entry is a list of families from the parser's pattern table.
 * Methods without an entry stay `unknown` rather than being guessed.
 */
const METHOD_FINAL_ENERGY_FAMILIES = {
  MP2: ['MP2'],
  MP3: ['MP3'],
  MP4: ['MP4'],
  MP4SDQ: ['MP4SDQ'],
  CCSD: ['CCSD'],
  'CCSD(T)': ['CCSD(T)'],
  'QCISD(T)': ['QCISD(T)'],
  'CBS-QB3': ['CBS-QB3'],
  'CBS-4M': ['CBS-4M'],
  'CBS-APNO': ['CBS-APNO'],
  G3: ['G3'],
  G3MP2: ['G3MP2'],
  G3B3: ['G3B3'],
  G3MP2B3: ['G3MP2B3'],
  G4: ['G4'],
  G4MP2: ['G4MP2'],
  W1BD: ['W1BD'],
  B2PLYP: ['B2PLYP'],
  B2PLYPD3: ['B2PLYP'],
  mPW2PLYP: ['mPW2PLYP'],
  DSDPBEP86: ['DSDPBEP86'],
};

/**
 * An explicit report that the post-SCF step itself failed. `Error termination`
 * is intentionally absent: the Normal termination gate already covers it, and
 * matching a bare error line here would double-count the same evidence.
 */
const METHOD_STEP_FAILURE_RE = new RegExp(
  '\\b(?:MP[234](?:SDQ)?|CCSD(?:\\(T\\))?|QCISD(?:\\(T\\))?|CBS-(?:QB3|4M|APNO)|G[34](?:MP2)?|W1BD'
  + '|B2PLYPD3?|mPW2PLYP|DSDPBEP86)\\b[^\\r\\n]{0,80}?'
  + '\\b(?:failed|failure|did\\s+not\\s+converge|not\\s+converged|unable\\s+to\\s+converge)\\b',
  'i',
);

function normalizeMethodKeyword(keyword) {
  return typeof keyword === 'string' ? keyword.trim().toUpperCase() : '';
}

/**
 * Whether a task's configured method must report a post-SCF/composite energy.
 * HF, DFT, semi-empirical and MM methods answer with `SCF Done`, so they need no
 * extra gate. Unknown route tokens are never assumed to need one.
 */
export function methodRequiresFinalEnergy(methodKeyword) {
  const keyword = normalizeMethodKeyword(methodKeyword);
  if (!keyword) return false;
  const definition = getMethodByKeyword(keyword);
  const rung = definition?.rung;
  if (rung) return POST_SCF_RUNGS.has(rung);
  return POST_SCF_KEYWORDS.has(keyword);
}

/** Expected final-energy families for a route keyword, or null when unmapped. */
export function expectedFinalEnergyFamilies(methodKeyword) {
  const families = METHOD_FINAL_ENERGY_FAMILIES[normalizeMethodKeyword(methodKeyword)];
  return families ? new Set(families.map(family => family.toUpperCase())) : null;
}

/** First diagnostic that explicitly reports the post-SCF step failing. */
function findMethodStepFailure(section) {
  return (section.diagnostics || []).find(item => item?.kind === 'error'
    && METHOD_STEP_FAILURE_RE.test(item.text || '')) || null;
}

/**
 * Route tokens that do not describe the calculation and are therefore harmless
 * when one side of the comparison has them: `SP` is Gaussian's default job type,
 * `TEST` stops before the first SCF cycle, and `MAXDISK` only sets a scratch
 * limit. They never satisfy a missing expected token.
 */
const NOOP_ROUTE_TOKENS = new Set(['SP', 'TEST', 'MAXDISK']);

/** Keywords known to select a functional/method, used to spot a conflicting echo. */
const BASIS_KEYWORDS = new Set([
  ...basisSets.map(entry => String(entry.keyword || '').trim().toUpperCase()).filter(Boolean),
  // Gen/GenECP are route-level basis modes rather than catalogue entries.
  'GEN',
  'GENECP',
]);
const JOB_TYPE_KEYWORDS = new Set(
  jobTypes.flatMap(entry => normalizeRouteTokens(entry.keyword)).filter(token => !NOOP_ROUTE_TOKENS.has(token)),
);

function routeTokenKind(token) {
  if (getMethodByKeyword(token)) return 'method';
  if (BASIS_KEYWORDS.has(token)) return 'basis';
  if (JOB_TYPE_KEYWORDS.has(token)) return 'job type';
  return null;
}

/**
 * Tokens a task's configured route must produce in the log's route echo.
 *
 * Derived from `config.route` rather than from `buildRouteSection()` so the
 * check still works for imported projects whose route predates a generator
 * change. GenECP jobs expect `METHOD` + `GENECP`; the per-element basis
 * keywords live in the molecule specification, not in the route section, so
 * they are intentionally not expected here.
 *
 * @returns {string[]|null} Tokens, or null when the task has no usable route.
 */
export function expectedRouteTokens(route) {
  if (!route || typeof route !== 'object') return null;
  const method = typeof route.method === 'string' ? route.method.trim() : '';
  if (!method) return null;
  const parts = [method];
  const definition = getMethodByKeyword(method);
  const hasBasis = typeof route.basisSet === 'string' && route.basisSet.trim().length > 0;
  const genecp = String(route.basisMode || '').trim().toLowerCase() === 'genecp';
  // GenECP always emits `Method/GenECP`, even when the method is not in the
  // local registry (an unknown/renamed functional still had a basis mode).
  const needsBasis = genecp || (definition ? definition.needsBasis !== false : hasBasis);
  if (needsBasis) parts.push(genecp ? 'GenECP' : route.basisSet || '');
  for (const key of ['jobType', 'scf', 'grid', 'dispersion', 'solvation', 'pop', 'custom']) {
    const value = route[key];
    if (typeof value === 'string' && value.trim()) parts.push(value.trim());
  }
  return normalizeRouteTokens(parts.join(' ')).filter(token => !NOOP_ROUTE_TOKENS.has(token));
}

function clipGateEvidence(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return null;
  return value.length <= 300 ? value : `${value.slice(0, 299)}…`;
}

function evaluateRouteEcho(task, section) {
  const echo = section.routeEcho;
  // A hand-built or pre-route-echo saved section has no captured evidence; do
  // not retroactively invalidate verdicts that were computed without it.
  if (!echo || typeof echo !== 'object') return null;
  const expected = expectedRouteTokens(task.config?.route);
  if (!expected) return null;

  const echoed = Array.isArray(echo.tokens) ? echo.tokens : [];
  const checkpoints = Array.isArray(echo.checkpoints) ? echo.checkpoints : [];
  const checkpointNote = checkpoints.length ? `Echoed checkpoint: ${checkpoints.join(', ')}.` : '';
  if (echoed.length === 0) {
    // No echo means the comparison cannot be made. Never report `pass`.
    return makeGate('Route echo matches', true, 'unknown', null, null);
  }

  const missing = expected.filter(token => !echoed.includes(token));
  const unexpected = echoed.filter(token => !expected.includes(token) && !NOOP_ROUTE_TOKENS.has(token));
  const conflicts = unexpected
    .map(token => ({ token, kind: routeTokenKind(token) }))
    .filter(entry => entry.kind);
  if (missing.length === 0 && conflicts.length === 0) {
    return makeGate(
      'Route echo matches',
      true,
      'pass',
      echo.line ?? null,
      clipGateEvidence([echo.evidence, checkpointNote].filter(Boolean).join(' · ')),
    );
  }

  const parts = [];
  if (missing.length) parts.push(`Missing route tokens: ${missing.join(', ')}.`);
  if (conflicts.length) {
    parts.push(`Unexpected ${conflicts.map(entry => `${entry.kind} keyword ${entry.token}`).join(', ')}.`);
  } else if (unexpected.length) {
    parts.push(`Unexpected route tokens: ${unexpected.join(', ')}.`);
  }
  return makeGate(
    'Route echo matches',
    true,
    'fail',
    echo.line ?? null,
    clipGateEvidence([parts.join(' '), checkpointNote].filter(Boolean).join(' ')),
  );
}

export function evaluateWorkflowOutput(task, section) {
  if (!task || !task.gates || !section) throw new TypeError('A workflow task and parsed output section are required.');
  const gates = [];
  const terminationEvidence = section.termination || firstError(section);

  gates.push(makeGate(
    'Normal termination',
    true,
    section.status === 'completed' && /\bNormal termination of Gaussian\b/i.test(section.termination?.text || '') ? 'pass'
      : section.status === 'error' || /\bError termination\b/i.test(section.termination?.text || '') ? 'fail'
        : 'unknown',
    terminationEvidence?.line ?? null,
    terminationEvidence?.text ?? null,
  ));

  const scfStatus = section.scf?.status || 'unknown';
  const scfIsFailure = scfStatus === 'failed';
  gates.push(makeGate(
    'SCF convergence',
    task.gates.requireScfRecord === true || scfIsFailure,
    scfStatus === 'converged' && Number(section.scf?.records) > 0 ? 'pass'
      : scfIsFailure ? 'fail' : 'unknown',
    section.scf?.line ?? null,
    section.scf?.evidence ?? null,
  ));

  const routeEchoGate = evaluateRouteEcho(task, section);
  if (routeEchoGate) gates.push(routeEchoGate);

  if (task.gates.requireFinalEnergy === true) {
    const finalEnergy = section.finalEnergy;
    const hasEnergy = Number.isFinite(finalEnergy?.valueHartree) && typeof finalEnergy?.label === 'string';
    const expectedFamilies = expectedFinalEnergyFamilies(task.config?.route?.method);
    const failure = findMethodStepFailure(section);
    const family = hasEnergy ? finalEnergyLabelFamily(finalEnergy.label) : null;
    // Absent or unjudgeable evidence is `unknown`, never `pass`: the SCF reference
    // energy is not a substitute for the method energy that was actually requested.
    const result = failure ? 'fail'
      : !hasEnergy ? 'unknown'
        : !expectedFamilies || !family ? 'unknown'
          : expectedFamilies.has(family.toUpperCase()) ? 'pass' : 'fail';
    gates.push(makeGate(
      'Method final energy',
      true,
      result,
      failure?.line ?? finalEnergy?.line ?? null,
      failure?.text ?? finalEnergy?.evidence ?? null,
    ));
  }

  if (task.gates.requireOptimizationComplete) {
    const status = section.optimization?.status || 'unknown';
    gates.push(makeGate(
      'Optimization',
      true,
      status === 'converged' ? 'pass' : status === 'not converged' ? 'fail' : 'unknown',
      section.optimization?.line ?? null,
      section.optimization?.evidence ?? null,
    ));
  }

  if (task.gates.requireFrequencyRecord) {
    const frequencyCount = section.frequencies?.count;
    gates.push(makeGate(
      'Frequency record',
      true,
      Number.isInteger(frequencyCount) && frequencyCount > 0 ? 'pass' : 'unknown',
      section.frequencies?.line ?? null,
      section.frequencies?.evidence ?? null,
    ));
  }

  if (task.gates.requireThermochemistry) {
    const thermochemistry = section.thermochemistry;
    const totals = thermochemistry?.totalsHartree || {};
    const hasTotals = ['zpe', 'enthalpy', 'gibbs'].every(key => Number.isFinite(totals[key]));
    const failure = thermochemistry?.failure;
    gates.push(makeGate(
      'Thermochemistry',
      true,
      failure ? 'fail' : hasTotals ? 'pass' : 'unknown',
      failure?.line ?? thermochemistry?.line ?? null,
      failure?.evidence ?? thermochemistry?.evidence ?? null,
    ));
  }

  if (task.gates.expectedImaginaryModes !== null && task.gates.expectedImaginaryModes !== undefined) {
    const frequencyCount = section.frequencies?.count;
    const modeCount = section.frequencies?.imaginaryCount;
    const result = !Number.isInteger(frequencyCount) || !Number.isInteger(modeCount) ? 'unknown'
      : modeCount === task.gates.expectedImaginaryModes ? 'pass' : 'fail';
    gates.push(makeGate(
      'Imaginary-mode count',
      true,
      result,
      section.frequencies?.line ?? null,
      section.frequencies?.evidence ?? null,
    ));
  }

  const required = gates.filter(gate => gate.required);
  const overall = required.some(gate => gate.result === 'fail') ? 'fail'
    : required.some(gate => gate.result === 'unknown') ? 'unknown'
      : 'pass';
  return { overall, gates };
}

function makeGate(name, required, result, line, evidence) {
  return { name, required, result, line, evidence };
}

function firstError(section) {
  return section.diagnostics?.find(item => item.kind === 'error') || null;
}
