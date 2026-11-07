import { evaluateWorkflowOutput } from './workflowGates.js';
import { validateInputCompleteness } from './validation.js';

export const WORKFLOW_SCHEMA_VERSION = 1;
export const MAX_WORKFLOW_TASKS = 100;
export const MAX_WORKFLOW_PROJECT_BYTES = 5 * 1024 * 1024;

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const SAFE_INPUT_NAME = /^[A-Za-z0-9][A-Za-z0-9_. -]{0,126}\.gjf$/i;
const SAFE_OUTPUT_NAME = /^[A-Za-z0-9][A-Za-z0-9_. -]{0,126}\.(?:log|out)$/i;
const SAFE_CHECKPOINT_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,126}\.chk$/i;
const ATTEMPT_OUTCOMES = new Set(['pass', 'fail', 'unknown']);

export function createWorkflowId(prefix = 'task') {
  const randomId = globalThis.crypto?.randomUUID?.();
  const suffix = randomId || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
}

export function createWorkflowProject(name = 'Untitled Gaussian project') {
  const now = new Date().toISOString();
  return {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    id: createWorkflowId('project'),
    name: String(name || '').trim() || 'Untitled Gaussian project',
    createdAt: now,
    updatedAt: now,
    tasks: [],
  };
}

export function createWorkflowTask(config, options = {}) {
  if (!isRecord(config) || !isRecord(config.route) || !Array.isArray(config.atoms)) {
    throw new TypeError('A complete Gaussian configuration is required to create a workflow task.');
  }
  const snapshot = cloneJson(config);
  if (snapshot.link0) delete snapshot.link0.oldCheckpoint;
  const routeText = `${snapshot.route.jobType || ''} ${snapshot.route.custom || ''}`;
  const title = String(options.title ?? snapshot.title ?? 'Gaussian calculation').trim() || 'Gaussian calculation';
  return {
    id: options.id || createWorkflowId('task'),
    title,
    config: snapshot,
    inputName: options.inputName || 'calculation.gjf',
    outputName: options.outputName || 'calculation.log',
    dependencies: [...(options.dependencies || [])],
    checkpointFromTaskId: options.checkpointFromTaskId || null,
    gates: {
      requireNormalTermination: true,
      requireScfRecord: false,
      requireOptimizationComplete: /(?:^|\s)Opt(?:\b|=)/i.test(routeText),
      requireFrequencyRecord: /(?:^|\s)Freq(?:\b|=)/i.test(routeText),
      expectedImaginaryModes: null,
      ...options.gates,
      requireNormalTermination: true,
    },
    activeAttemptId: null,
    lastExportedAt: null,
    attempts: [],
  };
}

export function topologicallySortTasks(tasks) {
  if (!Array.isArray(tasks)) throw new Error('Workflow tasks must be an array.');
  const byId = new Map();
  const order = new Map();
  tasks.forEach((task, index) => {
    if (!task || typeof task.id !== 'string' || byId.has(task.id)) {
      throw new Error('Workflow task IDs must be unique non-empty strings.');
    }
    byId.set(task.id, task);
    order.set(task.id, index);
  });

  const indegree = new Map();
  const dependents = new Map(tasks.map(task => [task.id, []]));
  for (const task of tasks) {
    const dependencies = Array.isArray(task.dependencies) ? task.dependencies : [];
    indegree.set(task.id, dependencies.length);
    for (const dependencyId of dependencies) {
      if (!byId.has(dependencyId)) {
        throw new Error(`Task "${task.id}" has a missing dependency "${dependencyId}".`);
      }
      dependents.get(dependencyId).push(task.id);
    }
  }

  const ready = tasks.filter(task => indegree.get(task.id) === 0).map(task => task.id);
  const sorted = [];
  while (ready.length > 0) {
    ready.sort((a, b) => order.get(a) - order.get(b));
    const id = ready.shift();
    sorted.push(byId.get(id));
    for (const dependentId of dependents.get(id)) {
      const next = indegree.get(dependentId) - 1;
      indegree.set(dependentId, next);
      if (next === 0) ready.push(dependentId);
    }
  }

  if (sorted.length !== tasks.length) throw new Error('Workflow dependencies contain a cycle.');
  return sorted;
}

