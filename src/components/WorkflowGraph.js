/**
 * @fileoverview Renderers for the Workbench node view.
 *
 * This module produces HTML strings only; `WorkflowWorkbench` owns project
 * mutations, selection state, and event wiring. Keeping the markup here makes
 * the graph view testable without a DOM and keeps the Workbench class from
 * growing another thousand lines.
 *
 * @module components/WorkflowGraph
 */

import { escapeHtml } from './GaussianOutputInspector.js';
import { STATUS_LABELS } from '../utils/workflowLabels.js';
import {
  GRAPH_NODE_HEIGHT,
  GRAPH_NODE_WIDTH,
  gateSummary,
  graphBounds,
  graphEdgePath,
  resolveGraphPositions,
} from '../utils/workflowGraph.js';

/** Block-library presets. Each one snapshots the current job and sets a route. */
export const GRAPH_BLOCKS = [
  {
    kind: 'opt',
    label: 'Optimization',
    hint: 'Minimum or saddle point',
    jobType: 'Opt',
  },
  {
    kind: 'freq',
    label: 'Frequency analysis',
    hint: 'Modes, thermochemistry',
    jobType: 'Freq',
  },
  {
    kind: 'irc',
    label: 'IRC path',
    hint: 'Follow the reaction path',
    jobType: 'IRC',
  },
  {
    kind: 'sp',
    label: 'Single point',
    hint: 'Refine the electronic energy',
    jobType: 'SP',
  },
  {
    kind: 'pop',
    label: 'Population analysis',
    hint: 'Charges and bond orders',
    jobType: 'SP',
    pop: 'MK',
  },
];

/**
 * Short route text for a node. Uses the same method/basis shape the generator
 * emits, including GenECP, without repeating the full keyword list.
 *
 * @param {Object} task
 * @returns {string}
 */
export function routeSummary(task) {
  const route = task?.config?.route || {};
  const method = String(route.method || '').trim();
  const basis = route.basisMode === 'GenECP' ? 'GenECP' : String(route.basisSet || '').trim();
  const jobType = String(route.jobType || '').trim();
  const head = method ? `${method}${basis ? `/${basis}` : ''}` : '';
  return [head, jobType].filter(Boolean).join(' ') || 'No route yet';
}

/** @param {Object} task @returns {string} */
function nodeKind(task) {
  const jobType = String(task?.config?.route?.jobType || '').trim().toUpperCase();
  if (jobType.startsWith('IRC')) return 'IRC';
  if (jobType.startsWith('FREQ')) return 'FREQ';
  if (jobType.startsWith('OPT')) return 'OPT';
  if (jobType.startsWith('SP')) return jobType.includes('POP') ? 'POP' : 'SP';
  return 'CALC';
}

/** @param {Object} task @param {Object} states @param {Object} position @param {boolean} selected */
function renderNode(task, states, position, selected) {
  const state = states[task.id] || 'blocked';
  const summary = gateSummary(task);
  return `
    <article class="wf-node${selected ? ' is-selected' : ''}" data-graph-task="${escapeHtml(task.id)}"
      title="${escapeHtml(task.inputName || '')}" tabindex="0"
      style="left:${position.x}px;top:${position.y}px;width:${GRAPH_NODE_WIDTH}px;height:${GRAPH_NODE_HEIGHT}px">
      <header class="wf-node-header" data-graph-drag="${escapeHtml(task.id)}" title="Drag to move · click to inspect">
        <span class="wf-node-kind">${escapeHtml(nodeKind(task))}</span>
        <strong class="wf-node-title" title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</strong>
        <span class="workflow-status-badge status-${escapeHtml(state)}">${escapeHtml(STATUS_LABELS[state] || state)}</span>
      </header>
      <code class="wf-node-route">${escapeHtml(routeSummary(task))}</code>
      <div class="wf-node-meta">
        <span class="wf-node-gates">${escapeHtml(summary || task.inputName || '')}</span>
      </div>
      <span class="wf-port wf-port-in" aria-hidden="true"></span>
      <span class="wf-port wf-port-out" data-graph-port-out="${escapeHtml(task.id)}"
        title="Drag to another task to add a dependency"></span>
    </article>
  `;
}

