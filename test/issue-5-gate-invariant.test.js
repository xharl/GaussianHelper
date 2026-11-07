import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createWorkflowProject,
  createWorkflowTask,
  validateWorkflowProject,
} from '../src/utils/workflowModel.js';

function makeConfig(overrides = {}) {
  return {
    link0: { checkpoint: 'gate-invariant.chk' },
    route: { method: 'HF', basisSet: '3-21G', jobType: 'SP' },
    title: 'Gate invariant',
    charge: 0,
    multiplicity: 2,
    atoms: [{ symbol: 'H', x: 0, y: 0, z: 0 }],
    ...overrides,
  };
}

function projectWith(tasks) {
  const project = createWorkflowProject('Gate invariant');
  project.tasks = tasks;
  return project;
}

describe('requireNormalTermination gate invariant', () => {
  it('keeps requireNormalTermination true when a caller supplies false', () => {
    const task = createWorkflowTask(makeConfig(), {
      gates: { requireNormalTermination: false, requireScfRecord: true },
    });

    expect(task.gates.requireNormalTermination).toBe(true);
    // The rest of the caller's gate overrides still flow through the spread.
    expect(task.gates.requireScfRecord).toBe(true);
  });

  it('rejects a stored project whose requireNormalTermination gate is not true', () => {
    expect(validateWorkflowProject(projectWith([createWorkflowTask(makeConfig())])))
      .toEqual({ valid: true, errors: [] });

    for (const invalidGate of [false, undefined, 1]) {
      const task = createWorkflowTask(makeConfig());
      task.gates.requireNormalTermination = invalidGate;
      const result = validateWorkflowProject(projectWith([task]));
      expect(result.valid, `gate value ${String(invalidGate)} must be rejected`).toBe(false);
      expect(result.errors.join(' ')).toMatch(/invalid validation gates/i);
    }
  });

  it('assigns requireNormalTermination exactly once, after the gates spread', () => {
    const source = readFileSync(new URL('../src/utils/workflowModel.js', import.meta.url), 'utf8');
    const start = source.indexOf('export function createWorkflowTask');
    const end = source.indexOf('export function topologicallySortTasks');
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const body = source.slice(start, end);
    const assignments = body.match(/^\s*requireNormalTermination\s*:/gm) ?? [];
    expect(assignments).toHaveLength(1);

    const spreadIndex = body.indexOf('...options.gates');
    expect(spreadIndex).toBeGreaterThanOrEqual(0);
    expect(body.indexOf('requireNormalTermination:')).toBeGreaterThan(spreadIndex);

    expect(body).toMatch(/always required/i);
    expect(body).toMatch(/not user-configurable in v1/i);
  });
});
