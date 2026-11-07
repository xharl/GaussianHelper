/**
 * @fileoverview Pure graph helpers for the Workbench node view.
 *
 * The workflow is already a DAG in `workflowModel.js`; this module only answers
 * geometric and connective questions so the canvas can be rendered and tested
 * without a DOM:
 *
 *   - where each task sits (stored position, else a topological level layout);
 *   - whether a proposed output → input connection is legal;
 *   - the SVG path for a dependency edge;
 *   - how large the canvas must be.
 *
 * Conditional TRUE/FALSE branches are deliberately NOT modelled here. The
 * project model has no conditional edges: a task is blocked until its
 * dependencies pass. The canvas must not invent control flow the gates cannot
 * evaluate.
 *
 * @module utils/workflowGraph
 */

export const GRAPH_NODE_WIDTH = 236;
export const GRAPH_NODE_HEIGHT = 108;
export const GRAPH_COLUMN_GAP = 104;
export const GRAPH_ROW_GAP = 40;
export const GRAPH_PADDING = 48;
export const GRAPH_MIN_WIDTH = 720;
export const GRAPH_MIN_HEIGHT = 420;
export const GRAPH_POSITION_LIMIT = 50000;

/**
 * @typedef {Object} GraphPosition
 * @property {number} x
 * @property {number} y
 */

/** @param {unknown} value @returns {boolean} */
export function isGraphPosition(value) {
  return Boolean(value)
    && typeof value === 'object'
    && Number.isFinite(value.x)
    && Number.isFinite(value.y)
    && Math.abs(value.x) <= GRAPH_POSITION_LIMIT
    && Math.abs(value.y) <= GRAPH_POSITION_LIMIT;
}

/**
 * Clamp a position into the addressable canvas range.
 *
 * @param {{x: number, y: number}} position
 * @returns {GraphPosition}
 */
