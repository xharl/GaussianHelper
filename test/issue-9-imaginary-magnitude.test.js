import { describe, expect, it } from 'vitest';
import { evaluateWorkflowOutput } from '../src/utils/workflowGates.js';
import {
  MAX_MIN_IMAGINARY_MAGNITUDE,
  createWorkflowProject,
  createWorkflowTask,
  deriveExpectedImaginaryModes,
  parseWorkflowProjectJson,
  serializeWorkflowProject,
  validateWorkflowProject,
} from '../src/utils/workflowModel.js';
import { formatImaginaryThreshold, GaussianOutputInspector } from '../src/components/GaussianOutputInspector.js';

function gateTask(gates = {}) {
  return {
    gates: {
      requireNormalTermination: true,
      requireScfRecord: false,
      requireOptimizationComplete: false,
      requireFrequencyRecord: false,
      expectedImaginaryModes: null,
      ...gates,
    },
  };
}

function frequencySection(frequencies = {}) {
  return {
    index: 1,
    status: 'completed',
    termination: { line: 30, text: 'Normal termination of Gaussian 16' },
    scf: { status: 'converged', records: 1, line: 20, evidence: 'SCF Done: E(RHF) = -0.5 A.U.' },
    optimization: { status: 'unknown', line: null, evidence: null },
    frequencies: {
      count: 3,
      imaginaryCount: 0,
      imaginaryValues: [],
      omittedImaginaryValues: 0,
      minImaginary: null,
      line: 27,
      evidence: 'Frequencies -- 100.0 200.0 300.0',
      ...frequencies,
    },
    diagnostics: [],
    omittedDiagnostics: 0,
  };
}

function imaginaryGate(result) {
  return result.gates.find(gate => gate.name === 'Imaginary-mode count');
}

function makeConfig(jobType) {
  return {
    link0: { checkpoint: 'freq.chk' },
    route: { method: 'HF', basisSet: '3-21G', jobType },
    title: 'Frequency job',
    charge: 0,
    multiplicity: 2,
    atoms: [{ symbol: 'H', x: 0, y: 0, z: 0 }],
  };
}

function projectWith(task) {
  const project = createWorkflowProject('Imaginary-mode workflow');
  project.tasks.push(task);
  return project;
}

function legacyProject(gates, jobType = 'Freq') {
  return {
    schemaVersion: 1,
    id: 'project-legacy',
    name: 'Legacy project',
    createdAt: '2026-11-06T00:00:00.000Z',
    updatedAt: '2026-11-06T00:00:00.000Z',
    tasks: [{
      id: 'task-legacy',
      title: 'Legacy frequency job',
      config: makeConfig(jobType),
      inputName: 'legacy.gjf',
      outputName: 'legacy.log',
      dependencies: [],
      checkpointFromTaskId: null,
      gates,
      activeAttemptId: null,
      lastExportedAt: null,
      attempts: [],
    }],
  };
}

const LOW_MODE = {
  count: 3,
  imaginaryCount: 1,
  imaginaryValues: [-4],
  omittedImaginaryValues: 0,
  minImaginary: -4,
  line: 42,
  evidence: 'Frequencies -- -4.0 100.0 200.0',
};

