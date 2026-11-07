import { describe, expect, it } from 'vitest';
import {
  createWorkflowProject,
  createWorkflowTask,
  deriveTaskStates,
  invalidateTaskAndDescendants,
  topologicallySortTasks,
  validateWorkflowProject,
} from '../src/utils/workflowModel.js';

function makeTask(id, dependencies = [], overrides = {}) {
  return {
    id,
    title: `Task ${id}`,
    config: {
      link0: { checkpoint: `${id}.chk` },
      route: { method: 'HF', basisSet: '3-21G', jobType: 'SP' },
      title: `Task ${id}`,
      charge: 0,
      multiplicity: 2,
      atoms: [{ symbol: 'H', x: 0, y: 0, z: 0 }],
    },
    inputName: `${id}.gjf`,
    outputName: `${id}.log`,
    dependencies,
    checkpointFromTaskId: null,
    gates: {
      requireNormalTermination: true,
      requireScfRecord: false,
      requireOptimizationComplete: false,
      requireFrequencyRecord: false,
      expectedImaginaryModes: null,
    },
    activeAttemptId: null,
    lastExportedAt: null,
    attempts: [],
    ...overrides,
  };
}

function makeAttempt(id, overall, status = 'completed') {
  return {
    id,
    outputFilename: `${id}.log`,
    importedAt: '2026-11-06T00:00:00.000Z',
    overall,
    gates: [{ name: 'Normal termination', required: true, result: overall, line: 1, evidence: 'Normal termination of Gaussian' }],
    summary: { status, sectionIndex: 1 },
  };
}

function makeProject(tasks) {
  return {
    schemaVersion: 1,
    id: 'project-1',
    name: 'Hydrogen workflow',
    createdAt: '2026-11-06T00:00:00.000Z',
    updatedAt: '2026-11-06T00:00:00.000Z',
    tasks,
  };
}

describe('workflow graph ordering', () => {
  it('returns a stable topological order when tasks have multiple prerequisites', () => {
    const tasks = [
      makeTask('final', ['opt', 'freq']),
      makeTask('opt'),
      makeTask('freq', ['opt']),
      makeTask('independent'),
    ];

    expect(topologicallySortTasks(tasks).map(task => task.id))
      .toEqual(['opt', 'freq', 'final', 'independent']);
  });

  it('rejects cycles instead of returning a partial order', () => {
    const tasks = [makeTask('a', ['b']), makeTask('b', ['a'])];
    expect(() => topologicallySortTasks(tasks)).toThrow(/cycle/i);
  });
});