export function validateWorkflowProject(project) {
  const errors = [];
  if (!isRecord(project)) return { valid: false, errors: ['Project must be a JSON object.'] };
  if (project.schemaVersion !== WORKFLOW_SCHEMA_VERSION) {
    errors.push(`Unsupported workflow schema version: ${String(project.schemaVersion)}.`);
  }
  if (typeof project.id !== 'string' || !SAFE_ID.test(project.id)) errors.push('Project ID is invalid.');
  if (typeof project.name !== 'string' || project.name.trim().length === 0 || project.name.length > 200) {
    errors.push('Project name must contain 1 to 200 characters.');
  }
  for (const field of ['createdAt', 'updatedAt']) {
    if (typeof project[field] !== 'string' || Number.isNaN(Date.parse(project[field]))) {
      errors.push(`Project ${field} timestamp is invalid.`);
    }
  }
  if (!Array.isArray(project.tasks)) {
    errors.push('Project tasks must be an array.');
    return { valid: false, errors };
  }
  if (project.tasks.length > MAX_WORKFLOW_TASKS) {
    errors.push(`A project may contain at most ${MAX_WORKFLOW_TASKS} tasks.`);
  }

  const ids = new Set();
  for (const task of project.tasks) {
    if (!isRecord(task)) {
      errors.push('Each workflow task must be an object.');
      continue;
    }
    if (typeof task.id !== 'string' || !SAFE_ID.test(task.id)) {
      errors.push('Task ID is invalid.');
    } else if (ids.has(task.id)) {
      errors.push(`Duplicate task ID "${task.id}".`);
    } else {
      ids.add(task.id);
    }
    if (typeof task.title !== 'string' || task.title.trim().length === 0 || task.title.length > 200) {
      errors.push(`Task "${task.id || '?'}" must have a title of 1 to 200 characters.`);
    }
    if (!SAFE_INPUT_NAME.test(task.inputName || '')) {
      errors.push(`Task "${task.id || '?'}" input filename must be a safe .gjf basename.`);
    }
    if (!SAFE_OUTPUT_NAME.test(task.outputName || '')) {
      errors.push(`Task "${task.id || '?'}" output filename must be a safe .log or .out basename.`);
    }
    if (!isRecord(task.config) || !isRecord(task.config.route) || !task.config.route.method
      || !Array.isArray(task.config.atoms) || task.config.atoms.length === 0) {
      errors.push(`Task "${task.id || '?'}" must contain a method, route, and at least one atom.`);
    } else if (task.config.atoms.length > 10000) {
      errors.push(`Task "${task.id}" contains too many atoms.`);
    } else {
      const completeness = validateInputCompleteness(task.config);
      for (const message of completeness.errors) errors.push(`Task "${task.id}" input: ${message}`);
      validateGjfConfigText(task, errors);
    }
    if (!Array.isArray(task.dependencies)) {
      errors.push(`Task "${task.id || '?'}" dependencies must be an array.`);
    } else {
      if (new Set(task.dependencies).size !== task.dependencies.length) {
        errors.push(`Task "${task.id || '?'}" has duplicate dependencies.`);
      }
      if (task.dependencies.includes(task.id)) {
        errors.push(`Task "${task.id || '?'}" cannot depend on itself.`);
      }
    }
    if (task.checkpointFromTaskId !== null && task.checkpointFromTaskId !== undefined
      && (!Array.isArray(task.dependencies) || !task.dependencies.includes(task.checkpointFromTaskId))) {
      errors.push(`Task "${task.id || '?'}" checkpoint source must be a direct dependency.`);
    }
    if (!isRecord(task.gates)
      || task.gates.requireNormalTermination !== true
      || typeof task.gates.requireScfRecord !== 'boolean'
      || typeof task.gates.requireOptimizationComplete !== 'boolean'
      || typeof task.gates.requireFrequencyRecord !== 'boolean'
      || (task.gates.expectedImaginaryModes !== null
        && (!Number.isInteger(task.gates.expectedImaginaryModes) || task.gates.expectedImaginaryModes < 0))) {
      errors.push(`Task "${task.id || '?'}" has invalid validation gates.`);
    } else {
      if (routeHasKeyword(task.config, 'Opt') && !task.gates.requireOptimizationComplete) {
        errors.push(`Task "${task.id}" Opt route requires the optimization gate.`);
      }
      if (routeHasKeyword(task.config, 'Freq') && !task.gates.requireFrequencyRecord) {
        errors.push(`Task "${task.id}" Freq route requires the frequency gate.`);
      }
    }
    if (task.activeAttemptId !== null && task.activeAttemptId !== undefined
      && (!Array.isArray(task.attempts) || !task.attempts.some(attempt => attempt?.id === task.activeAttemptId))) {
      errors.push(`Task "${task.id || '?'}" references a missing active attempt.`);
    }
    if (!Array.isArray(task.attempts) || task.attempts.length > 100) {
      errors.push(`Task "${task.id || '?'}" attempts must be an array of at most 100 records.`);
    } else {
      const attemptIds = new Set();
      for (const attempt of task.attempts) {
        const attemptError = validateWorkflowAttempt(attempt, attemptIds);
        if (attemptError) errors.push(`Task "${task.id || '?'}" has an invalid output attempt: ${attemptError}`);
      }
    }
    if (task.lastExportedAt !== null && task.lastExportedAt !== undefined
      && (typeof task.lastExportedAt !== 'string' || Number.isNaN(Date.parse(task.lastExportedAt)))) {
      errors.push(`Task "${task.id || '?'}" has an invalid export timestamp.`);
    }
  }

  for (const task of project.tasks) {
    if (!isRecord(task) || !Array.isArray(task.dependencies)) continue;
    for (const dependencyId of task.dependencies) {
      if (!ids.has(dependencyId)) errors.push(`Task "${task.id || '?'}" has a missing dependency "${dependencyId}".`);
    }
  }

  if (errors.length === 0) {
    try {
      topologicallySortTasks(project.tasks);
      validateUniqueArtifacts(project.tasks, errors);
      validateCheckpointBindings(project.tasks, errors);
    } catch (error) {
      errors.push(error.message);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function deriveTaskStates(project) {
  const validation = validateWorkflowProject(project);
  if (!validation.valid) throw new Error(`Cannot derive task states: ${validation.errors.join(' ')}`);

  const states = {};
  for (const task of topologicallySortTasks(project.tasks)) {
    const prerequisitesPassed = task.dependencies.every(id => states[id] === 'passed');
    if (!prerequisitesPassed) {
      states[task.id] = 'blocked';
      continue;
    }
    const activeAttempt = task.attempts.find(attempt => attempt.id === task.activeAttemptId);
    if (activeAttempt) {
      if (activeAttempt.overall === 'pass') states[task.id] = 'passed';
      else if (activeAttempt.overall === 'fail') states[task.id] = 'failed';
      else if (activeAttempt.summary?.status === 'incomplete') states[task.id] = 'incomplete';
      else states[task.id] = 'needs-review';
    } else if (task.lastExportedAt) {
      states[task.id] = 'awaiting-output';
    } else {
      states[task.id] = 'ready';
    }
  }
  return states;
}

export function serializeWorkflowProject(project) {
  const validation = validateWorkflowProject(project);
  if (!validation.valid) throw new Error(`Cannot save workflow project: ${validation.errors.join(' ')}`);
  const normalized = revalidateProjectAttempts(sanitizeWorkflowProject(project));
  const json = JSON.stringify(normalized, null, 2);
  if (new TextEncoder().encode(json).byteLength > MAX_WORKFLOW_PROJECT_BYTES) {
    throw new Error(`Workflow project exceeds the ${MAX_WORKFLOW_PROJECT_BYTES}-byte size limit.`);
  }
  return json;
}

export function parseWorkflowProjectJson(text) {
  if (typeof text !== 'string') throw new TypeError('Workflow project content must be text.');
  if (new TextEncoder().encode(text).byteLength > MAX_WORKFLOW_PROJECT_BYTES) {
    throw new Error(`Workflow project exceeds the ${MAX_WORKFLOW_PROJECT_BYTES}-byte size limit.`);
  }
  let project;
  try {
    project = JSON.parse(text);
  } catch (error) {
    throw new Error(`Workflow project is not valid JSON: ${error.message}`);
  }
  const validation = validateWorkflowProject(project);
  if (!validation.valid) throw new Error(`Invalid workflow project: ${validation.errors.join(' ')}`);
  return revalidateProjectAttempts(sanitizeWorkflowProject(project));
}

export function invalidateTaskAndDescendants(project, taskId) {
  if (!project.tasks.some(task => task.id === taskId)) throw new Error(`Unknown task "${taskId}".`);
  const invalidatedIds = new Set([taskId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of project.tasks) {
      if (!invalidatedIds.has(task.id) && task.dependencies.some(id => invalidatedIds.has(id))) {
        invalidatedIds.add(task.id);
        changed = true;
      }
    }
  }
  const next = cloneJson(project);
  for (const task of next.tasks) {
    if (invalidatedIds.has(task.id)) {
      task.activeAttemptId = null;
      task.lastExportedAt = null;
    }
  }
  next.updatedAt = new Date().toISOString();
  return next;
}

function validateUniqueArtifacts(tasks, errors) {
  const checkUnique = (field, label) => {
    const seen = new Set();
    for (const task of tasks) {
      const value = String(task[field]).toLowerCase();
      if (seen.has(value)) errors.push(`Workflow ${label} names must be unique; "${task[field]}" is repeated.`);
      seen.add(value);
    }
  };
  checkUnique('inputName', 'input');
  checkUnique('outputName', 'output');
  const checkpoints = new Map();
  for (const task of tasks) {
    const checkpoint = task.config?.link0?.checkpoint;
    if (!checkpoint) continue;
    const key = String(checkpoint).toLowerCase();
    if (checkpoints.has(key)) errors.push(`Workflow checkpoint names must be unique; "${checkpoint}" is repeated.`);
    checkpoints.set(key, task.id);
  }
}

function validateCheckpointBindings(tasks, errors) {
  const byId = new Map(tasks.map(task => [task.id, task]));
  for (const task of tasks) {
    const link0 = task.config?.link0 || {};
    const checkpointName = link0.checkpoint;
    const routeText = `${task.config?.route?.jobType || ''} ${task.config?.route?.custom || ''}`;
    const readsCheckpoint = /\bGeom\s*=\s*AllCheck\b/i.test(routeText)
      || /\bGuess\s*=\s*Read\b/i.test(routeText);
    if (checkpointName && !SAFE_CHECKPOINT_NAME.test(checkpointName)) {
      errors.push(`Task "${task.id}" checkpoint filename must be a safe .chk basename.`);
    }
    if (readsCheckpoint && !task.checkpointFromTaskId) {
      errors.push(`Task "${task.id}" uses checkpoint input keywords and needs a checkpoint source dependency.`);
    }
    if (link0.oldCheckpoint && !task.checkpointFromTaskId) {
      errors.push(`Task "${task.id}" cannot set OldChk outside a checkpoint dependency binding.`);
    }
    if (task.checkpointFromTaskId) {
      const source = byId.get(task.checkpointFromTaskId);
      const sourceCheckpoint = source?.config?.link0?.checkpoint;
      if (!sourceCheckpoint) {
        errors.push(`Task "${task.id}" checkpoint source has no output checkpoint configured.`);
      } else if (link0.oldCheckpoint && link0.oldCheckpoint !== sourceCheckpoint) {
        errors.push(`Task "${task.id}" OldChk must match its checkpoint source filename.`);
      }
    }
  }
}

function validateWorkflowAttempt(attempt, ids) {
  if (!isRecord(attempt) || typeof attempt.id !== 'string' || !SAFE_ID.test(attempt.id)) return 'attempt ID is invalid';
  if (ids.has(attempt.id)) return `duplicate attempt ID "${attempt.id}"`;
  ids.add(attempt.id);
  if (!ATTEMPT_OUTCOMES.has(attempt.overall)) return 'outcome must be pass, fail, or unknown';
  if (!isSafeImportedOutputName(attempt.outputFilename)) return 'output filename is invalid';
  if (typeof attempt.importedAt !== 'string' || Number.isNaN(Date.parse(attempt.importedAt))) return 'import timestamp is invalid';
  if (!Array.isArray(attempt.gates) || attempt.gates.length > 10) return 'gate results must be an array of at most 10 items';
  for (const gate of attempt.gates) {
    if (!isRecord(gate) || typeof gate.name !== 'string' || gate.name.length > 100
      || typeof gate.required !== 'boolean' || !ATTEMPT_OUTCOMES.has(gate.result)
      || !isOptionalLine(gate.line) || !isOptionalEvidence(gate.evidence)) return 'gate evidence is malformed or unbounded';
  }
  if (!isRecord(attempt.summary) || !['completed', 'error', 'incomplete'].includes(attempt.summary.status)
    || !Number.isInteger(attempt.summary.sectionIndex) || attempt.summary.sectionIndex < 1) return 'section summary is invalid';
  if (attempt.parsedSection !== null && attempt.parsedSection !== undefined
    && !validateParsedSection(attempt.parsedSection)) return 'parsed section evidence is malformed or unbounded';
  return null;
}

function validateParsedSection(section) {
  if (!isRecord(section) || !Number.isInteger(section.index) || section.index < 1
    || !['completed', 'error', 'incomplete'].includes(section.status)) return false;
  if (section.status === 'completed' && !/\bNormal termination of Gaussian\b/i.test(section.termination?.text || '')) return false;
  if (section.status === 'error' && !/\bError termination\b/i.test(section.termination?.text || '')) return false;
  if (section.status === 'incomplete' && section.termination != null) return false;
  if (section.termination !== null && section.termination !== undefined
    && (!isRecord(section.termination) || !Number.isInteger(section.termination.line) || section.termination.line < 1
      || !isOptionalEvidence(section.termination.text))) return false;
  const scf = section.scf;
  if (!isRecord(scf) || !['unknown', 'converged', 'failed'].includes(scf.status)
    || (scf.method !== null && (typeof scf.method !== 'string' || scf.method.length > 100))
    || (scf.energyHartree !== null && !Number.isFinite(scf.energyHartree))
    || !Number.isInteger(scf.records) || scf.records < 0 || !isOptionalLine(scf.line) || !isOptionalEvidence(scf.evidence)) return false;
  const optimization = section.optimization;
  if (!isRecord(optimization) || !['unknown', 'converged', 'not converged'].includes(optimization.status)
    || !isOptionalLine(optimization.line) || !isOptionalEvidence(optimization.evidence)) return false;
  const frequencies = section.frequencies;
  if (!isRecord(frequencies)
    || (frequencies.count !== null && (!Number.isInteger(frequencies.count) || frequencies.count < 0))
    || !Number.isInteger(frequencies.imaginaryCount) || frequencies.imaginaryCount < 0
    || !Array.isArray(frequencies.imaginaryValues) || frequencies.imaginaryValues.length > 100
    || frequencies.imaginaryValues.some(value => !Number.isFinite(value) || value >= 0)
    || !Number.isInteger(frequencies.omittedImaginaryValues) || frequencies.omittedImaginaryValues < 0
    || (frequencies.minImaginary !== null && (!Number.isFinite(frequencies.minImaginary) || frequencies.minImaginary >= 0))
    || !isOptionalLine(frequencies.line) || !isOptionalEvidence(frequencies.evidence)) return false;
  if (!Array.isArray(section.diagnostics) || section.diagnostics.length > 30
    || section.diagnostics.some(item => !isRecord(item) || !['warning', 'error'].includes(item.kind)
      || !Number.isInteger(item.line) || item.line < 1 || !isOptionalEvidence(item.text))) return false;
  return Number.isInteger(section.omittedDiagnostics) && section.omittedDiagnostics >= 0;
}

function isSafeImportedOutputName(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 255
    && !/[\\/\r\n\0]/.test(value) && /\.(?:log|out)$/i.test(value);
}

function isOptionalLine(value) {
  return value === null || (Number.isInteger(value) && value >= 1);
}

function isOptionalEvidence(value) {
  return value === null || (typeof value === 'string' && value.length <= 300 && !/[\0]/.test(value));
}

function revalidateProjectAttempts(project) {
  for (const task of project.tasks) {
    for (const attempt of task.attempts) {
      if (!attempt.parsedSection) {
        attempt.overall = 'unknown';
        attempt.gates = [];
        continue;
      }
      const evaluation = evaluateWorkflowOutput(task, attempt.parsedSection);
      attempt.overall = evaluation.overall;
      attempt.gates = evaluation.gates;
    }
  }
  return project;
}

function sanitizeWorkflowProject(project) {
  const routeKeys = ['verbosity', 'method', 'basisSet', 'jobType', 'scf', 'grid', 'dispersion', 'solvation', 'pop', 'custom'];
  const link0Keys = ['memory', 'nproc', 'oldCheckpoint', 'checkpoint', 'other'];
  return {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    tasks: project.tasks.map(task => ({
      id: task.id,
      title: task.title,
      config: {
        link0: Object.fromEntries(link0Keys.filter(key => task.config.link0?.[key] !== undefined)
          .map(key => [key, task.config.link0[key]])),
        route: Object.fromEntries(routeKeys.filter(key => task.config.route[key] !== undefined)
          .map(key => [key, task.config.route[key]])),
        title: task.config.title,
        charge: task.config.charge,
        multiplicity: task.config.multiplicity,
        atoms: task.config.atoms.map(atom => ({ symbol: atom.symbol, x: atom.x, y: atom.y, z: atom.z })),
      },
      inputName: task.inputName,
      outputName: task.outputName,
      dependencies: [...task.dependencies],
      checkpointFromTaskId: task.checkpointFromTaskId || null,
      gates: {
        requireNormalTermination: true,
        requireScfRecord: task.gates.requireScfRecord,
        requireOptimizationComplete: task.gates.requireOptimizationComplete,
        requireFrequencyRecord: task.gates.requireFrequencyRecord,
        expectedImaginaryModes: task.gates.expectedImaginaryModes,
      },
      activeAttemptId: task.activeAttemptId || null,
      lastExportedAt: task.lastExportedAt || null,
      attempts: task.attempts.map(attempt => ({
        id: attempt.id,
        outputFilename: attempt.outputFilename,
        importedAt: attempt.importedAt,
        overall: attempt.overall,
        gates: attempt.gates.map(gate => ({
          name: gate.name,
          required: gate.required,
          result: gate.result,
          line: gate.line ?? null,
          evidence: gate.evidence ?? null,
        })),
        summary: { status: attempt.summary.status, sectionIndex: attempt.summary.sectionIndex },
        ...(attempt.parsedSection ? { parsedSection: sanitizeParsedSection(attempt.parsedSection) } : {}),
      })),
    })),
  };
}

function sanitizeParsedSection(section) {
  return {
    index: section.index,
    status: section.status,
    termination: section.termination ? { line: section.termination.line, text: section.termination.text } : null,
    scf: {
      status: section.scf.status,
      method: section.scf.method ?? null,
      energyHartree: section.scf.energyHartree ?? null,
      records: section.scf.records,
      line: section.scf.line ?? null,
      evidence: section.scf.evidence ?? null,
    },
    optimization: {
      status: section.optimization.status,
      line: section.optimization.line ?? null,
      evidence: section.optimization.evidence ?? null,
    },
    frequencies: {
      count: section.frequencies.count ?? null,
      imaginaryCount: section.frequencies.imaginaryCount,
      imaginaryValues: [...section.frequencies.imaginaryValues],
      omittedImaginaryValues: section.frequencies.omittedImaginaryValues,
      minImaginary: section.frequencies.minImaginary ?? null,
      line: section.frequencies.line ?? null,
      evidence: section.frequencies.evidence ?? null,
    },
    diagnostics: section.diagnostics.map(item => ({ kind: item.kind, line: item.line, text: item.text })),
    omittedDiagnostics: section.omittedDiagnostics,
  };
}

function validateGjfConfigText(task, errors) {
  const config = task.config;
  if (typeof config.title !== 'string' || config.title.length > 1000 || /[\r\n\0]/.test(config.title)) {
    errors.push(`Task "${task.id}" title must be a single line of at most 1000 characters.`);
  }
  for (const [field, value] of Object.entries(config.route)) {
    if (value !== undefined && (typeof value !== 'string' || value.length > 2000 || /[\r\n\0]/.test(value))) {
      errors.push(`Task "${task.id}" route field "${field}" must be a single line of at most 2000 characters.`);
    }
  }
  if (config.link0 !== undefined && !isRecord(config.link0)) {
    errors.push(`Task "${task.id}" Link 0 configuration must be an object.`);
    return;
  }
  const link0 = config.link0 || {};
  for (const field of ['memory', 'checkpoint', 'oldCheckpoint']) {
    const value = link0[field];
    if (value !== undefined && (typeof value !== 'string' || value.length > 1000 || /[\r\n\0]/.test(value))) {
      errors.push(`Task "${task.id}" Link 0 field "${field}" must be a single line of at most 1000 characters.`);
    }
  }
  if (link0.other !== undefined && (typeof link0.other !== 'string' || link0.other.length > 4000 || /[\r\0]/.test(link0.other))) {
    errors.push(`Task "${task.id}" additional Link 0 commands contain invalid or oversized text.`);
  }
  if (link0.nproc !== undefined && typeof link0.nproc !== 'string' && typeof link0.nproc !== 'number') {
    errors.push(`Task "${task.id}" processor count must be text or a number.`);
  }
  if (typeof link0.nproc === 'string' && /[\r\n\0]/.test(link0.nproc)) {
    errors.push(`Task "${task.id}" processor count must be a single line.`);
  }
  if (typeof link0.nproc === 'number' && (!Number.isFinite(link0.nproc) || link0.nproc < 1)) {
    errors.push(`Task "${task.id}" processor count must be a positive finite number.`);
  }
}

function routeHasKeyword(config, keyword) {
  const routeText = `${config?.route?.jobType || ''} ${config?.route?.custom || ''}`;
  return new RegExp(`(?:^|\\s)${keyword}(?:\\b|=)`, 'i').test(routeText);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}
