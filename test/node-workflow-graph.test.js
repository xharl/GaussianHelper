import { describe, expect, it } from 'vitest';
import {
  GRAPH_NODE_HEIGHT,
  GRAPH_NODE_WIDTH,
  computeGraphLayout,
  connectionIssue,
  gateSummary,
  graphEdgePath,
  graphNodesOverlap,
  isGraphPosition,
  resolveGraphPositions,
} from '../src/utils/workflowGraph.js';
import {
  createWorkflowProject,
  createWorkflowTask,
  parseWorkflowProjectJson,
  serializeWorkflowProject,
  validateWorkflowProject,
} from '../src/utils/workflowModel.js';
import { WorkflowWorkbench } from '../src/components/WorkflowWorkbench.js';

function config(overrides = {}) {
  return {
    link0: { checkpoint: 'water.chk' },
    route: { method: 'HF', basisSet: '3-21G', jobType: 'Opt' },
    title: 'Water optimization',
    charge: 0,
    multiplicity: 1,
    atoms: [{ symbol: 'O', x: 0, y: 0, z: 0 }],
    ...overrides,
  };
}

function makeContainer() {
  return {
    innerHTML: '',
    querySelector: () => null,
    querySelectorAll: () => [],
  };
}

function projectWith(tasks) {
  return {
    ...createWorkflowProject(),
    tasks,
  };
}

describe('workflow graph geometry', () => {
  it('lays out a diamond on topological levels', () => {
    const tasks = [
      { id: 'a', dependencies: [] },
      { id: 'b', dependencies: ['a'] },
      { id: 'c', dependencies: ['a'] },
      { id: 'd', dependencies: ['b', 'c'] },
    ];
    const layout = computeGraphLayout(tasks);
    expect(layout.a.x).toBeLessThan(layout.b.x);
    expect(layout.b.x).toBe(layout.c.x);
    expect(layout.c.x).toBeLessThan(layout.d.x);
    expect(layout.b.y).not.toBe(layout.c.y);
    expect(layout.a.y).toBe(layout.b.y);
  });

  it('gives stored positions precedence and clamps them into range', () => {
    const tasks = [
      { id: 'a', dependencies: [], graph: { x: 420, y: 260 } },
      { id: 'b', dependencies: ['a'] },
      { id: 'c', dependencies: [], graph: { x: -50, y: 12 } },
    ];
    const positions = resolveGraphPositions(tasks);
    expect(positions.a).toEqual({ x: 420, y: 260 });
    expect(positions.c).toEqual({ x: 0, y: 12 });
    expect(positions.b.x).toBeGreaterThan(0);
  });

  it('draws an edge from the output port to the input port', () => {
    const path = graphEdgePath({ x: 10, y: 20 }, { x: 400, y: 120 });
    expect(path.startsWith(`M ${10 + GRAPH_NODE_WIDTH} ${20 + GRAPH_NODE_HEIGHT / 2} C `)).toBe(true);
    expect(path.endsWith(` 400 ${120 + GRAPH_NODE_HEIGHT / 2}`)).toBe(true);
  });

  it('rejects self, duplicate, and cycle connections', () => {
    const tasks = [
      { id: 'a', dependencies: [] },
      { id: 'b', dependencies: ['a'] },
      { id: 'c', dependencies: ['b'] },
    ];
    expect(connectionIssue(tasks, 'a', 'a')).toMatch(/itself/);
    expect(connectionIssue(tasks, 'a', 'b')).toMatch(/already exists/);
    expect(connectionIssue(tasks, 'c', 'a')).toMatch(/cycle/);
    expect(connectionIssue(tasks, 'a', 'c')).toBeNull();
  });

  it('accepts only finite bounded coordinates', () => {
    expect(isGraphPosition({ x: 1, y: 2 })).toBe(true);
    expect(isGraphPosition({ x: Number.NaN, y: 2 })).toBe(false);
    expect(isGraphPosition({ x: Infinity, y: 2 })).toBe(false);
    expect(isGraphPosition({ x: 1e9, y: 2 })).toBe(false);
    expect(isGraphPosition(null)).toBe(false);
  });

  it('shows the magnitude floor only when a saddle mode is expected', () => {
    const minimum = gateSummary({
      route: { jobType: 'Freq' },
      gates: { expectedImaginaryModes: 0, minImaginaryMagnitude: 50 },
    });
    const saddle = gateSummary({
      route: { jobType: 'Freq' },
      gates: { expectedImaginaryModes: 1, minImaginaryMagnitude: 50 },
    });
    const standard = gateSummary({ route: { jobType: 'Opt' }, gates: {} });
    expect(minimum).toContain('0 imag');
    expect(minimum).not.toContain('≥50');
    expect(saddle).toContain('1 imag');
    expect(saddle).toContain('≥50 cm⁻¹');
    expect(standard).toBe('standard gates');
  });
});

