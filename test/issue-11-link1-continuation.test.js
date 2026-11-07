import { describe, expect, it } from 'vitest';
import { buildLink1Input, generateGJF } from '../src/generators/gjfGenerator.js';
import {
  createWorkflowProject,
  createWorkflowTask,
  routeReadsCheckpoint,
  validateWorkflowProject,
} from '../src/utils/workflowModel.js';
import { WorkflowWorkbench } from '../src/components/WorkflowWorkbench.js';

/**
 * Issue #11 — `--Link1--` export and the "continues from an earlier step"
 * intent.
 *
 * Documented layout (https://gaussian.com/input/): each successive job step is
 * separated by a line containing `--Link1--`, and a blank line must precede
 * that line. Link 0 commands belong to a specific step, and `%OldChk` copies
 * the named checkpoint into the current step's `%Chk` at the start of that
 * step (https://gaussian.com/link0/). The export therefore repeats the Link 0
 * block for the continuation instead of putting `%OldChk`/`%Chk` only in the
 * first link.
 */

const WATER_ATOMS = [
  { symbol: 'O', x: 0.0, y: 0.0, z: 0.1197 },
  { symbol: 'H', x: 0.0, y: 0.7615, z: -0.4789 },
  { symbol: 'H', x: 0.0, y: -0.7615, z: -0.4789 },
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function upstreamConfig() {
  return {
    link0: { memory: '4GB', nproc: 4, checkpoint: 'water-opt.chk' },
    route: { verbosity: '#N', method: 'HF', basisSet: '3-21G', jobType: 'Opt' },
    title: 'Water optimization',
    charge: 0,
    multiplicity: 1,
    atoms: WATER_ATOMS,
  };
}

function continuationConfig(jobType, checkpoint = 'water-freq.chk') {
  return {
    link0: {
      memory: '4GB',
      nproc: 4,
      oldCheckpoint: 'water-opt.chk',
      checkpoint,
    },
    route: { verbosity: '#N', method: 'HF', basisSet: '3-21G', jobType },
    title: 'Water frequency',
    charge: 0,
    multiplicity: 1,
    atoms: WATER_ATOMS,
  };
}

const UPSTREAM_LINK = [
  '%Mem=4GB',
  '%NProcShared=4',
  '%Chk=water-opt.chk',
  '#N HF/3-21G Opt',
  '',
  'Water optimization',
  '',
  '0 1',
  ' O       0.000000    0.000000    0.119700',
  ' H       0.000000    0.761500   -0.478900',
  ' H       0.000000   -0.761500   -0.478900',
].join('\n');

const CHECKPOINT_CONTINUATION = [
  '%Mem=4GB',
  '%NProcShared=4',
  '%OldChk=water-opt.chk',
  '%Chk=water-freq.chk',
  '#N HF/3-21G Freq Geom=Checkpoint Guess=Read',
  '',
  'Water frequency',
  '',
  '0 1',
].join('\n');

const ALLCHECK_CONTINUATION = [
  '%Mem=4GB',
  '%NProcShared=4',
  '%OldChk=water-opt.chk',
  '%Chk=water-freq.chk',
  '#N HF/3-21G Freq Geom=AllCheck Guess=Read',
].join('\n');

describe('Issue #11 — buildLink1Input', () => {
  it('emits the documented blank line, --Link1-- separator and per-link checkpoint commands for opt -> freq', () => {
    const gjf = buildLink1Input([
      upstreamConfig(),
      continuationConfig('Freq Geom=Checkpoint Guess=Read'),
    ]);

    expect(gjf).toBe(`${UPSTREAM_LINK}\n\n--Link1--\n${CHECKPOINT_CONTINUATION}\n`);
    expect(gjf.match(/^--Link1--$/gm)).toHaveLength(1);
    // The continuation is a separate job step, so it owns its Link 0 block.
    expect(gjf.split('--Link1--')[0]).not.toContain('%OldChk');
    expect(gjf.split('--Link1--')[1]).toContain('%OldChk=water-opt.chk');
    expect(gjf.split('--Link1--')[1]).toContain('%Chk=water-freq.chk');
  });

  it('emits an AllCheck continuation with only the route section in the second link', () => {
    const gjf = buildLink1Input([
      upstreamConfig(),
      continuationConfig('Freq Geom=AllCheck Guess=Read'),
    ]);

    expect(gjf).toBe(`${UPSTREAM_LINK}\n\n--Link1--\n${ALLCHECK_CONTINUATION}\n\n`);
  });

  it('rejects a pair that is not a checkpoint continuation', () => {
    const withoutUpstreamCheckpoint = upstreamConfig();
    delete withoutUpstreamCheckpoint.link0.checkpoint;
    expect(() => buildLink1Input([withoutUpstreamCheckpoint, continuationConfig('Freq Geom=Checkpoint')]))
      .toThrow(/%Chk/);

    const withoutOldCheckpoint = continuationConfig('Freq Geom=Checkpoint');
    delete withoutOldCheckpoint.link0.oldCheckpoint;
    expect(() => buildLink1Input([upstreamConfig(), withoutOldCheckpoint]))
      .toThrow(/%OldChk/);

    const mismatched = continuationConfig('Freq Geom=Checkpoint');
    mismatched.link0.oldCheckpoint = 'other.chk';
    expect(() => buildLink1Input([upstreamConfig(), mismatched]))
      .toThrow(/must name the upstream checkpoint/);

    expect(() => buildLink1Input([upstreamConfig(), continuationConfig('Freq Geom=Checkpoint', 'water-opt.chk')]))
      .toThrow(/distinct checkpoint/);

    expect(() => buildLink1Input([upstreamConfig()])).toThrow(/exactly two/);
  });
});

describe('Issue #11 — legacy checkpoint geometry spellings', () => {
  it('omits atom coordinates for Geom=Check as it does for Geom=Checkpoint', () => {
    const gjf = generateGJF(continuationConfig('Freq Geom=Check Guess=Read'));

    expect(gjf).toContain('#N HF/3-21G Freq Geom=Check Guess=Read');
    expect(gjf.trimEnd().split('\n').pop()).toBe('0 1');
    expect(gjf).not.toContain(' O       0.000000');
  });

  it('omits atom coordinates when Step=N is combined with Checkpoint in a parenthesised list', () => {
    const gjf = generateGJF(continuationConfig('Freq Geom=(Step=3,Checkpoint)'));

    expect(gjf.trimEnd().split('\n').pop()).toBe('0 1');
    expect(gjf).not.toContain(' O       0.000000');
  });
});

function modelConfig(overrides = {}) {
  return {
    link0: { checkpoint: 'water.chk' },
    route: { verbosity: '#N', method: 'HF', basisSet: '3-21G', jobType: 'Opt' },
    title: 'Water optimization',
    charge: 0,
    multiplicity: 1,
    atoms: WATER_ATOMS,
    ...overrides,
  };
}

function makeTask(id, dependencies = [], overrides = {}) {
  return createWorkflowTask(overrides.config || modelConfig(), {
    id,
    title: id,
    inputName: `${id}.gjf`,
    outputName: `${id}.log`,
    dependencies,
    checkpointFromTaskId: overrides.checkpointFromTaskId ?? null,
    gates: overrides.gates,
  });
}

function makeProject(tasks) {
  const project = createWorkflowProject('issue 11');
  project.tasks = tasks;
  return project;
}

describe('Issue #11 — checkpoint-route detection', () => {
  it.each([
    ['Geom=Checkpoint', true],
    ['Geom=Check', true],
    ['Geom=AllCheck', true],
    ['Geom=Step=3', true],
    ['Geom=Step=Original', true],
    ['Geom=(Step=3,Checkpoint)', true],
    ['Geom=(Checkpoint,Step=3)', true],
    ['Geom=(Step=3,AllCheck)', true],
    ['Geom = AllCheck', true],
    ['Guess=Read', true],
    ['Freq', false],
    ['Geom=StepThree', false],
  ])('routeReadsCheckpoint(%s) === %s', (routeText, expected) => {
    expect(routeReadsCheckpoint(routeText)).toBe(expected);
  });

  it.each([
    'SP Geom=Check',
    'SP Geom=Step=3',
    'SP Geom=(Step=3,Checkpoint)',
    'SP Geom=(Step=3,AllCheck)',
  ])('requires a direct checkpoint binding for %s', (jobType) => {
    const project = makeProject([
      makeTask('opt'),
      makeTask('down', ['opt'], {
        checkpointFromTaskId: 'opt',
        config: {
          ...modelConfig({ link0: { checkpoint: 'down.chk' } }),
          route: { verbosity: '#N', method: 'HF', basisSet: '3-21G', jobType },
        },
      }),
    ]);
    expect(validateWorkflowProject(project)).toEqual({ valid: true, errors: [] });

    project.tasks[1].checkpointFromTaskId = null;
    const unbound = validateWorkflowProject(project);
    expect(unbound.valid).toBe(false);
    expect(unbound.errors.join(' ')).toMatch(/checkpoint input keywords.*checkpoint source dependency/i);
  });

  it('does not let Geom=Step=3 borrow a checkpoint source that is not a direct dependency', () => {
    const project = makeProject([
      makeTask('root'),
      makeTask('middle', ['root']),
      makeTask('end', ['middle'], {
        checkpointFromTaskId: 'root',
        config: {
          ...modelConfig(),
          route: { verbosity: '#N', method: 'HF', basisSet: '3-21G', jobType: 'SP Geom=Step=3' },
        },
      }),
    ]);
    const result = validateWorkflowProject(project);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/checkpoint.*direct dependency/i);
  });
});