describe('imaginary-mode magnitude gate', () => {
  it('fails a TS whose only imaginary mode is -4 cm-1, with the value as evidence', () => {
    const result = evaluateWorkflowOutput(
      gateTask({ expectedImaginaryModes: 1 }),
      frequencySection(LOW_MODE),
    );

    expect(result.overall).toBe('fail');
    expect(imaginaryGate(result)).toMatchObject({
      result: 'fail',
      required: true,
      line: 42,
      evidence: '-4 cm-1 < 50 cm-1',
    });
  });

  it('passes a -420 cm-1 single-mode saddle', () => {
    const result = evaluateWorkflowOutput(
      gateTask({ expectedImaginaryModes: 1 }),
      frequencySection({
        count: 3,
        imaginaryCount: 1,
        imaginaryValues: [-420],
        omittedImaginaryValues: 0,
        minImaginary: -420,
        line: 43,
        evidence: 'Frequencies -- -420.0 100.0 200.0',
      }),
    );

    expect(result.overall).toBe('pass');
    expect(imaginaryGate(result)).toMatchObject({ result: 'pass', line: 43 });
  });

  it('checks every stored mode, not only the most negative one', () => {
    const result = evaluateWorkflowOutput(
      gateTask({ expectedImaginaryModes: 2 }),
      frequencySection({
        count: 6,
        imaginaryCount: 2,
        imaginaryValues: [-500, -4],
        omittedImaginaryValues: 0,
        minImaginary: -500,
      }),
    );

    expect(imaginaryGate(result)).toMatchObject({ result: 'fail', evidence: '-4 cm-1 < 50 cm-1' });
  });

  it('uses minImaginary, which the parser updates for every mode, when storage was truncated', () => {
    const truncated = {
      count: 205,
      imaginaryCount: 3,
      imaginaryValues: [-100],
      omittedImaginaryValues: 2,
      minImaginary: -500,
    };
    expect(imaginaryGate(evaluateWorkflowOutput(
      gateTask({ expectedImaginaryModes: 3 }),
      frequencySection(truncated),
    ))).toMatchObject({ result: 'pass' });

    expect(imaginaryGate(evaluateWorkflowOutput(
      gateTask({ expectedImaginaryModes: 3 }),
      frequencySection({ ...truncated, minImaginary: -10 }),
    ))).toMatchObject({ result: 'fail', evidence: '-10 cm-1 < 50 cm-1' });
  });

  it('returns unknown when the frequency record or its mode data is missing', () => {
    const missingRecord = evaluateWorkflowOutput(
      gateTask({ expectedImaginaryModes: 1 }),
      frequencySection({ count: null, imaginaryCount: 0, imaginaryValues: [], minImaginary: null, line: null, evidence: null }),
    );
    expect(missingRecord.overall).toBe('unknown');
    expect(imaginaryGate(missingRecord)).toMatchObject({ result: 'unknown' });

    const sectionWithoutRecord = frequencySection();
    delete sectionWithoutRecord.frequencies;
    const noFrequencies = evaluateWorkflowOutput(gateTask({ expectedImaginaryModes: 1 }), sectionWithoutRecord);
    expect(imaginaryGate(noFrequencies)).toMatchObject({ result: 'unknown' });

    const noMagnitude = evaluateWorkflowOutput(
      gateTask({ expectedImaginaryModes: 1 }),
      frequencySection({ count: 3, imaginaryCount: 1, imaginaryValues: [], minImaginary: null }),
    );
    expect(imaginaryGate(noMagnitude)).toMatchObject({ result: 'unknown' });
  });

  it('keeps the count check when the magnitude floor is null', () => {
    const disabled = evaluateWorkflowOutput(
      gateTask({ expectedImaginaryModes: 1, minImaginaryMagnitude: null }),
      frequencySection(LOW_MODE),
    );
    expect(disabled.overall).toBe('pass');
    expect(imaginaryGate(disabled)).toMatchObject({ result: 'pass' });

    const miscounted = evaluateWorkflowOutput(
      gateTask({ expectedImaginaryModes: 2, minImaginaryMagnitude: null }),
      frequencySection({ ...LOW_MODE, imaginaryCount: 1 }),
    );
    expect(imaginaryGate(miscounted)).toMatchObject({ result: 'fail' });
  });

  it('defaults non-TS Freq routes to zero imaginary modes in new tasks', () => {
    const plainFreq = createWorkflowTask(makeConfig('Freq'));
    expect(plainFreq.gates.expectedImaginaryModes).toBe(0);
    expect(plainFreq.gates.minImaginaryMagnitude).toBe(50);

    const optFreq = createWorkflowTask(makeConfig('Opt Freq'));
    expect(optFreq.gates.expectedImaginaryModes).toBe(0);

    const explicit = createWorkflowTask(makeConfig('Freq'), {
      gates: { expectedImaginaryModes: 1, minImaginaryMagnitude: 20 },
    });
    expect(explicit.gates.expectedImaginaryModes).toBe(1);
    expect(explicit.gates.minImaginaryMagnitude).toBe(20);

    const result = evaluateWorkflowOutput(plainFreq, frequencySection(LOW_MODE));
    expect(imaginaryGate(result)).toMatchObject({ result: 'fail' });
    expect(result.overall).toBe('fail');

    const minimum = evaluateWorkflowOutput(plainFreq, frequencySection());
    expect(imaginaryGate(minimum)).toMatchObject({ result: 'pass' });
  });

  it.each([
    'Opt=TS Freq',
    'Opt=(TS,CalcFC) Freq',
    'Opt=QST2 Freq',
    'Opt=(QST3,ReadFC) Freq',
  ])('leaves the expectation unset for the saddle search %s', jobType => {
    const config = makeConfig(jobType);
    expect(deriveExpectedImaginaryModes(config)).toBeNull();
    expect(createWorkflowTask(config).gates.expectedImaginaryModes).toBeNull();
  });

  it('derives nothing for a route without Freq', () => {
    expect(deriveExpectedImaginaryModes(makeConfig('SP'))).toBeNull();
    expect(deriveExpectedImaginaryModes(makeConfig('Opt'))).toBeNull();
  });
});

