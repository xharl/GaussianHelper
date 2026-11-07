import { describe, expect, it } from 'vitest';
import { evaluateWorkflowOutput } from '../src/utils/workflowGates.js';

function task(gates = {}) {
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

function section(overrides = {}) {
  return {
    index: 1,
    status: 'completed',
    termination: { line: 30, text: 'Normal termination of Gaussian 16' },
    scf: { status: 'converged', records: 1, line: 20, evidence: 'SCF Done: E(RHF) = -0.5 A.U.' },
    optimization: { status: 'converged', line: 24, evidence: 'Optimization completed.' },
    frequencies: { count: 3, imaginaryCount: 0, line: 27, evidence: 'Frequencies -- 100.0 200.0 300.0' },
    diagnostics: [],
    ...overrides,
  };
}

describe('workflow output gates', () => {
  it('passes only when every configured gate has positive evidence', () => {
    const result = evaluateWorkflowOutput(task({
      requireScfRecord: true,
      requireOptimizationComplete: true,
      requireFrequencyRecord: true,
      expectedImaginaryModes: 0,
    }), section());
    expect(result.overall).toBe('pass');
    expect(result.gates.filter(gate => gate.required).every(gate => gate.result === 'pass')).toBe(true);
  });

  it('fails an explicit Gaussian error termination with line evidence', () => {
    const result = evaluateWorkflowOutput(task(), section({
      status: 'error',
      termination: { line: 31, text: 'Error termination request processed' },
    }));
    expect(result.overall).toBe('fail');
    expect(result.gates[0]).toMatchObject({ result: 'fail', line: 31 });
  });

  it('returns unknown for missing termination instead of passing incomplete output', () => {
    const result = evaluateWorkflowOutput(task(), section({ status: 'incomplete', termination: null }));
    expect(result.overall).toBe('unknown');
    expect(result.gates[0]).toMatchObject({ result: 'unknown', line: null });
  });

  it('treats a required but absent SCF record as unknown and explicit SCF failure as fail', () => {
    const required = task({ requireScfRecord: true });
    const missing = evaluateWorkflowOutput(required, section({ scf: { status: 'unknown', records: 0 } }));
    expect(missing.overall).toBe('unknown');
    expect(missing.gates.find(gate => gate.name === 'SCF convergence')).toMatchObject({ result: 'unknown', required: true });

    const failed = evaluateWorkflowOutput(task(), section({ scf: { status: 'failed', records: 0, line: 12, evidence: 'SCF convergence failure' } }));
    expect(failed.overall).toBe('fail');
  });

  it('requires optimization and frequency evidence only when the task requests those gates', () => {
    const noOpt = evaluateWorkflowOutput(task({ requireOptimizationComplete: true }), section({
      optimization: { status: 'not converged', line: 18, evidence: 'Number of steps exceeded.' },
    }));
    expect(noOpt.overall).toBe('fail');
    expect(noOpt.gates.find(gate => gate.name === 'Optimization')).toMatchObject({ result: 'fail', line: 18 });

    const noFreq = evaluateWorkflowOutput(task({ requireFrequencyRecord: true }), section({
      frequencies: { count: null, imaginaryCount: 0, line: null, evidence: null },
    }));
    expect(noFreq.overall).toBe('unknown');
    expect(noFreq.gates.find(gate => gate.name === 'Frequency record')).toMatchObject({ result: 'unknown', required: true });
  });

  it('checks imaginary-mode counts only when the user specifies an expected count', () => {
    const informational = evaluateWorkflowOutput(task(), section({
      frequencies: { count: 3, imaginaryCount: 1, line: 27, evidence: 'Frequencies -- -10 100 200' },
    }));
    expect(informational.overall).toBe('pass');
    expect(informational.gates.find(gate => gate.name === 'Imaginary-mode count')).toBeUndefined();

    const mismatch = evaluateWorkflowOutput(task({ expectedImaginaryModes: 0 }), section({
      frequencies: { count: 3, imaginaryCount: 1, line: 27, evidence: 'Frequencies -- -10 100 200' },
    }));
    expect(mismatch.overall).toBe('fail');
    expect(mismatch.gates.find(gate => gate.name === 'Imaginary-mode count'))
      .toMatchObject({ result: 'fail', required: true, line: 27 });
  });
});