function makeContainer() {
  return {
    innerHTML: '',
    querySelector: () => null,
    querySelectorAll: () => [],
  };
}

function activeConfig() {
  return {
    link0: { memory: '4GB', nproc: 4, checkpoint: 'water-opt.chk' },
    route: { verbosity: '#N', method: 'HF', basisSet: '3-21G', jobType: 'Opt' },
    title: 'Water optimization',
    charge: 0,
    multiplicity: 1,
    atoms: WATER_ATOMS,
  };
}

function passTask(workbench, taskId) {
  const task = workbench.project.tasks.find(item => item.id === taskId);
  task.attempts.push({
    id: `${taskId}-pass`,
    outputFilename: task.outputName,
    importedAt: '2026-11-06T00:00:00.000Z',
    overall: 'pass',
    gates: [{ name: 'Normal termination', required: true, result: 'pass', line: 1, evidence: 'Normal termination of Gaussian' }],
    summary: { status: 'completed', sectionIndex: 1 },
  });
  task.activeAttemptId = `${taskId}-pass`;
}

describe('Issue #11 — continuation intent in the task editor', () => {
  it('renders the intent selector and the Link1 export action', () => {
    const workbench = new WorkflowWorkbench(makeContainer(), () => clone(activeConfig()));
    const source = workbench.addCurrentTask();
    expect(workbench.container.innerHTML).toContain('id="workflow-new-intent"');
    expect(workbench.container.innerHTML).toContain('Continues from an earlier step');

    workbench.addCurrentTask({
      dependencies: [source.id],
      checkpointFromTaskId: source.id,
      intent: 'checkpoint',
    });
    expect(workbench.container.innerHTML).toContain('data-workflow-action="export-link1"');
  });

  it('sets Geom=Checkpoint Guess=Read without hand-editing the route and refuses an unbound task', () => {
    const workbench = new WorkflowWorkbench(makeContainer(), () => clone(activeConfig()));
    const source = workbench.addCurrentTask();
    expect(source).not.toBeNull();

    expect(workbench.addCurrentTask({ intent: 'checkpoint' })).toBeNull();
    expect(workbench.statusMessage).toMatch(/checkpoint/i);

    expect(workbench.addCurrentTask({
      checkpointFromTaskId: source.id,
      intent: 'checkpoint',
    })).toBeNull();
    expect(workbench.statusMessage).toMatch(/direct dependency/i);

    const continuation = workbench.addCurrentTask({
      dependencies: [source.id],
      checkpointFromTaskId: source.id,
      intent: 'checkpoint',
    });
    expect(continuation).not.toBeNull();
    expect(continuation.config.route.jobType).toBe('Opt');
    expect(continuation.config.route.custom).toBe('Geom=Checkpoint Guess=Read');
    expect(validateWorkflowProject(workbench.project).valid).toBe(true);
  });

  it('offers Geom=AllCheck as the explicit alternative and replaces stale Geom/Guess spellings', () => {
    const configs = [
      activeConfig(),
      activeConfig(),
      {
        ...activeConfig(),
        route: {
          verbosity: '#N',
          method: 'HF',
          basisSet: '3-21G',
          jobType: 'Opt Geom=Check Guess=Read',
          custom: 'MaxCycle=100',
        },
      },
    ];
    const workbench = new WorkflowWorkbench(makeContainer(), () => clone(configs.shift()));
    const source = workbench.addCurrentTask();

    const allCheck = workbench.addCurrentTask({
      dependencies: [source.id],
      checkpointFromTaskId: source.id,
      intent: 'allcheck',
    });
    expect(allCheck.config.route.jobType).toBe('Opt');
    expect(allCheck.config.route.custom).toBe('Geom=AllCheck');

    const rewritten = workbench.addCurrentTask({
      dependencies: [source.id],
      checkpointFromTaskId: source.id,
      intent: 'checkpoint',
    });
    expect(rewritten.config.route.jobType).toBe('Opt');
    expect(rewritten.config.route.custom).toBe('MaxCycle=100 Geom=Checkpoint Guess=Read');
  });
});