export function clampGraphPosition(position) {
  const x = Number(position?.x);
  const y = Number(position?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { x: GRAPH_PADDING, y: GRAPH_PADDING };
  return {
    x: Math.min(GRAPH_POSITION_LIMIT, Math.max(0, x)),
    y: Math.min(GRAPH_POSITION_LIMIT, Math.max(0, y)),
  };
}

/**
 * Longest-path level for each task in a DAG. A task with no dependencies sits
 * at level 0; a task depends on the deepest of its prerequisites. Cycles are
 * rejected by `validateWorkflowProject`, but this function must stay finite on
 * malformed input, so a cycle-closing edge is treated as level 0.
 *
 * @param {Array<{id: string, dependencies?: string[]}>} tasks
 * @returns {Map<string, number>}
 */
function computeLevels(tasks) {
  const byId = new Map(tasks.map(task => [task.id, task]));
  const memo = new Map();
  const visiting = new Set();

  const levelOf = (task) => {
    if (memo.has(task.id)) return memo.get(task.id);
    if (visiting.has(task.id)) return 0;
    visiting.add(task.id);
    let level = 0;
    for (const dependencyId of task.dependencies || []) {
      const dependency = byId.get(dependencyId);
      if (dependency) level = Math.max(level, levelOf(dependency) + 1);
    }
    visiting.delete(task.id);
    memo.set(task.id, level);
    return level;
  };

  for (const task of tasks) levelOf(task);
  return memo;
}

/**
 * Layout every task on a topological grid. Tasks at the same depth share a
 * column and are stacked in creation order, so the result is stable across
 * renders.
 *
 * @param {Array<{id: string, dependencies?: string[]}>} tasks
 * @returns {Object<string, GraphPosition>}
 */
export function computeGraphLayout(tasks) {
  const levels = computeLevels(tasks);
  const perLevel = new Map();
  for (const task of tasks) {
    const level = levels.get(task.id) || 0;
    if (!perLevel.has(level)) perLevel.set(level, []);
    perLevel.get(level).push(task.id);
  }

  const positions = {};
  const sortedLevels = [...perLevel.keys()].sort((a, b) => a - b);
  for (const level of sortedLevels) {
    const ids = perLevel.get(level);
    ids.forEach((id, index) => {
      positions[id] = {
        x: GRAPH_PADDING + level * (GRAPH_NODE_WIDTH + GRAPH_COLUMN_GAP),
        y: GRAPH_PADDING + index * (GRAPH_NODE_HEIGHT + GRAPH_ROW_GAP),
      };
    });
  }
  return positions;
}

/**
 * Merge stored positions with the automatic layout. A stored position wins;
 * tasks without one fall back to their grid slot. This lets a user drag two
 * nodes and leave the rest tidy.
 *
 * @param {Array<{id: string, graph?: GraphPosition, dependencies?: string[]}>} tasks
 * @returns {Object<string, GraphPosition>}
 */
export function resolveGraphPositions(tasks) {
  const layout = computeGraphLayout(tasks);
  const positions = {};
  for (const task of tasks) {
    positions[task.id] = isGraphPosition(task.graph)
      ? clampGraphPosition(task.graph)
      : layout[task.id] || { x: GRAPH_PADDING, y: GRAPH_PADDING };
  }
  return positions;
}

/**
 * Canvas size that contains every node plus padding.
 *
 * @param {Object<string, GraphPosition>} positions
 * @returns {{width: number, height: number}}
 */
export function graphBounds(positions) {
  const values = Object.values(positions || {});
  const maxX = values.reduce((max, position) => Math.max(max, position.x + GRAPH_NODE_WIDTH), 0);
  const maxY = values.reduce((max, position) => Math.max(max, position.y + GRAPH_NODE_HEIGHT), 0);
  return {
    width: Math.max(GRAPH_MIN_WIDTH, Math.ceil(maxX + GRAPH_PADDING)),
    height: Math.max(GRAPH_MIN_HEIGHT, Math.ceil(maxY + GRAPH_PADDING)),
  };
}

/**
 * Cubic Bézier from the output port (right edge) of one node to the input port
 * (left edge) of another. Backward edges (target left of source) bow outward so
 * they stay visible instead of crossing the nodes.
 *
 * @param {GraphPosition} from
 * @param {GraphPosition} to
 * @returns {string} SVG path data
 */
export function graphEdgePath(from, to) {
  const start = {
    x: from.x + GRAPH_NODE_WIDTH,
    y: from.y + GRAPH_NODE_HEIGHT / 2,
  };
  const end = {
    x: to.x,
    y: to.y + GRAPH_NODE_HEIGHT / 2,
  };
  const forward = end.x >= start.x;
  const reach = Math.max(56, Math.abs(end.x - start.x) * (forward ? 0.5 : 0.35));
  const controlA = { x: start.x + reach, y: start.y };
  const controlB = { x: end.x - reach, y: end.y };
  return `M ${start.x} ${start.y} C ${controlA.x} ${controlA.y}, ${controlB.x} ${controlB.y}, ${end.x} ${end.y}`;
}

/**
 * Why a proposed dependency (`fromId` output → `toId` input) cannot be added,
 * or `null` when it is legal. Mirrors the model's cycle rule but produces a
 * user-facing message before mutating the project.
 *
 * @param {Array<{id: string, dependencies?: string[]}>} tasks
 * @param {string} fromId - upstream task
 * @param {string} toId - downstream task
 * @returns {string|null}
 */
export function connectionIssue(tasks, fromId, toId) {
  if (!fromId || !toId) return 'Choose both ends of the connection.';
  if (fromId === toId) return 'A task cannot depend on itself.';
  if (!tasks.some(task => task.id === fromId)) return 'The upstream task no longer exists.';
  const target = tasks.find(task => task.id === toId);
  if (!target) return 'The downstream task no longer exists.';
  if ((target.dependencies || []).includes(fromId)) return 'That dependency already exists.';

  // Adding toId ← fromId creates a cycle when fromId already depends on toId,
  // directly or transitively.
  const byId = new Map(tasks.map(task => [task.id, task]));
  const stack = [fromId];
  const seen = new Set();
  while (stack.length > 0) {
    const current = stack.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    const task = byId.get(current);
    for (const dependencyId of task?.dependencies || []) {
      if (dependencyId === toId) return 'That connection would create a cycle.';
      stack.push(dependencyId);
    }
  }
  return null;
}

/**
 * Human-readable gate summary for a node footer. Only states what the task
 * actually requires; unknown future gates are omitted rather than guessed.
 *
 * @param {{route?: {jobType?: string}, gates?: Object}} task
 * @returns {string}
 */
export function gateSummary(task) {
  const gates = task?.gates || {};
  const parts = [];
  const jobType = String(task?.route?.jobType || '').trim();
  if (jobType) parts.push(jobType);
  if (gates.requireThermochemistry) parts.push('thermo');
  if (gates.requireFinalEnergy) parts.push('final E');
  if (Number.isInteger(gates.expectedImaginaryModes)) {
    parts.push(`${gates.expectedImaginaryModes} imag`);
  }
  if (Number.isFinite(gates.minImaginaryMagnitude)) {
    parts.push(`≥${gates.minImaginaryMagnitude} cm⁻¹`);
  }
  return parts.join(' · ');
}
