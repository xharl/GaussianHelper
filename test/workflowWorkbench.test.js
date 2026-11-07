import { describe, expect, it } from 'vitest';
import { parseGaussianLogText } from '../src/parsers/gaussianLogParser.js';
import { deriveTaskStates, serializeWorkflowProject } from '../src/utils/workflowModel.js';
import { WorkflowWorkbench } from '../src/components/WorkflowWorkbench.js';

function config(title = 'Water optimization') {
  return {
    link0: { checkpoint: 'water.chk' },
    route: { method: 'HF', basisSet: '3-21G', jobType: 'Opt' },
    title,
    charge: 0,
    multiplicity: 1,
    atoms: [{ symbol: 'O', x: 0, y: 0, z: 0 }],
  };
}

function makeContainer() {
  return {
    innerHTML: '',
    querySelector: () => null,
    querySelectorAll: () => [],
  };
}

describe('WorkflowWorkbench', () => {
  it('snapshots the current job into unique safe tasks without mutating the active config', () => {
    const activeConfig = config('<Water> optimization');
    const workbench = new WorkflowWorkbench(makeContainer(), () => activeConfig);
    const first = workbench.addCurrentTask();
    const second = workbench.addCurrentTask();

    expect(first.config).not.toBe(activeConfig);
    expect(first.gates.requireOptimizationComplete).toBe(true);
    expect(first.inputName).toMatch(/\.gjf$/);
    expect(second.inputName).not.toBe(first.inputName);
    expect(second.outputName).not.toBe(first.outputName);
    expect(second.config.link0.checkpoint).not.toBe(first.config.link0.checkpoint);
    expect(activeConfig.link0.checkpoint).toBe('water.chk');
  });

  it('rejects a dependency edit that creates a cycle and keeps the last valid graph', () => {
    const workbench = new WorkflowWorkbench(makeContainer(), () => config());
    const first = workbench.addCurrentTask();
    const second = workbench.addCurrentTask();
    expect(workbench.setTaskDependencies(second.id, [first.id])).toBe(true);
    expect(workbench.setTaskDependencies(first.id, [second.id])).toBe(false);
    expect(first.dependencies).toEqual([]);
    expect(workbench.project.tasks.find(task => task.id === first.id).dependencies).toEqual([]);
    expect(workbench.statusMessage).toMatch(/cycle/i);
  });

  it('generates checkpoint-linked input only after the upstream task passes', () => {
    const configs = [config('Optimization job'), {
      ...config('Frequency job'),
      route: { method: 'HF', basisSet: '3-21G', jobType: 'Freq Geom=AllCheck Guess=Read' },
    }];
    const workbench = new WorkflowWorkbench(makeContainer(), () => configs.shift());
    const source = workbench.addCurrentTask();
    const downstream = workbench.addCurrentTask({ dependencies: [source.id], checkpointFromTaskId: source.id });
    expect(() => workbench.buildTaskInput(downstream.id)).toThrow(/not ready/i);

    const sourceTask = workbench.project.tasks.find(task => task.id === source.id);
    sourceTask.attempts.push({
      id: 'source-pass',
      outputFilename: sourceTask.outputName,
      importedAt: '2026-11-06T00:00:00.000Z',
      overall: 'pass',
      gates: [{ name: 'Normal termination', required: true, result: 'pass', line: 1, evidence: 'Normal termination of Gaussian' }],
      summary: { status: 'completed', sectionIndex: 1 },
    });
    sourceTask.activeAttemptId = 'source-pass';
    const generated = workbench.buildTaskInput(downstream.id);
    expect(generated).toContain(`%OldChk=${sourceTask.config.link0.checkpoint}`);
    expect(generated).toContain(`%Chk=${workbench.project.tasks.find(task => task.id === downstream.id).config.link0.checkpoint}`);
    expect(downstream.config.link0.oldCheckpoint).toBeUndefined();
  });

  it('imports a matching local log, passes its gate, and unlocks its dependent step', async () => {
    const singlePoint = { ...config(), route: { method: 'HF', basisSet: '3-21G', jobType: 'SP' } };
    const workbench = new WorkflowWorkbench(makeContainer(), () => singlePoint);
    const first = workbench.addCurrentTask();
    const second = workbench.addCurrentTask();
    expect(workbench.setTaskDependencies(second.id, [first.id])).toBe(true);
    expect(workbench.markTaskAwaitingOutput(first.id)).toBe(true);

    const file = new Blob(['SCF Done: E(RHF) = -0.5 A.U. after 2 cycles\nNormal termination of Gaussian 16\n']);
    Object.defineProperty(file, 'name', { value: first.outputName });
    await workbench.importOutputFiles([file]);

    expect(workbench.project.tasks.find(task => task.id === first.id).attempts[0].overall).toBe('pass');
    const states = deriveTaskStates(workbench.project);
    expect(states[first.id]).toBe('passed');
    expect(states[second.id]).toBe('ready');
  });

  it('loads a validated project locally and renders imported strings as text', () => {
    const source = new WorkflowWorkbench(makeContainer(), () => config());
    source.addCurrentTask();
    source.project.name = '<img src=x onerror=alert(1)>';
    source.project.tasks[0].title = '<b>unsafe title</b>';
    const json = serializeWorkflowProject(source.project);
    const container = makeContainer();
    const target = new WorkflowWorkbench(container, () => config());

    expect(target.loadProjectText(json)).toBe(true);
    expect(target.project.name).toBe('<img src=x onerror=alert(1)>');
    expect(container.innerHTML).toContain('&lt;img');
    expect(container.innerHTML).toContain('&lt;b&gt;unsafe title&lt;/b&gt;');
    expect(container.innerHTML).not.toContain('<img');
  });

  it('refuses invalid project JSON without replacing current work', () => {
    const workbench = new WorkflowWorkbench(makeContainer(), () => config());
    const task = workbench.addCurrentTask();
    const projectId = workbench.project.id;
    expect(workbench.loadProjectText('{"schemaVersion":999,"tasks":[]}')).toBe(false);
    expect(workbench.project.id).toBe(projectId);
    expect(workbench.project.tasks[0].id).toBe(task.id);
    expect(workbench.statusMessage).toMatch(/unsupported workflow schema/i);
  });

  it('re-evaluates retained bounded output evidence after a gate change and keeps dependents stale', () => {
    const singlePoint = { ...config(), route: { method: 'HF', basisSet: '3-21G', jobType: 'SP' } };
    const workbench = new WorkflowWorkbench(makeContainer(), () => singlePoint);
    const task = workbench.addCurrentTask();
    workbench.markTaskAwaitingOutput(task.id);
    workbench.queueParsedOutput(parseGaussianLogText('Normal termination of Gaussian 16', task.outputName));
    expect(deriveTaskStates(workbench.project)[task.id]).toBe('passed');

    workbench.updateGate(task.id, 'requireScfRecord', true);
    expect(deriveTaskStates(workbench.project)[task.id]).toBe('needs-review');
    expect(workbench.project.tasks[0].attempts).toHaveLength(1);
    expect(workbench.project.tasks[0].attempts[0].overall).toBe('unknown');
  });

  it('rejects output filenames containing path or control characters before creating pending state', async () => {
    const singlePoint = { ...config(), route: { method: 'HF', basisSet: '3-21G', jobType: 'SP' } };
    const workbench = new WorkflowWorkbench(makeContainer(), () => singlePoint);
    const task = workbench.addCurrentTask();
    workbench.markTaskAwaitingOutput(task.id);
    const file = new Blob(['Normal termination of Gaussian 16']);
    Object.defineProperty(file, 'name', { value: `bad
name.log` });

    await workbench.importOutputFiles([file]);

    expect(workbench.pendingOutputs).toHaveLength(0);
    expect(workbench.project.tasks[0].attempts).toHaveLength(0);
    expect(workbench.statusMessage).toMatch(/filename/i);
  });

  it('keeps dependents blocked when an upstream output fails and retries retain history', () => {
    const singlePoint = { ...config(), route: { method: 'HF', basisSet: '3-21G', jobType: 'SP' } };
    const workbench = new WorkflowWorkbench(makeContainer(), () => singlePoint);
    const first = workbench.addCurrentTask();
    const second = workbench.addCurrentTask();
    workbench.setTaskDependencies(second.id, [first.id]);
    workbench.markTaskAwaitingOutput(first.id);
    workbench.queueParsedOutput(parseGaussianLogText('Error termination request processed', first.outputName));

    const states = deriveTaskStates(workbench.project);
    expect(states[first.id]).toBe('failed');
    expect(states[second.id]).toBe('blocked');
    expect(() => workbench.buildTaskInput(second.id)).toThrow(/not ready/i);
    expect(workbench.retryTask(first.id)).toBe(true);
    expect(deriveTaskStates(workbench.project)[first.id]).toBe('ready');
    expect(deriveTaskStates(workbench.project)[second.id]).toBe('blocked');
    expect(workbench.project.tasks.find(task => task.id === first.id).attempts).toHaveLength(1);
  });

  it('requires explicit task and section assignment for unmatched or multi-section logs', () => {
    const singlePoint = { ...config(), route: { method: 'HF', basisSet: '3-21G', jobType: 'SP' } };
    const workbench = new WorkflowWorkbench(makeContainer(), () => singlePoint);
    const task = workbench.addCurrentTask();
    workbench.markTaskAwaitingOutput(task.id);
    const parsed = parseGaussianLogText(
      `UNIQUE_RAW_SENTINEL
Normal termination of Gaussian 16
Entering Gaussian System
Normal termination of Gaussian 16`,
      'unmatched.out',
    );
    workbench.queueParsedOutput(parsed);
    expect(workbench.pendingOutputs).toHaveLength(1);
    expect(deriveTaskStates(workbench.project)[task.id]).toBe('awaiting-output');
    expect(workbench.assignPendingOutput(workbench.pendingOutputs[0].id, task.id, 0)).toBe(true);
    expect(deriveTaskStates(workbench.project)[task.id]).toBe('passed');
    expect(JSON.stringify(workbench.project)).not.toContain('UNIQUE_RAW_SENTINEL');
  });
});