describe('Issue #11 — workbench export modes', () => {
  function makeContinuationWorkbench() {
    const configs = [
      activeConfig(),
      {
        ...activeConfig(),
        link0: { ...activeConfig().link0, checkpoint: 'water-freq.chk' },
        route: { verbosity: '#N', method: 'HF', basisSet: '3-21G', jobType: 'Freq' },
        title: 'Water frequency',
      },
    ];
    const workbench = new WorkflowWorkbench(makeContainer(), () => clone(configs.shift()));
    const source = workbench.addCurrentTask();
    const continuation = workbench.addCurrentTask({
      dependencies: [source.id],
      checkpointFromTaskId: source.id,
      intent: 'checkpoint',
    });
    return { workbench, source, continuation };
  }

  const SINGLE_EXPORT = [
    '%Mem=4GB',
    '%NProcShared=4',
    '%OldChk=water-opt.chk',
    '%Chk=water-freq.chk',
    '#N HF/3-21G Freq Geom=Checkpoint Guess=Read',
    '',
    'Water frequency',
    '',
    '0 1',
    '',
  ].join('\n');

  it('keeps the existing single-task export byte-identical and adds Link1 only on request', () => {
    const { workbench, source, continuation } = makeContinuationWorkbench();
    passTask(workbench, source.id);

    expect(workbench.buildTaskInput(continuation.id)).toBe(SINGLE_EXPORT);
    expect(workbench.buildTaskInput(continuation.id)).not.toContain('--Link1--');

    const link1 = workbench.buildTaskLink1Input(continuation.id);
    expect(link1).toBe(`${UPSTREAM_LINK}\n\n--Link1--\n${SINGLE_EXPORT}`);
    expect(link1.match(/^--Link1--$/gm)).toHaveLength(1);
    expect(link1.match(/#N HF\/3-21G Freq/gm)).toHaveLength(1);
  });

  it('requires the continuation task to be ready and to have a checkpoint source', () => {
    const { workbench, source, continuation } = makeContinuationWorkbench();

    expect(() => workbench.buildTaskLink1Input(continuation.id)).toThrow(/not ready/i);
    expect(() => workbench.buildTaskLink1Input(source.id)).toThrow(/no checkpoint source/i);
  });

  it('emits only link 0 and the route for an AllCheck continuation', () => {
    const configs = [
      activeConfig(),
      {
        ...activeConfig(),
        link0: { ...activeConfig().link0, checkpoint: 'water-freq.chk' },
        route: { verbosity: '#N', method: 'HF', basisSet: '3-21G', jobType: 'Freq' },
        title: 'Water frequency',
      },
    ];
    const workbench = new WorkflowWorkbench(makeContainer(), () => clone(configs.shift()));
    const source = workbench.addCurrentTask();
    const continuation = workbench.addCurrentTask({
      dependencies: [source.id],
      checkpointFromTaskId: source.id,
      intent: 'allcheck',
    });
    passTask(workbench, source.id);

    const expected = [
      UPSTREAM_LINK,
      '',
      '--Link1--',
      '%Mem=4GB',
      '%NProcShared=4',
      '%OldChk=water-opt.chk',
      '%Chk=water-freq.chk',
      '#N HF/3-21G Freq Geom=AllCheck',
    ].join('\n') + '\n\n';
    expect(workbench.buildTaskLink1Input(continuation.id)).toBe(expected);
  });
});