describe('minImaginaryMagnitude project persistence', () => {
  it('stores and round-trips the threshold, including an explicit null', () => {
    const task = createWorkflowTask(makeConfig('Freq'), {
      id: 'task-freq',
      inputName: 'freq.gjf',
      outputName: 'freq.log',
      gates: { minImaginaryMagnitude: 25 },
    });
    const json = serializeWorkflowProject(projectWith(task));
    expect(json).toContain('"minImaginaryMagnitude": 25');

    const imported = parseWorkflowProjectJson(json);
    expect(imported.tasks[0].gates.minImaginaryMagnitude).toBe(25);

    const disabled = createWorkflowTask(makeConfig('Freq'), {
      id: 'task-freq-null',
      inputName: 'freq-null.gjf',
      outputName: 'freq-null.log',
      gates: { minImaginaryMagnitude: null },
    });
    const nullImported = parseWorkflowProjectJson(serializeWorkflowProject(projectWith(disabled)));
    expect(nullImported.tasks[0].gates.minImaginaryMagnitude).toBeNull();
  });

  it('rejects a threshold that is not null or a finite value from 0 to the sanity bound', () => {
    for (const bad of [-1, MAX_MIN_IMAGINARY_MAGNITUDE + 1, Number.NaN, '50']) {
      const task = createWorkflowTask(makeConfig('Freq'), { id: 'task-bad', inputName: 'bad.gjf', outputName: 'bad.log' });
      task.gates.minImaginaryMagnitude = bad;
      const validation = validateWorkflowProject(projectWith(task));
      expect(validation.valid).toBe(false);
      expect(validation.errors.join(' ')).toMatch(/minImaginaryMagnitude/);
      expect(() => serializeWorkflowProject(projectWith(task))).toThrow(/minImaginaryMagnitude/);
    }

    const tooLarge = legacyProject({
      requireNormalTermination: true,
      requireScfRecord: false,
      requireOptimizationComplete: false,
      requireFrequencyRecord: true,
      expectedImaginaryModes: 0,
      minImaginaryMagnitude: 1e9,
    });
    expect(() => parseWorkflowProjectJson(JSON.stringify(tooLarge))).toThrow(/minImaginaryMagnitude/);
  });

  it('derives defaults for a legacy Freq project that predates both fields', () => {
    const legacy = legacyProject({
      requireNormalTermination: true,
      requireScfRecord: false,
      requireOptimizationComplete: false,
      requireFrequencyRecord: true,
    });
    const imported = parseWorkflowProjectJson(JSON.stringify(legacy));

    expect(imported.tasks[0].gates.expectedImaginaryModes).toBe(0);
    expect(imported.tasks[0].gates.minImaginaryMagnitude).toBe(50);
  });

  it('treats a legacy null expectation as the old default and derives zero for a minimum', () => {
    const legacy = legacyProject({
      requireNormalTermination: true,
      requireScfRecord: false,
      requireOptimizationComplete: false,
      requireFrequencyRecord: true,
      expectedImaginaryModes: null,
    });
    const imported = parseWorkflowProjectJson(JSON.stringify(legacy));
    expect(imported.tasks[0].gates.expectedImaginaryModes).toBe(0);
  });

  it('preserves an explicit null expectation when the project already stores a threshold', () => {
    const current = legacyProject({
      requireNormalTermination: true,
      requireScfRecord: false,
      requireOptimizationComplete: false,
      requireFrequencyRecord: true,
      expectedImaginaryModes: null,
      minImaginaryMagnitude: 50,
    });
    const imported = parseWorkflowProjectJson(JSON.stringify(current));
    expect(imported.tasks[0].gates.expectedImaginaryModes).toBeNull();
  });

  it('keeps saddle searches unset and non-Freq routes unchecked on legacy load', () => {
    const gates = {
      requireNormalTermination: true,
      requireScfRecord: false,
      requireOptimizationComplete: true,
      requireFrequencyRecord: true,
    };
    const ts = parseWorkflowProjectJson(JSON.stringify(legacyProject(gates, 'Opt=TS Freq')));
    expect(ts.tasks[0].gates.expectedImaginaryModes).toBeNull();
    expect(ts.tasks[0].gates.minImaginaryMagnitude).toBe(50);

    const singlePoint = parseWorkflowProjectJson(JSON.stringify(legacyProject(gates, 'SP')));
    expect(singlePoint.tasks[0].gates.expectedImaginaryModes).toBeNull();
  });
});

describe('inspector saddle-threshold wording', () => {
  it('renders the negative mode and threshold verdict', () => {
    const section = frequencySection({
      count: 3,
      imaginaryCount: 1,
      imaginaryValues: [-4.2],
      omittedImaginaryValues: 0,
      minImaginary: -4.2,
    });

    expect(formatImaginaryThreshold(section, 50))
      .toBe('1 negative mode at -4.2 cm-1 — below the 50 cm-1 saddle threshold');
    expect(formatImaginaryThreshold(section, null)).toBe('');
    expect(formatImaginaryThreshold(section, undefined)).toBe('');
  });

  it('reports a mode that meets the threshold', () => {
    const section = frequencySection({
      count: 3,
      imaginaryCount: 1,
      imaginaryValues: [-420],
      minImaginary: -420,
    });
    expect(formatImaginaryThreshold(section, 50))
      .toBe('1 negative mode at -420 cm-1 — meets the 50 cm-1 saddle threshold');
  });

  it('shows the verdict in the rendered section without breaking escaping', () => {
    const section = frequencySection({
      count: 3,
      imaginaryCount: 1,
      imaginaryValues: [-4.2],
      minImaginary: -4.2,
    });
    section.finalEnergy = null;
    const inspector = Object.create(GaussianOutputInspector.prototype);
    const html = inspector.renderSection(section, { minImaginaryMagnitude: 50 });

    expect(html).toContain('Saddle threshold:');
    expect(html).toContain('1 negative mode at -4.2 cm-1 — below the 50 cm-1 saddle threshold');
  });
});
