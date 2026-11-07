import { describe, expect, it } from 'vitest';
import {
  MAX_WORKFLOW_PROJECT_BYTES,
  createWorkflowProject,
  createWorkflowTask,
  parseWorkflowProjectJson,
  serializeWorkflowProject,
} from '../src/utils/workflowModel.js';

function makePassedProject() {
  const project = createWorkflowProject('Water workflow');
  const task = createWorkflowTask({
    link0: { checkpoint: 'water.chk' },
    route: { method: 'HF', basisSet: '3-21G', jobType: 'SP' },
    title: 'Single point',
    charge: 0,
    multiplicity: 1,
    atoms: [{ symbol: 'O', x: 0, y: 0, z: 0 }, { symbol: 'H', x: 0, y: 1, z: 0 }, { symbol: 'H', x: 0, y: -1, z: 0 }],
  }, { id: 'task-water', inputName: 'water.gjf', outputName: 'water.log' });
  const parsedSection = {
    index: 1,
    status: 'completed',
    termination: { line: 10, text: 'Normal termination of Gaussian 16' },
    scf: { status: 'unknown', method: null, energyHartree: null, records: 0, line: null, evidence: null },
    optimization: { status: 'unknown', line: null, evidence: null },
    frequencies: { count: null, imaginaryCount: 0, imaginaryValues: [], omittedImaginaryValues: 0, minImaginary: null, line: null, evidence: null },
    diagnostics: [],
    omittedDiagnostics: 0,
  };
  const attempt = {
    id: 'attempt-water-1',
    outputFilename: 'water.log',
    importedAt: '2026-11-06T12:00:00.000Z',
    overall: 'pass',
    gates: [{ name: 'Normal termination', required: true, result: 'pass', line: 10, evidence: 'Normal termination of Gaussian 16' }],
    summary: { status: 'completed', sectionIndex: 1 },
    parsedSection,
  };
  task.attempts.push(attempt);
  task.activeAttemptId = attempt.id;
  project.tasks.push(task);
  return project;
}

describe('workflow project file', () => {
  it('round-trips project/task state and evidence but never serializes unknown raw-log fields', () => {
    const project = makePassedProject();
    project.tasks[0].rawLogText = 'PRIVATE_FULL_LOG_SENTINEL';
    const json = serializeWorkflowProject(project);
    expect(json).not.toContain('PRIVATE_FULL_LOG_SENTINEL');
    const imported = parseWorkflowProjectJson(json);
    expect(imported.name).toBe('Water workflow');
    expect(imported.tasks[0].activeAttemptId).toBe('attempt-water-1');
    expect(imported.tasks[0].attempts[0].parsedSection.termination.line).toBe(10);
    expect(imported.tasks[0].rawLogText).toBeUndefined();
  });

  it('recomputes imported pass/fail states from bounded parsed evidence, not the stored verdict', () => {
    const forgedPass = makePassedProject();
    forgedPass.tasks[0].attempts[0].overall = 'fail';
    expect(parseWorkflowProjectJson(JSON.stringify(forgedPass)).tasks[0].attempts[0].overall).toBe('pass');

    const forgedFailure = makePassedProject();
    forgedFailure.tasks[0].attempts[0].parsedSection.status = 'error';
    forgedFailure.tasks[0].attempts[0].parsedSection.termination.text = 'Error termination request processed';
    forgedFailure.tasks[0].attempts[0].overall = 'pass';
    expect(parseWorkflowProjectJson(JSON.stringify(forgedFailure)).tasks[0].attempts[0].overall).toBe('fail');
  });

  it('rejects unsupported schema versions and malformed attempt evidence', () => {
    const project = makePassedProject();
    project.schemaVersion = 2;
    expect(() => serializeWorkflowProject(project)).toThrow(/unsupported workflow schema/i);

    const oversizedEvidence = makePassedProject();
    oversizedEvidence.tasks[0].attempts[0].parsedSection.termination.text = 'x'.repeat(301);
    expect(() => serializeWorkflowProject(oversizedEvidence)).toThrow(/evidence|300/i);
  });

  it('rejects project files larger than the explicit byte limit before parsing', () => {
    const tooLarge = ' '.repeat(MAX_WORKFLOW_PROJECT_BYTES + 1);
    expect(() => parseWorkflowProjectJson(tooLarge)).toThrow(/size limit/i);
  });
});