describe('graph positions in the project model', () => {
  it('round-trips a dragged position through save and load', () => {
    const task = createWorkflowTask(config(), {
      inputName: 'water-opt.gjf',
      outputName: 'water-opt.log',
      graph: { x: 320, y: 180 },
    });
    const project = projectWith([task]);
    const json = serializeWorkflowProject(project);
    expect(json).toContain('"graph"');
    const imported = parseWorkflowProjectJson(json);
    expect(imported.tasks[0].graph).toEqual({ x: 320, y: 180 });
  });

  it('rejects a hand-edited position that is not finite', () => {
    const task = createWorkflowTask(config(), { inputName: 'water-opt.gjf', outputName: 'water-opt.log' });
    task.graph = { x: Infinity, y: 0 };
    const validation = validateWorkflowProject(projectWith([task]));
    expect(validation.valid).toBe(false);
    expect(validation.errors.join(' ')).toMatch(/graph position/);
  });

  it('does not add a graph key to tasks that never had one', () => {
    const task = createWorkflowTask(config(), { inputName: 'water-opt.gjf', outputName: 'water-opt.log' });
    expect('graph' in task).toBe(false);
    expect(serializeWorkflowProject(projectWith([task]))).not.toContain('"graph"');
  });
});

describe('Workbench node view', () => {
  it('switches views and renders real tasks with edges and ports', () => {
    const workbench = new WorkflowWorkbench(makeContainer(), () => config());
    const first = workbench.addCurrentTask();
    const second = workbench.addCurrentTask({ dependencies: [first.id] });
    expect(workbench.setView('graph')).toBe(true);
    const html = workbench.container.innerHTML;
    expect(html).toContain('wf-graph-layout');
    expect(html).toContain(`data-graph-task="${first.id}"`);
    expect(html).toContain(`data-graph-port-out="${first.id}"`);
    expect(html).toContain(`data-graph-edge-from="${first.id}" data-graph-edge-to="${second.id}"`);
    expect(html).toContain('Frequency analysis');
  });

  it('adds a block preset that depends on the selected task', () => {
    const workbench = new WorkflowWorkbench(makeContainer(), () => config());
    const first = workbench.addCurrentTask();
    workbench.selectGraphTask(first.id);
    const frequency = workbench.addBlockTask('freq');
    expect(frequency).not.toBeNull();
    expect(frequency.config.route.jobType).toBe('Freq');
    expect(frequency.dependencies).toEqual([first.id]);
    expect(frequency.title).toMatch(/Frequency analysis/);
    expect(frequency.graph.x).toBeGreaterThan(0);
  });

  it('rejects an unknown block without changing the project', () => {
    const workbench = new WorkflowWorkbench(makeContainer(), () => config());
    workbench.addCurrentTask();
    const count = workbench.project.tasks.length;
    expect(workbench.addBlockTask('teleport')).toBeNull();
    expect(workbench.project.tasks.length).toBe(count);
    expect(workbench.statusMessage).toMatch(/unknown/i);
  });

  it('persists a dragged position without touching attempts', () => {
    const workbench = new WorkflowWorkbench(makeContainer(), () => config());
    const task = workbench.addCurrentTask();
    const attempts = workbench.project.tasks[0].attempts;
    expect(workbench.moveTaskNode(task.id, 640, 300)).toBe(true);
    const moved = workbench.project.tasks.find(candidate => candidate.id === task.id);
    expect(moved.graph).toEqual({ x: 640, y: 300 });
    expect(moved.attempts).toBe(attempts);
    expect(workbench.statusMessage).toMatch(/Moved/);
  });

  it('connects and disconnects nodes through the graph API', () => {
    const workbench = new WorkflowWorkbench(makeContainer(), () => config());
    const first = workbench.addCurrentTask();
    const second = workbench.addCurrentTask();
    expect(workbench.connectGraphTasks(first.id, second.id)).toBe(true);
    expect(workbench.project.tasks.find(task => task.id === second.id).dependencies).toEqual([first.id]);

    expect(workbench.disconnectGraphEdge(first.id, second.id)).toBe(true);
    expect(workbench.project.tasks.find(task => task.id === second.id).dependencies).toEqual([]);
  });

  it('refuses a cycle through the graph API', () => {
    const workbench = new WorkflowWorkbench(makeContainer(), () => config());
    const first = workbench.addCurrentTask();
    const second = workbench.addCurrentTask({ dependencies: [first.id] });
    expect(workbench.connectGraphTasks(second.id, first.id)).toBe(false);
    expect(workbench.statusMessage).toMatch(/cycle/i);
    expect(workbench.project.tasks.find(task => task.id === first.id).dependencies).toEqual([]);
  });

  it('clears a checkpoint hand-off and removes the continuation tokens', () => {
    const workbench = new WorkflowWorkbench(makeContainer(), () => config());
    const source = workbench.addCurrentTask();
    const downstream = workbench.addCurrentTask({ dependencies: [source.id] });
    expect(workbench.setCheckpointHandoff(source.id, downstream.id, 'checkpoint')).toBe(true);
    expect(workbench.clearCheckpointHandoff(source.id, downstream.id)).toBe(true);
    const updated = workbench.project.tasks.find(task => task.id === downstream.id);
    expect(updated.dependencies).toEqual([source.id]);
    expect(updated.checkpointFromTaskId).toBeNull();
    expect(updated.config.route.custom || '').not.toMatch(/Geom=|Guess=/);
  });

  it('validates structure without claiming run gates passed', () => {
    const workbench = new WorkflowWorkbench(makeContainer(), () => config());
    workbench.addCurrentTask();
    expect(workbench.validateGraph()).toBe(true);
    expect(workbench.statusMessage).toMatch(/structural validation/i);
    expect(workbench.statusMessage).toMatch(/gates need imported Gaussian output/i);
  });

  it('auto-expands on first graph entry and respects an explicit collapse', () => {
    const workbench = new WorkflowWorkbench(makeContainer(), () => config());
    workbench.addCurrentTask();
    workbench.setView('graph');
    expect(workbench.graphFocus).toBe(true);
    expect(workbench.handleGraphAction({ dataset: { graphAction: 'toggle-focus' } })).toBe(false);
    expect(workbench.graphFocus).toBe(false);
    expect(workbench.handleGraphAction({ dataset: { graphAction: 'toggle-focus' } })).toBe(true);
    expect(workbench.project.tasks.length).toBe(1);
  });

  it('avoids collisions when auto-placing around saved positions', () => {
    const tasks = [
      { id: 'a', dependencies: [], graph: { x: 48, y: 48 } },
      { id: 'b', dependencies: [] },
    ];
    const positions = resolveGraphPositions(tasks);
    expect(positions.a).toEqual({ x: 48, y: 48 });
    expect(positions.b).not.toEqual(positions.a);
    expect(positions.b.y).toBeGreaterThan(48);
  });

  it('binds an upstream checkpoint and rewrites the downstream route', () => {
    const workbench = new WorkflowWorkbench(makeContainer(), () => config());
    const source = workbench.addCurrentTask();
    const downstream = workbench.addCurrentTask({ dependencies: [source.id] });
    expect(workbench.setCheckpointHandoff(source.id, downstream.id, 'allcheck')).toBe(true);
    const updated = workbench.project.tasks.find(task => task.id === downstream.id);
    expect(updated.checkpointFromTaskId).toBe(source.id);
    expect(updated.config.route.custom).toMatch(/Geom=AllCheck/);
    expect(workbench.setCheckpointHandoff(source.id, downstream.id, 'checkpoint')).toBe(true);
    const rebound = workbench.project.tasks.find(task => task.id === downstream.id);
    expect(rebound.config.route.custom).toMatch(/Geom=Checkpoint/);
    expect(rebound.config.route.custom).toMatch(/Guess=Read/);
    expect(rebound.config.route.custom).not.toMatch(/Geom=AllCheck/);
  });

  it('refuses a checkpoint hand-off without a direct dependency', () => {
    const workbench = new WorkflowWorkbench(makeContainer(), () => config());
    const source = workbench.addCurrentTask();
    const unrelated = workbench.addCurrentTask();
    expect(workbench.setCheckpointHandoff(source.id, unrelated.id, 'checkpoint')).toBe(false);
    expect(workbench.statusMessage).toMatch(/direct dependency/i);
  });

  it('places successive blocks without overlapping', () => {
    const workbench = new WorkflowWorkbench(makeContainer(), () => config());
    const first = workbench.addCurrentTask();
    workbench.selectGraphTask(first.id);
    const freq = workbench.addBlockTask('freq');
    workbench.selectGraphTask(freq.id);
    const sp = workbench.addBlockTask('sp');
    const positions = resolveGraphPositions(workbench.project.tasks);
    const entries = Object.entries(positions);
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        expect(graphNodesOverlap(entries[i][1], entries[j][1])).toBe(false);
      }
    }
    expect(sp.graph).toBeDefined();
  });

  it('renders quick edits and edge hand-off controls', () => {
    const workbench = new WorkflowWorkbench(makeContainer(), () => config());
    const source = workbench.addCurrentTask();
    const downstream = workbench.addCurrentTask({ dependencies: [source.id] });
    workbench.setView('graph');
    workbench.selectGraphTask(downstream.id);
    expect(workbench.container.innerHTML).toContain('data-graph-title=');
    expect(workbench.container.innerHTML).toContain('data-graph-imaginary=');
    workbench.selectGraphEdge(source.id, downstream.id);
    expect(workbench.container.innerHTML).toContain('data-graph-action="handoff-checkpoint"');
    expect(workbench.container.innerHTML).toContain('Geom=AllCheck');
  });

  it('fits the zoom inside the supported range', () => {
    const workbench = new WorkflowWorkbench(makeContainer(), () => config());
    for (let index = 0; index < 8; index += 1) workbench.addCurrentTask();
    const zoom = workbench.zoomGraph('fit');
    expect(zoom).toBeGreaterThanOrEqual(0.5);
    expect(zoom).toBeLessThanOrEqual(1);
  });

  it('duplicates a task into a free slot and selects the copy', () => {
    const workbench = new WorkflowWorkbench(makeContainer(), () => config());
    const first = workbench.addCurrentTask();
    workbench.moveTaskNode(first.id, 400, 300);
    const copy = workbench.duplicateTask(first.id);
    expect(copy).not.toBeNull();
    expect(copy.graph).toBeDefined();
    expect(graphNodesOverlap(copy.graph, { x: 400, y: 300 })).toBe(false);
    expect(workbench.selectedTaskId).toBe(copy.id);
  });

  it('does not auto-expand when there is no valid job to add', () => {
    const workbench = new WorkflowWorkbench(makeContainer(), () => null);
    workbench.setView('graph');
    expect(workbench.graphFocus).toBe(false);
    expect(workbench.project.tasks.length).toBe(0);
  });

  it('zooms within bounds', () => {
    const workbench = new WorkflowWorkbench(makeContainer(), () => config());
    for (let index = 0; index < 20; index += 1) workbench.zoomGraph('in');
    expect(workbench.graphZoom).toBe(1.5);
    for (let index = 0; index < 30; index += 1) workbench.zoomGraph('out');
    expect(workbench.graphZoom).toBe(0.5);
    expect(workbench.zoomGraph('reset')).toBe(1);
  });
});