/** @param {Object} task @param {Object} states @param {Object} project */
function taskDependencyList(task, states, project) {
  if (!task.dependencies.length) return '<p class="wf-inspector-empty">No prerequisites — starts from its own geometry.</p>';
  return `<ul class="wf-inspector-deps">${task.dependencies.map(id => {
    const dependency = project.tasks.find(candidate => candidate.id === id);
    return `<li title="${escapeHtml(id)}"><code>${escapeHtml(dependency?.title || id)}</code><span class="workflow-status-badge status-${escapeHtml(states[id] || 'blocked')}">${escapeHtml(STATUS_LABELS[states[id]] || 'Missing')}</span></li>`;
  }).join('')}</ul>`;
}

/** @param {Object} task */
function gateList(task) {
  const gates = task.gates || {};
  const rows = [];
  rows.push(['Normal termination', 'required']);
  rows.push(['Route echo matches', 'required']);
  if (gates.requireScfRecord) rows.push(['SCF convergence', 'required']);
  if (gates.requireOptimizationComplete) rows.push(['Optimization', 'route-implied']);
  if (gates.requireFrequencyRecord) rows.push(['Frequency record', 'route-implied']);
  if (gates.requireThermochemistry) rows.push(['Thermochemistry', 'route-implied']);
  if (gates.requireFinalEnergy) rows.push(['Method final energy', 'method-implied']);
  if (Number.isInteger(gates.expectedImaginaryModes)) {
    rows.push([`Imaginary modes = ${gates.expectedImaginaryModes}`, 'explicit count']);
  }
  if (Number.isFinite(gates.minImaginaryMagnitude)) {
    rows.push([`Saddle threshold ≥ ${gates.minImaginaryMagnitude} cm⁻¹`, 'magnitude floor']);
  }
  return `<ul class="wf-inspector-gates">${rows.map(([label, kind]) => `
    <li><span>${escapeHtml(label)}</span><em>${escapeHtml(kind)}</em></li>
  `).join('')}</ul>`;
}

/** @param {Object} task @param {Object} states @param {Object} project */
function renderTaskInspector(task, states, project) {
  const state = states[task.id] || 'blocked';
  const checkpoint = task.checkpointFromTaskId
    ? `<span>Checkpoint from</span><code>${escapeHtml(task.checkpointFromTaskId)}</code>`
    : '';
  return `
    <div class="wf-inspector-head">
      <div>
        <div class="wf-inspector-eyebrow">Selected task</div>
        <h3>${escapeHtml(task.title)}</h3>
      </div>
      <button type="button" class="btn btn-ghost btn-icon" data-graph-action="clear-selection" title="Clear selection">✕</button>
    </div>
    <div class="wf-inspector-status">
      <span class="workflow-status-badge status-${escapeHtml(state)}">${escapeHtml(STATUS_LABELS[state] || state)}</span>
      <span class="wf-inspector-route">${escapeHtml(gateSummary(task) || 'No extra gates')}</span>
    </div>
    <code class="wf-inspector-code">${escapeHtml(routeSummary(task))}</code>
    <dl class="wf-inspector-meta">
      <div><dt>Input</dt><dd><code>${escapeHtml(task.inputName)}</code></dd></div>
      <div><dt>Output</dt><dd><code>${escapeHtml(task.outputName)}</code></dd></div>
      ${checkpoint ? `<div><dt>Checkpoint</dt><dd><code>${escapeHtml(task.config.link0?.checkpoint || '—')}</code> · source <code>${escapeHtml(task.checkpointFromTaskId)}</code></dd></div>` : ''}
    </dl>
    <section class="wf-inspector-section">
      <h4>Prerequisites</h4>
      ${taskDependencyList(task, states, project)}
    </section>
    <section class="wf-inspector-section">
      <h4>Gates</h4>
      ${gateList(task)}
    </section>
    <div class="wf-inspector-actions">
      <button type="button" class="btn btn-secondary btn-sm" data-graph-action="edit-list" data-task-id="${escapeHtml(task.id)}">Edit in list view</button>
      <button type="button" class="btn btn-primary btn-sm" data-graph-action="export" data-task-id="${escapeHtml(task.id)}"
        ${state === 'ready' ? '' : 'disabled'} title="${state === 'ready' ? 'Download this ready input' : 'Only a ready task can be exported'}">Download ready input</button>
      <button type="button" class="btn btn-ghost btn-sm wf-danger" data-graph-action="delete" data-task-id="${escapeHtml(task.id)}">Delete task</button>
    </div>
    <p class="wf-inspector-note">Gaussian runs externally. Import its log to evaluate these gates; the canvas neither submits nor monitors jobs.</p>
  `;
}