describe('workflow project validation', () => {
  it('snapshots a GJF config and derives conservative default gates', () => {
    const config = makeTask('source').config;
    config.route.jobType = 'Opt Freq';
    const task = createWorkflowTask(config, { inputName: 'water-opt.gjf', outputName: 'water-opt.log' });
    expect(task.config).not.toBe(config);
    expect(task.gates).toEqual({
      requireNormalTermination: true,
      requireScfRecord: false,
      requireOptimizationComplete: true,
      requireFrequencyRecord: true,
      requireThermochemistry: true,
      expectedImaginaryModes: null,
    });
    config.route.jobType = 'SP';
    expect(task.config.route.jobType).toBe('Opt Freq');
  });

  it('rejects multi-line route or title fields that could alter generated GJF structure', () => {
    const task = makeTask('unsafe');
    task.config.route.custom = `SCF=Tight
%Chk=other.chk`;
    const result = validateWorkflowProject(makeProject([task]));
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/route.*single line/i);
  });

  it('creates a valid project and trims its name', () => {
    const project = createWorkflowProject('  Water chain  ');
    expect(project.name).toBe('Water chain');
    expect(validateWorkflowProject(project)).toEqual({ valid: true, errors: [] });
  });

  it('requires output gates implied by Opt and Freq route keywords', () => {
    const optTask = makeTask('opt');
    optTask.config.route.jobType = 'Opt';
    optTask.gates.requireOptimizationComplete = false;
    const freqTask = makeTask('freq');
    freqTask.config.route.custom = 'Freq';
    freqTask.gates.requireFrequencyRecord = false;
    const result = validateWorkflowProject(makeProject([optTask, freqTask]));
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/Opt route.*optimization gate/i);
    expect(result.errors.join(' ')).toMatch(/Freq route.*frequency gate/i);
  });

  it('accepts a valid versioned project', () => {
    expect(validateWorkflowProject(makeProject([makeTask('root')]))).toEqual({ valid: true, errors: [] });
  });

  it.each([
    ['duplicate task IDs', [makeTask('same'), makeTask('same')], /duplicate/i],
    ['missing dependency IDs', [makeTask('child', ['missing'])], /missing dependency/i],
    ['self-dependencies', [makeTask('self', ['self'])], /itself|self-dependency/i],
    ['cyclic dependencies', [makeTask('a', ['b']), makeTask('b', ['a'])], /cycle/i],
  ])('rejects %s', (_label, tasks, expectedError) => {
    const result = validateWorkflowProject(makeProject(tasks));
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(expectedError);
  });

  it('requires a direct upstream checkpoint binding for Geom=AllCheck and Guess=Read', () => {
    const project = makeProject([
      makeTask('opt'),
      makeTask('freq', ['opt'], {
        checkpointFromTaskId: 'opt',
        gates: { ...makeTask('freq').gates, requireFrequencyRecord: true },
        config: {
          ...makeTask('freq').config,
          route: { method: 'HF', basisSet: '3-21G', jobType: 'Freq Geom=AllCheck Guess=Read' },
        },
      }),
    ]);
    expect(validateWorkflowProject(project)).toEqual({ valid: true, errors: [] });

    project.tasks[1].checkpointFromTaskId = null;
    const invalid = validateWorkflowProject(project);
    expect(invalid.valid).toBe(false);
    expect(invalid.errors.join(' ')).toMatch(/checkpoint input keywords.*source dependency/i);

    const geomCheckpoint = makeTask('geom-checkpoint', ['opt'], {
      checkpointFromTaskId: 'opt',
      config: {
        ...makeTask('geom-checkpoint').config,
        route: { method: 'HF', basisSet: '3-21G', jobType: 'SP Geom=Checkpoint' },
      },
    });
    const geometryProject = makeProject([makeTask('opt'), geomCheckpoint]);
    expect(validateWorkflowProject(geometryProject).valid).toBe(true);
    geomCheckpoint.checkpointFromTaskId = null;
    expect(validateWorkflowProject(geometryProject).errors.join(' '))
      .toMatch(/Geom=Checkpoint.*checkpoint source/i);
  });

  it('rejects mismatched and colliding checkpoint filenames', () => {
    const source = makeTask('source');
    const downstream = makeTask('downstream', ['source'], {
      checkpointFromTaskId: 'source',
      config: { ...makeTask('downstream').config, link0: { oldCheckpoint: 'wrong.chk', checkpoint: 'next.chk' } },
    });
    const mismatch = validateWorkflowProject(makeProject([source, downstream]));
    expect(mismatch.valid).toBe(false);
    expect(mismatch.errors.join(' ')).toMatch(/OldChk must match/i);

    downstream.config.link0 = { checkpoint: 'source.chk' };
    downstream.checkpointFromTaskId = null;
    const collision = validateWorkflowProject(makeProject([source, downstream]));
    expect(collision.valid).toBe(false);
    expect(collision.errors.join(' ')).toMatch(/checkpoint names must be unique/i);
  });

  it('rejects a checkpoint source that is not a direct dependency', () => {
    const project = makeProject([
      makeTask('root'),
      makeTask('middle', ['root']),
      makeTask('end', ['middle'], { checkpointFromTaskId: 'root' }),
    ]);
    const result = validateWorkflowProject(project);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/checkpoint.*direct dependency/i);
  });
});

describe('derived task states and invalidation', () => {
  it('blocks descendants until every prerequisite has passed', () => {
    const project = makeProject([makeTask('root'), makeTask('child', ['root'])]);
    expect(deriveTaskStates(project)).toEqual({ root: 'ready', child: 'blocked' });

    project.tasks[0].lastExportedAt = '2026-11-06T01:00:00.000Z';
    expect(deriveTaskStates(project)).toEqual({ root: 'awaiting-output', child: 'blocked' });

    project.tasks[0].attempts.push(makeAttempt('pass-1', 'pass'));
    project.tasks[0].activeAttemptId = 'pass-1';
    expect(deriveTaskStates(project)).toEqual({ root: 'passed', child: 'ready' });

    project.tasks[0].attempts[0].overall = 'fail';
    expect(deriveTaskStates(project)).toEqual({ root: 'failed', child: 'blocked' });

    project.tasks[0].attempts[0].overall = 'unknown';
    expect(deriveTaskStates(project)).toEqual({ root: 'needs-review', child: 'blocked' });
    project.tasks[0].attempts[0].summary = { status: 'incomplete', sectionIndex: 1 };
    expect(deriveTaskStates(project)).toEqual({ root: 'incomplete', child: 'blocked' });
  });

  it('invalidates active results for the edited task and every descendant, preserving history', () => {
    const project = makeProject([
      makeTask('root', [], {
        activeAttemptId: 'root-attempt',
        lastExportedAt: '2026-11-06T01:00:00.000Z',
        attempts: [makeAttempt('root-attempt', 'pass')],
      }),
      makeTask('child', ['root'], {
        activeAttemptId: 'child-attempt',
        attempts: [makeAttempt('child-attempt', 'pass')],
      }),
      makeTask('unrelated', [], { lastExportedAt: '2026-11-06T02:00:00.000Z' }),
    ]);

    const invalidated = invalidateTaskAndDescendants(project, 'root');
    expect(invalidated.tasks[0].activeAttemptId).toBeNull();
    expect(invalidated.tasks[0].lastExportedAt).toBeNull();
    expect(invalidated.tasks[0].attempts).toHaveLength(1);
    expect(invalidated.tasks[1].activeAttemptId).toBeNull();
    expect(invalidated.tasks[1].attempts).toHaveLength(1);
    expect(invalidated.tasks[2].lastExportedAt).toBe('2026-11-06T02:00:00.000Z');
    expect(project.tasks[0].activeAttemptId).toBe('root-attempt');
  });
});
