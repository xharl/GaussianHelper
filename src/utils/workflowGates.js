import { getMethodByKeyword } from '../data/methods.js';
import { finalEnergyLabelFamily } from '../parsers/gaussianLogParser.js';

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