/** @param {Object} project @param {Object} states @param {{from: string, to: string}} edge */
function renderEdgeInspector(project, states, edge) {
  const from = project.tasks.find(task => task.id === edge.from);
  const to = project.tasks.find(task => task.id === edge.to);
  if (!from || !to) return '<p class="wf-inspector-empty">That dependency no longer exists.</p>';
  const checkpoint = to.checkpointFromTaskId === from.id;
  return `
    <div class="wf-inspector-head">
      <div>
        <div class="wf-inspector-eyebrow">Selected dependency</div>
        <h3>${escapeHtml(from.title)} → ${escapeHtml(to.title)}</h3>
      </div>
      <button type="button" class="btn btn-ghost btn-icon" data-graph-action="clear-selection" title="Clear selection">✕</button>
    </div>
    <div class="wf-inspector-status">
      <span class="workflow-status-badge status-${escapeHtml(states[to.id] || 'blocked')}">${escapeHtml(STATUS_LABELS[states[to.id]] || 'Blocked')}</span>
      <span class="wf-inspector-route">${checkpoint ? 'Checkpoint hand-off' : 'Dependency only'}</span>
    </div>
    <p class="wf-inspector-copy">${escapeHtml(to.title)} stays blocked until <strong>${escapeHtml(from.title)}</strong> passes its gates.
      ${checkpoint ? `Its input reads <code>%OldChk=${escapeHtml(from.config.link0?.checkpoint || '')}</code> from the upstream task.` : 'No checkpoint is handed over; the dependency only orders validation.'}</p>
    <div class="wf-inspector-actions">
      ${checkpoint ? `<button type="button" class="btn btn-secondary btn-sm" data-graph-action="clear-checkpoint" data-edge-from="${escapeHtml(from.id)}" data-edge-to="${escapeHtml(to.id)}">Clear checkpoint hand-off</button>` : ''}
      <button type="button" class="btn btn-ghost btn-sm wf-danger" data-graph-action="remove-edge" data-edge-from="${escapeHtml(from.id)}" data-edge-to="${escapeHtml(to.id)}">Remove dependency</button>
    </div>
    <p class="wf-inspector-note">Removing a dependency invalidates this task and everything downstream, exactly like editing it in the list view.</p>
  `;
}

/** @param {Object} project @param {Object} states @param {Object} options */
function renderInspector(project, states, options) {
  if (options.selectedEdge) return renderEdgeInspector(project, states, options.selectedEdge);
  const task = project.tasks.find(item => item.id === options.selectedTaskId);
  if (task) return renderTaskInspector(task, states, project);
  return `
    <div class="wf-inspector-head">
      <div>
        <div class="wf-inspector-eyebrow">Inspector</div>
        <h3>Nothing selected</h3>
      </div>
    </div>
    <p class="wf-inspector-copy">Click a task to see its route, prerequisites, and gates. Drag a task's right-hand port onto another task to add a dependency; click a line to inspect or remove it.</p>
    <ul class="wf-inspector-help">
      <li><strong>Drag</strong> a node header to arrange the canvas. Positions are saved in the project.</li>
      <li><strong>Connect</strong> output → input. Cycles and duplicates are rejected.</li>
      <li><strong>Validate</strong> checks the whole project without leaving the canvas.</li>
      <li>Conditional TRUE/FALSE branches are not modelled: a task is blocked until its gates pass.</li>
    </ul>
  `;
}

/**
 * Full graph view: block library, canvas, inspector.
 *
 * @param {Object} options
 * @param {Object} options.project
 * @param {Object} options.states
 * @param {number} options.zoom
 * @param {string|null} options.selectedTaskId
 * @param {{from: string, to: string}|null} options.selectedEdge
 * @returns {string}
 */
export function renderGraphView({ project, states, zoom, selectedTaskId, selectedEdge, focus = false }) {
  const tasks = project.tasks;
  const positions = resolveGraphPositions(tasks);
  const bounds = graphBounds(positions);

  const edges = tasks.flatMap(task => (task.dependencies || []).map(dependencyId => {
    const from = positions[dependencyId];
    const to = positions[task.id];
    if (!from || !to) return '';
    const checkpoint = task.checkpointFromTaskId === dependencyId;
    const selected = Boolean(selectedEdge && selectedEdge.from === dependencyId && selectedEdge.to === task.id);
    return `<path class="wf-edge${checkpoint ? ' is-checkpoint' : ''}${selected ? ' is-selected' : ''}"
      data-graph-edge-from="${escapeHtml(dependencyId)}" data-graph-edge-to="${escapeHtml(task.id)}"
      d="${graphEdgePath(from, to)}" marker-end="url(#wf-arrow${checkpoint ? '-checkpoint' : ''})" />`;
  })).join('');

  const nodes = tasks.map(task => renderNode(
    task,
    states,
    positions[task.id] || { x: 0, y: 0 },
    task.id === selectedTaskId,
  )).join('');

  const emptyHint = tasks.length === 0
    ? '<div class="wf-graph-empty"><strong>No calculation steps yet.</strong><p>Pick a block on the left to snapshot the current job as the first node.</p></div>'
    : '';

  return `
    <div class="wf-graph-layout">
      <aside class="wf-graph-library" aria-label="Computational block library">
        <div class="wf-graph-pane-title">Computational blocks</div>
        <p class="wf-graph-pane-hint">Click to add a step. Snapshots the current job and sets its route.</p>
        ${GRAPH_BLOCKS.map(block => `
          <button type="button" class="wf-block" data-graph-add="${escapeHtml(block.kind)}">
            <span class="wf-block-plus">+</span>
            <span class="wf-block-text"><strong>${escapeHtml(block.label)}</strong><em>${escapeHtml(block.hint)}</em></span>
          </button>
        `).join('')}
        <p class="wf-graph-pane-note">Conditions are not a block. Gates on each task decide when it becomes ready; the canvas does not invent control flow.</p>
      </aside>

      <section class="wf-graph-main" aria-label="Workflow graph">
        <div class="wf-graph-toolbar">
          <div class="wf-graph-toolbar-group">
            <span class="wf-graph-count">${tasks.length} task${tasks.length === 1 ? '' : 's'} · ${tasks.reduce((sum, task) => sum + (task.dependencies?.length || 0), 0)} dependencies</span>
          </div>
          <div class="wf-graph-toolbar-group">
            <button type="button" class="btn btn-secondary btn-sm" data-graph-action="toggle-focus"
              title="Hide the molecule and parameter panels to widen the canvas">${focus ? 'Collapse' : 'Expand'}</button>
            <button type="button" class="btn btn-secondary btn-sm" data-graph-action="validate">Validate graph</button>
            <span class="wf-zoom" role="group" aria-label="Zoom">
              <button type="button" class="btn btn-ghost btn-sm" data-graph-zoom="out" title="Zoom out">−</button>
              <span class="wf-zoom-value">${Math.round(zoom * 100)}%</span>
              <button type="button" class="btn btn-ghost btn-sm" data-graph-zoom="in" title="Zoom in">+</button>
              <button type="button" class="btn btn-ghost btn-sm" data-graph-zoom="reset" title="Reset zoom">Reset</button>
            </span>
          </div>
        </div>
        <div class="wf-graph-viewport" data-graph-viewport>
          <div class="wf-graph-spacer" style="width:${Math.round(bounds.width * zoom)}px;height:${Math.round(bounds.height * zoom)}px">
            <div class="wf-graph-stage" data-graph-stage
              style="width:${bounds.width}px;height:${bounds.height}px;transform:scale(${zoom});transform-origin:0 0">
              <svg class="wf-graph-edges" width="${bounds.width}" height="${bounds.height}" aria-hidden="true">
                <defs>
                  <marker id="wf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" class="wf-arrow-head"></path>
                  </marker>
                  <marker id="wf-arrow-checkpoint" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" class="wf-arrow-head is-checkpoint"></path>
                  </marker>
                </defs>
                ${edges}
              </svg>
              ${nodes}
              ${emptyHint}
            </div>
          </div>
        </div>
        <div class="wf-graph-hint">Drag a header to move · drag the right port to connect · click a line to inspect · scroll to pan</div>
      </section>

      <aside class="wf-graph-inspector" aria-label="Inspector">
        ${renderInspector(project, states, { selectedTaskId, selectedEdge })}
      </aside>
    </div>
  `;
}

/**
 * Recompute every edge path after a node drag without re-rendering the view.
 *
 * @param {ParentNode} container
 * @param {Object<string, {x: number, y: number}>} positions
 */
export function updateEdgeGeometry(container, positions) {
  container.querySelectorAll?.('path[data-graph-edge-from]').forEach(path => {
    const from = positions[path.dataset.graphEdgeFrom];
    const to = positions[path.dataset.graphEdgeTo];
    if (from && to) path.setAttribute('d', graphEdgePath(from, to));
  });
}
