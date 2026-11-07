import { parseGaussianLogStream, parseGaussianLogText } from '../parsers/gaussianLogParser.js';
import { buildLink1Input } from '../generators/gjfGenerator.js';
import { evaluateWorkflowOutput } from '../utils/workflowGates.js';
import { buildWorkflowBundle } from '../utils/bundleExport.js';
import { buildTaskInputText, buildTaskProvenanceRecord } from '../utils/workflowInput.js';
import { PROVENANCE_SUFFIX, createCompactProvenance, stringifyProvenanceRecord } from '../utils/provenance.js';
import { STATUS_LABELS } from '../utils/workflowLabels.js';
import { clampGraphPosition, connectionIssue, resolveGraphPositions, findFreeGraphPosition, graphBounds, GRAPH_NODE_HEIGHT, GRAPH_NODE_WIDTH } from '../utils/workflowGraph.js';
import { GRAPH_BLOCKS, renderGraphView, updateEdgeGeometry } from './WorkflowGraph.js';
import { escapeHtml } from './GaussianOutputInspector.js';
import {
  createWorkflowProject,
  createWorkflowTask,
  createWorkflowId,
  MAX_WORKFLOW_PROJECT_BYTES,
  MAX_WORKFLOW_TASKS,
  deriveTaskStates,
  invalidateTaskAndDescendants,
  parseWorkflowProjectJson,
  routeReadsCheckpoint,
  serializeWorkflowProject,
  topologicallySortTasks,
  validateWorkflowProject,
} from '../utils/workflowModel.js';

const CONTINUATION_ROUTES = {
  checkpoint: 'Geom=Checkpoint Guess=Read',
  allcheck: 'Geom=AllCheck',
};

export class WorkflowWorkbench {
  constructor(container, getActiveConfig, getActiveEnsemble = null) {
    this.container = container;
    this.getActiveConfig = getActiveConfig;
    this.getActiveEnsemble = getActiveEnsemble;
    this.project = createWorkflowProject();
    this.pendingOutputs = [];
    this.processingOutputs = false;
    this.statusMessage = 'Add a calculation to start a project. Outputs are checked locally in this browser.';
    this.view = 'list';
    this.graphZoom = 1;
    this.graphFocus = false;
    this._graphFocusChosen = false;
    this.selectedTaskId = null;
    this.selectedEdge = null;
    this.render();
  }

  render() {
    this.applyGraphFocus();
    const states = deriveTaskStates(this.project);
    const counts = Object.values(states).reduce((result, state) => {
      result[state] = (result[state] || 0) + 1;
      return result;
    }, {});
    const taskOptions = topologicallySortTasks(this.project.tasks)
      .map(task => `<option value="${escapeHtml(task.id)}">${escapeHtml(task.title)}</option>`).join('');

    this.container.innerHTML = `
      <div class="workflow-workbench">
        <section class="card">
          <div class="card-header">
            <div class="workflow-project-heading">
              <label for="workflow-project-name" class="card-title">Project</label>
              <input id="workflow-project-name" class="form-input workflow-project-name" maxlength="200" value="${escapeHtml(this.project.name)}" />
            </div>
            <div class="workflow-actions">
              <div class="workflow-view-toggle" role="group" aria-label="Workbench view">
                <button type="button" id="workflow-view-list" class="workflow-view-btn ${this.view === 'list' ? 'is-active' : ''}"
                  aria-pressed="${this.view === 'list'}">List</button>
                <button type="button" id="workflow-view-graph" class="workflow-view-btn ${this.view === 'graph' ? 'is-active' : ''}"
                  aria-pressed="${this.view === 'graph'}">Graph</button>
              </div>
              <button type="button" id="workflow-export-bundle" class="btn btn-secondary btn-sm"
                title="Download every task input, manifest.json, and scheduler templates as a .zip"
                ${this.project.tasks.length ? '' : 'disabled'}>Export bundle (.zip)</button>
              <button type="button" id="workflow-save-project" class="btn btn-secondary btn-sm">Save project</button>
              <label class="btn btn-secondary btn-sm workflow-load-label">Open project
                <input id="workflow-project-input" type="file" accept=".ghproject.json,application/json" hidden />
              </label>
              <button type="button" id="workflow-add-task" class="btn btn-primary btn-sm">Add current job</button>
            </div>
          </div>
          <div class="card-body">
            <div class="workflow-status" role="status" aria-live="polite">${escapeHtml(this.statusMessage)}</div>
            ${this.project.tasks.length ? `<p class="workflow-bundle-note">Bundle export includes the input for every task, not only ready steps. The exported scheduler scripts do not validate results; import each Gaussian log here to evaluate the gates.</p>` : ''}
            <label class="file-drop-zone workflow-output-dropzone">
              <span class="file-drop-zone-text">Import Gaussian output logs to validate steps</span>
              <span class="file-drop-zone-hint">Select .log / .out files; parsing stays in this browser</span>
              <input id="workflow-output-input" type="file" accept=".log,.out" multiple hidden ${this.processingOutputs ? 'disabled' : ''} />
            </label>
            ${this.renderPendingOutputs()}
            ${this.view === 'list' && this.project.tasks.length ? `
              <div class="workflow-add-options">
                <label class="workflow-field"><span>This job</span>
                  <select id="workflow-new-intent" class="form-input">
                    <option value="standalone">Starts from the structure in the editor</option>
                    <option value="checkpoint">Continues from an earlier step (Geom=Checkpoint Guess=Read)</option>
                    <option value="allcheck">Continues from an earlier step (Geom=AllCheck)</option>
                  </select>
                </label>
                <label class="workflow-field"><span>Depends on</span>
                  <select id="workflow-new-dependencies" class="form-input" multiple size="3">${taskOptions}</select>
                </label>
                <label class="workflow-field"><span>Read checkpoint from</span>
                  <select id="workflow-new-checkpoint" class="form-input">
                    <option value="">No checkpoint input</option>
                    ${this.project.tasks.filter(task => task.config.link0?.checkpoint)
                      .map(task => `<option value="${escapeHtml(task.id)}">${escapeHtml(task.title)} — ${escapeHtml(task.config.link0.checkpoint)}</option>`).join('')}
                  </select>
                </label>
              </div>
            ` : ''}
            ${this.view === 'list' && this.getActiveEnsemble ? `
              <div class="workflow-conformer-queue">
                <label class="workflow-field"><span>Queue retained conformers (1–10)</span>
                  <input id="workflow-conformer-count" class="form-input" type="number" min="1" max="10" step="1" value="3" />
                </label>
                <button type="button" id="workflow-queue-conformers" class="btn btn-secondary btn-sm">Queue top-k conformers</button>
                <p class="workflow-bundle-note">Creates one task per retained conformer, all sharing the dependencies selected above. Each task records its conformer energy, population, and ensemble spread; the coordinates of that conformer are written to its input.</p>
              </div>
            ` : ''}
          </div>
        </section>

        ${this.view === 'graph' ? this.renderGraphSection(states) : (this.project.tasks.length ? `
          <div class="workflow-progress" aria-label="Project progress">
            ${[['passed', 'Passed'], ['ready', 'Ready'], ['blocked', 'Blocked'], ['awaiting-output', 'Awaiting output'], ['failed', 'Failed'], ['incomplete', 'Incomplete'], ['needs-review', 'Needs review']]
              .map(([key, label]) => `<div class="workflow-progress-item"><strong>${counts[key] || 0}</strong><span>${label}</span></div>`).join('')}
          </div>
          <section class="workflow-task-list" aria-label="Calculation tasks">
            ${topologicallySortTasks(this.project.tasks).map(task => this.renderTask(task, states)).join('')}
          </section>
        ` : '<section class="card workflow-empty"><div class="card-body"><strong>No calculation steps yet.</strong><p>Add the active job to create the first step.</p></div></section>')}
      </div>
    `;
    this.bindEvents();
  }

  applyGraphFocus() {
    if (typeof document === 'undefined') return;
    const app = this.container.closest?.('#app') || document.getElementById?.('app');
    app?.classList.toggle('workflow-graph-focus', this.view === 'graph' && this.graphFocus);
  }

  renderGraphSection(states) {
    return renderGraphView({
      project: this.project,
      states,
      zoom: this.graphZoom,
      selectedTaskId: this.selectedTaskId,
      selectedEdge: this.selectedEdge,
      focus: this.graphFocus,
      statusMessage: this.statusMessage,
    });
  }

  bindEvents() {
    this.container.querySelector('#workflow-project-name')?.addEventListener('change', event => {
      const name = event.target.value.trim();
      if (!name) {
        this.statusMessage = 'Project name cannot be empty.';
        this.render();
        return;
      }
      this.project.name = name.slice(0, 200);
      this.project.updatedAt = new Date().toISOString();
      this.statusMessage = 'Project name updated.';
      this.render();
    });

    this.container.querySelector('#workflow-output-input')?.addEventListener('change', event => {
      const files = Array.from(event.target.files || []);
      event.target.value = '';
      void this.importOutputFiles(files);
    });
    this.container.querySelector('#workflow-save-project')?.addEventListener('click', () => this.downloadProject());
    this.container.querySelector('#workflow-export-bundle')?.addEventListener('click', () => this.downloadBundle());
    this.container.querySelector('#workflow-project-input')?.addEventListener('change', event => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file) void this.loadProjectFile(file);
    });

    this.container.querySelector('#workflow-add-task')?.addEventListener('click', () => {
      const dependencySelect = this.container.querySelector('#workflow-new-dependencies');
      const checkpointSelect = this.container.querySelector('#workflow-new-checkpoint');
      const intentSelect = this.container.querySelector('#workflow-new-intent');
      const dependencies = Array.from(dependencySelect?.selectedOptions || []).map(option => option.value);
      this.addCurrentTask({
        dependencies,
        checkpointFromTaskId: checkpointSelect?.value || null,
        intent: intentSelect?.value || 'standalone',
      });
    });

    this.container.querySelector('#workflow-queue-conformers')?.addEventListener('click', () => {
      const input = this.container.querySelector('#workflow-conformer-count');
      const requested = Number.parseInt(input?.value ?? '3', 10);
      this.queueConformerTasks(Number.isFinite(requested) ? requested : 3);
    });

    this.container.querySelectorAll('[data-workflow-action]').forEach(button => {
      button.addEventListener('click', () => {
        const { workflowAction: action, taskId } = button.dataset;
        if (action === 'export') this.downloadTask(taskId);
        else if (action === 'export-link1') this.downloadTaskLink1(taskId);
        else if (action === 'replace') this.replaceTaskFromCurrent(taskId);
        else if (action === 'duplicate') this.duplicateTask(taskId);
        else if (action === 'remove') this.removeTask(taskId);
        else if (action === 'retry') this.retryTask(taskId);
        else if (action === 'apply-dependencies') this.applyRelationshipEdits(taskId);
      });
    });

    this.container.querySelectorAll('[data-workflow-title]').forEach(input => {
      input.addEventListener('change', () => this.renameTask(input.dataset.workflowTitle, input.value));
    });
    this.container.querySelectorAll('[data-workflow-gate]').forEach(input => {
      input.addEventListener('change', () => this.updateGate(input.dataset.taskId, input.dataset.workflowGate, input.checked));
    });
    this.container.querySelectorAll('[data-workflow-imaginary-modes]').forEach(input => {
      input.addEventListener('change', () => {
        const value = input.value === '' ? null : Number(input.value);
        this.updateGate(input.dataset.taskId, 'expectedImaginaryModes', value);
      });
    });
    this.container.querySelectorAll('[data-workflow-min-imaginary-magnitude]').forEach(input => {
      input.addEventListener('change', () => {
        const value = input.value === '' ? null : Number(input.value);
        this.updateGate(input.dataset.taskId, 'minImaginaryMagnitude', value);
      });
    });
    this.container.querySelector('#workflow-view-list')?.addEventListener('click', () => this.setView('list'));
    this.container.querySelector('#workflow-view-graph')?.addEventListener('click', () => this.setView('graph'));

    this.container.querySelectorAll('[data-graph-add]').forEach(button => {
      button.addEventListener('click', () => this.addBlockTask(button.dataset.graphAdd));
    });
    this.container.querySelectorAll('[data-graph-task]').forEach(node => {
      node.addEventListener('click', event => {
        if (event.target.closest?.('[data-graph-port-out]')) return;
        if (this._suppressNodeClick) {
          this._suppressNodeClick = false;
          return;
        }
        this.selectGraphTask(node.dataset.graphTask);
      });
      node.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        this.selectGraphTask(node.dataset.graphTask);
      });
    });
    this.container.querySelectorAll('[data-graph-drag]').forEach(header => {
      header.addEventListener('pointerdown', event => this.beginNodeDrag(event, header.dataset.graphDrag));
    });
    this.container.querySelectorAll('[data-graph-port-out]').forEach(port => {
      port.addEventListener('pointerdown', event => this.beginConnectionDrag(event, port.dataset.graphPortOut));
    });
    this.container.querySelectorAll('path[data-graph-edge-from]').forEach(path => {
      path.addEventListener('click', () => this.selectGraphEdge(path.dataset.graphEdgeFrom, path.dataset.graphEdgeTo));
    });
    this.container.querySelectorAll('[data-graph-action]').forEach(button => {
      button.addEventListener('click', () => this.handleGraphAction(button));
    });
    this.container.querySelectorAll('[data-graph-zoom]').forEach(button => {
      button.addEventListener('click', () => this.zoomGraph(button.dataset.graphZoom));
    });
    this.container.querySelectorAll('[data-graph-title]').forEach(input => {
      input.addEventListener('change', () => this.renameTask(input.dataset.graphTitle, input.value));
    });
    this.container.querySelectorAll('[data-graph-gate]').forEach(input => {
      input.addEventListener('change', () => this.updateGate(input.dataset.taskId, input.dataset.graphGate, input.checked));
    });
    this.container.querySelectorAll('[data-graph-imaginary]').forEach(input => {
      input.addEventListener('change', () => {
        this.updateGate(input.dataset.taskId, 'expectedImaginaryModes', input.value === '' ? null : Number(input.value));
      });
    });
    this.container.querySelectorAll('[data-graph-magnitude]').forEach(input => {
      input.addEventListener('change', () => {
        this.updateGate(input.dataset.taskId, 'minImaginaryMagnitude', input.value === '' ? null : Number(input.value));
      });
    });
    const viewport = this.container.querySelector('[data-graph-viewport]');
    viewport?.addEventListener('pointerdown', event => this.beginCanvasPan(event, viewport));

    this.container.querySelectorAll('[data-workflow-assign-output]').forEach(button => {
      button.addEventListener('click', () => {
        const id = button.dataset.workflowAssignOutput;
        const taskId = this.container.querySelector(`[data-pending-task="${cssEscape(id)}"]`)?.value;
        const sectionValue = this.container.querySelector(`[data-pending-section="${cssEscape(id)}"]`)?.value;
        if (!/^\d+$/.test(sectionValue || '')) return;
        this.assignPendingOutput(id, taskId, Number(sectionValue));
      });
    });
  }

  renderTask(task, states) {
    const state = states[task.id];
    const taskOptions = this.project.tasks.filter(candidate => candidate.id !== task.id);
    const dependencyOptions = taskOptions.map(candidate => `
      <option value="${escapeHtml(candidate.id)}" ${task.dependencies.includes(candidate.id) ? 'selected' : ''}>
        ${escapeHtml(candidate.title)} · ${escapeHtml(STATUS_LABELS[states[candidate.id]])}
      </option>
    `).join('');
    const checkpointOptions = task.dependencies
      .map(id => this.project.tasks.find(candidate => candidate.id === id))
      .filter(candidate => candidate?.config.link0?.checkpoint)
      .map(candidate => `<option value="${escapeHtml(candidate.id)}" ${task.checkpointFromTaskId === candidate.id ? 'selected' : ''}>${escapeHtml(candidate.title)} — ${escapeHtml(candidate.config.link0.checkpoint)}</option>`)
      .join('');
    const checkpointRequired = requiresCheckpointInput(task.config);
    const routeText = [task.config.route.method, task.config.route.basisSet, task.config.route.jobType, task.config.route.custom]
      .filter(Boolean).join(' ');
    const latestAttempt = task.attempts.find(attempt => attempt.id === task.activeAttemptId);
    const blockedBy = task.dependencies.filter(id => states[id] !== 'passed')
      .map(id => this.project.tasks.find(candidate => candidate.id === id)?.title || id);

    return `
      <article class="card workflow-task" data-task-id="${escapeHtml(task.id)}">
        <div class="card-header workflow-task-header">
          <div class="workflow-task-heading">
            <input class="form-input workflow-task-title" aria-label="Task title" maxlength="200"
              data-workflow-title="${escapeHtml(task.id)}" value="${escapeHtml(task.title)}" />
            <span class="workflow-status-badge status-${escapeHtml(state)}">${escapeHtml(STATUS_LABELS[state])}</span>
          </div>
          <span class="workflow-route">${escapeHtml(routeText)}</span>
        </div>
        <div class="card-body">
          ${state === 'blocked' ? `<div class="workflow-blocked-reason">Waiting for: ${blockedBy.map(escapeHtml).join(', ')}</div>` : ''}
          <div class="workflow-task-files"><span>Input: <code>${escapeHtml(task.inputName)}</code></span><span>Output: <code>${escapeHtml(task.outputName)}</code></span>
            <span>Checkpoint: <code>${escapeHtml(task.config.link0?.checkpoint || 'none')}</code></span></div>
          ${this.renderProvenance(task)}
          <div class="workflow-edit-grid">
            <label class="workflow-field"><span>Depends on</span>
              <select class="form-input" multiple size="3" data-task-dependencies="${escapeHtml(task.id)}">${dependencyOptions}</select>
            </label>
            <label class="workflow-field"><span>Read checkpoint from</span>
              <select class="form-input" data-task-checkpoint="${escapeHtml(task.id)}">
                <option value="">No checkpoint input</option>${checkpointOptions}
              </select>
            </label>
          </div>
          ${checkpointRequired && !task.checkpointFromTaskId ? '<div class="workflow-blocked-reason">This route needs a checkpoint source (Geom=Checkpoint, Geom=AllCheck, Geom=Check, Geom=Step=N, or Guess=Read).</div>' : ''}
          <button type="button" class="btn btn-secondary btn-sm" data-workflow-action="apply-dependencies" data-task-id="${escapeHtml(task.id)}">Apply dependencies</button>
          <fieldset class="workflow-gates">
            <legend>Output gates</legend>
            <label><input type="checkbox" checked disabled /> Normal termination required</label>
            <label><input type="checkbox" data-task-id="${escapeHtml(task.id)}" data-workflow-gate="requireScfRecord" ${task.gates.requireScfRecord ? 'checked' : ''} /> Require SCF record</label>
            <label><input type="checkbox" ${task.gates.requireOptimizationComplete ? 'checked' : ''} ${requiresRouteKeyword(task.config, 'Opt') ? 'disabled' : ''}
              data-task-id="${escapeHtml(task.id)}" data-workflow-gate="requireOptimizationComplete" /> Require optimization completion</label>
            <label><input type="checkbox" ${task.gates.requireFrequencyRecord ? 'checked' : ''} ${requiresRouteKeyword(task.config, 'Freq') ? 'disabled' : ''}
              data-task-id="${escapeHtml(task.id)}" data-workflow-gate="requireFrequencyRecord" /> Require frequency record</label>
            <label><input type="checkbox" ${task.gates.requireThermochemistry ? 'checked' : ''} ${requiresRouteKeyword(task.config, 'Freq') ? 'disabled' : ''}
              data-task-id="${escapeHtml(task.id)}" data-workflow-gate="requireThermochemistry" /> Require thermochemistry (ZPE, H, G)</label>
            <label><input type="checkbox" ${task.gates.requireFinalEnergy ? 'checked' : ''}
              data-task-id="${escapeHtml(task.id)}" data-workflow-gate="requireFinalEnergy" /> Require method final energy (post-HF / composite)</label>
            <label class="workflow-field"><span>Expected imaginary modes (optional)</span>
              <input class="form-input" type="number" min="0" step="1" data-task-id="${escapeHtml(task.id)}" data-workflow-imaginary-modes="${escapeHtml(task.id)}"
                value="${task.gates.expectedImaginaryModes ?? ''}" />
            </label>
            <label class="workflow-field"><span>Saddle threshold (cm⁻¹, blank = off)</span>
              <input class="form-input" type="number" min="0" step="1" data-task-id="${escapeHtml(task.id)}" data-workflow-min-imaginary-magnitude
                value="${task.gates.minImaginaryMagnitude ?? ''}" />
            </label>
          </fieldset>
          ${latestAttempt ? this.renderAttempt(latestAttempt) : ''}
          <div class="workflow-task-actions">
            <button type="button" class="btn btn-primary btn-sm" data-workflow-action="export" data-task-id="${escapeHtml(task.id)}" ${state !== 'ready' ? 'disabled' : ''}>Download ready input</button>
            ${task.checkpointFromTaskId ? `<button type="button" class="btn btn-secondary btn-sm" data-workflow-action="export-link1" data-task-id="${escapeHtml(task.id)}" ${state !== 'ready' ? 'disabled' : ''} title="One input file: upstream step, --Link1--, then this step">Download with upstream (--Link1--)</button>` : ''}
            ${['failed', 'incomplete', 'needs-review'].includes(state) ? `<button type="button" class="btn btn-secondary btn-sm" data-workflow-action="retry" data-task-id="${escapeHtml(task.id)}">Retry step</button>` : ''}
            <button type="button" class="btn btn-secondary btn-sm" data-workflow-action="replace" data-task-id="${escapeHtml(task.id)}">Replace from current job</button>
            <button type="button" class="btn btn-secondary btn-sm" data-workflow-action="duplicate" data-task-id="${escapeHtml(task.id)}">Duplicate</button>
            <button type="button" class="btn btn-ghost btn-sm" data-workflow-action="remove" data-task-id="${escapeHtml(task.id)}">Remove</button>
          </div>
        </div>
      </article>
    `;
  }

  /**
   * One compact provenance line per task. Values come from the bounded record
   * written by the last export; nothing is recomputed here, so the display
   * cannot drift from the sidecar on disk.
   */
  renderProvenance(task) {
    const record = task.provenance;
    if (!record) {
      return `<p class="workflow-provenance workflow-provenance-empty">Provenance: not recorded yet. Download this input to write <code>${escapeHtml(`${task.inputName}${PROVENANCE_SUFFIX}`)}</code>.</p>`;
    }
    const source = record.geometrySource;
    const geometry = source.kind === 'file' || source.kind === 'checkpoint'
      ? `${source.kind}${source.filename ? ` · ${source.filename}` : ''}`
      : source.kind;
    const conformer = record.conformer
      ? `#${record.conformer.index} · ${record.conformer.energyKcal == null ? 'energy unavailable' : `${record.conformer.energyKcal.toFixed(4)} kcal/mol`}`
        + `${record.conformer.population == null ? '' : ` · population ${(record.conformer.population * 100).toFixed(1)}%`}`
        + `${record.conformer.ensembleSpreadKcal == null ? '' : ` · spread ${record.conformer.ensembleSpreadKcal.toFixed(2)} kcal/mol`}`
      : 'none recorded';
    return `<div class="workflow-provenance">
      <span><strong>Provenance</strong> · generated <code>${escapeHtml(record.generatedAt)}</code></span>
      <span>GaussianHelper ${escapeHtml(record.app.version)} @ <code>${escapeHtml(record.app.commit)}</code></span>
      <span>geometry: <code>${escapeHtml(geometry)}</code></span>
      <span>conformer: <code>${escapeHtml(conformer)}</code></span>
      <span>SHA-256: <code>${escapeHtml(record.inputSha256)}</code></span>
    </div>`;
  }

  renderAttempt(attempt) {
    return `
      <details class="workflow-attempt">
        <summary>Latest output check · ${escapeHtml(attempt.overall)}</summary>
        <ul>${(attempt.gates || []).map(gate => `<li><strong>${escapeHtml(gate.name)}:</strong> ${escapeHtml(gate.result)}${gate.line ? ` · line ${gate.line}` : ''}${gate.evidence ? ` — <code>${escapeHtml(gate.evidence)}</code>` : ''}</li>`).join('')}</ul>
      </details>
    `;
  }

  renderPendingOutputs() {
    if (this.pendingOutputs.length === 0) return '';
    const states = deriveTaskStates(this.project);
    const waitingTasks = this.project.tasks.filter(task => states[task.id] === 'awaiting-output');
    return `
      <section class="workflow-pending-outputs" aria-label="Unassigned output files">
        <strong>Assign imported output</strong>
        ${this.pendingOutputs.map(output => `
          <div class="workflow-pending-output">
            <span>${escapeHtml(output.parsed.filename)} · ${output.parsed.sections.length} section(s)</span>
            <label class="workflow-field"><span>Task awaiting output</span>
              <select class="form-input" data-pending-task="${escapeHtml(output.id)}">
                <option value="">Choose task</option>
                ${waitingTasks.map(task => `<option value="${escapeHtml(task.id)}" ${output.suggestedTaskId === task.id ? 'selected' : ''}>${escapeHtml(task.title)}</option>`).join('')}
              </select>
            </label>
            <label class="workflow-field"><span>Calculation section</span>
              <select class="form-input" data-pending-section="${escapeHtml(output.id)}">
                ${output.parsed.sections.length > 1 ? `<option value="" selected disabled>Choose section</option>` : ''}
                ${output.parsed.sections.map((section, index) => `<option value="${index}" ${output.sectionIndex === index ? 'selected' : ''}>Section ${section.index} · ${escapeHtml(STATUS_LABELS[section.status] || 'Unknown')}</option>`).join('')}
              </select>
            </label>
            <button type="button" class="btn btn-secondary btn-sm" data-workflow-assign-output="${escapeHtml(output.id)}" ${waitingTasks.length === 0 ? 'disabled' : ''}>Validate and assign</button>
          </div>
        `).join('')}
      </section>
    `;
  }

  downloadProject() {
    try {
      const json = serializeWorkflowProject(this.project);
      const filename = `${safeBaseName(this.project.name)}.ghproject.json`;
      downloadTextFile(json, filename, 'application/json;charset=utf-8');
      this.statusMessage = `Saved ${filename}. Project data stays on this device unless you move the file.`;
      this.render();
      return true;
    } catch (error) {
      this.statusMessage = error instanceof Error ? error.message : String(error);
      this.render();
      return false;
    }
  }

  async loadProjectFile(file) {
    try {
      if (file.size > MAX_WORKFLOW_PROJECT_BYTES) throw new Error('Workflow project exceeds the 5 MiB size limit.');
      const text = await file.text();
      return this.loadProjectText(text);
    } catch (error) {
      this.statusMessage = error instanceof Error ? error.message : String(error);
      this.render();
      return false;
    }
  }

  loadProjectText(text) {
    let imported;
    try {
      imported = parseWorkflowProjectJson(text);
    } catch (error) {
      this.statusMessage = error instanceof Error ? error.message : String(error);
      this.render();
      return false;
    }
    if (this.project.tasks.length && typeof globalThis.confirm === 'function'
      && !globalThis.confirm('Replace the current workflow with this project file?')) {
      this.statusMessage = 'Project load cancelled; current work was kept.';
      this.render();
      return false;
    }
    this.project = imported;
    this.pendingOutputs = [];
    this.selectedTaskId = null;
    this.selectedEdge = null;
    this.statusMessage = `Loaded project “${imported.name}”. Parsed output summaries are retained; raw log files are not.`;
    this.render();
    return true;
  }

  addCurrentTask({ dependencies = [], checkpointFromTaskId = null, intent = 'standalone' } = {}) {
    try {
      let config = this.getActiveConfig?.();
      if (!config) throw new Error('The current job has no valid Gaussian input configuration.');
      config = cloneJson(config);
      config = applyContinuationIntent(config, intent);
      if (isContinuationIntent(intent)) {
        if (!checkpointFromTaskId) {
          throw new Error('This task continues from a checkpoint; choose the upstream task to read it from.');
        }
        if (!dependencies.includes(checkpointFromTaskId)) {
          throw new Error('The checkpoint source must also be selected as a direct dependency.');
        }
      }
      config.link0 ||= {};
      delete config.link0.oldCheckpoint;
      const base = safeBaseName(config.link0.checkpoint || config.title || 'calculation');
      const baseName = this.findAvailableBase(base);
      config.link0.checkpoint = `${baseName}.chk`;
      const task = createWorkflowTask(config, {
        title: config.title || `Calculation ${this.project.tasks.length + 1}`,
        inputName: `${baseName}.gjf`,
        outputName: `${baseName}.log`,
        dependencies,
        checkpointFromTaskId,
      });
      const candidate = { ...this.project, tasks: [...this.project.tasks, task] };
      const validation = validateWorkflowProject(candidate);
      if (!validation.valid) throw new Error(validation.errors[0]);
      this.project = candidate;
      this.project.updatedAt = new Date().toISOString();
      this.statusMessage = `Added ${task.title}. Export a ready step, run it in Gaussian, then import its output to unlock dependents.`;
      this.render();
      if (this.view === 'graph') this.scrollTaskIntoView(task.id);
      return task;
    } catch (error) {
      this.statusMessage = error instanceof Error ? error.message : String(error);
      this.render();
      return null;
    }
  }

  /**
   * Queue one task per retained conformer of the active ensemble. All siblings
   * share the dependencies and checkpoint source currently selected in the
   * "Add current job" controls, so they sit at the same level of the DAG.
   *
   * @param {number} [count=3] - How many of the retained conformers to queue.
   * @returns {Array<Object>} Created tasks (empty when nothing was added).
   */
  queueConformerTasks(count = 3) {
    try {
      const ensemble = this.getActiveEnsemble?.();
      if (!ensemble || !Array.isArray(ensemble.conformers) || ensemble.conformers.length === 0) {
        throw new Error('Generate a conformer ensemble for the current molecule before queueing conformers.');
      }
      const activeConfig = this.getActiveConfig?.();
      if (!activeConfig) throw new Error('The current job has no valid Gaussian input configuration.');

      const dependencySelect = this.container.querySelector('#workflow-new-dependencies');
      const checkpointSelect = this.container.querySelector('#workflow-new-checkpoint');
      const dependencies = Array.from(dependencySelect?.selectedOptions || []).map(option => option.value);
      const checkpointFromTaskId = checkpointSelect?.value || null;

      const requested = Number.isInteger(count) ? count : 3;
      const capacity = MAX_WORKFLOW_TASKS - this.project.tasks.length;
      const limit = Math.max(0, Math.min(10, requested, ensemble.conformers.length, capacity));
      if (limit === 0) {
        throw new Error(capacity <= 0
          ? `A project may contain at most ${MAX_WORKFLOW_TASKS} tasks.`
          : 'No retained conformers are available to queue.');
      }

      const tasks = [...this.project.tasks];
      const created = [];
      for (let i = 0; i < limit; i += 1) {
        const conformer = ensemble.conformers[i];
        const config = cloneJson(activeConfig);
        config.link0 ||= {};
        delete config.link0.oldCheckpoint;
        const base = safeBaseName(config.link0.checkpoint || config.title || 'calculation');
        const baseName = this.findAvailableBase(`${base}-conf${i + 1}`, tasks);
        config.link0.checkpoint = `${baseName}.chk`;
        config.atoms = conformer.atoms.map(atom => ({
          symbol: atom.symbol,
          x: atom.x,
          y: atom.y,
          z: atom.z,
        }));
        config.conformer = conformer.metadata;
        const title = `${String(config.title || 'Calculation').trim().slice(0, 170) || 'Calculation'} · conformer ${i + 1}`;
        const task = createWorkflowTask(config, {
          title,
          inputName: `${baseName}.gjf`,
          outputName: `${baseName}.log`,
          dependencies: [...dependencies],
          checkpointFromTaskId,
        });
        tasks.push(task);
        created.push(task);
      }

      const candidate = { ...this.project, tasks, updatedAt: new Date().toISOString() };
      const validation = validateWorkflowProject(candidate);
      if (!validation.valid) throw new Error(validation.errors[0]);
      this.project = candidate;
      this.statusMessage = `Queued ${created.length} conformer task(s). Each input carries its own geometry; the chosen conformer and ensemble spread are recorded in the task.`;
      this.render();
      return created;
    } catch (error) {
      this.statusMessage = error instanceof Error ? error.message : String(error);
      this.render();
      return [];
    }
  }

  setTaskDependencies(taskId, dependencies, checkpointFromTaskId = undefined) {
    const current = this.project.tasks.find(task => task.id === taskId);
    if (!current) return false;
    const invalidated = invalidateTaskAndDescendants(this.project, taskId);
    const checkpoint = checkpointFromTaskId === undefined ? current.checkpointFromTaskId : checkpointFromTaskId;
    const candidate = {
      ...invalidated,
      tasks: invalidated.tasks.map(task => task.id === taskId
        ? { ...task, dependencies: [...dependencies], checkpointFromTaskId: checkpoint || null }
        : task),
    };
    const validation = validateWorkflowProject(candidate);
    if (!validation.valid) {
      this.statusMessage = validation.errors[0];
      this.render();
      return false;
    }
    this.project = candidate;
    this.statusMessage = `Dependencies updated for ${current.title}; affected results were invalidated.`;
    this.render();
    return true;
  }

  setView(view) {
    if (view !== 'list' && view !== 'graph') return false;
    this.view = view;
    // The Workbench lives in the third app column; give the canvas the width it
    // needs on first entry, but respect a user who explicitly collapsed it.
    if (view === 'graph' && !this._graphFocusChosen) this.graphFocus = true;
    this.statusMessage = view === 'graph'
      ? 'Graph view: drag headers to arrange, drag a right-hand port onto another task to add a dependency, click a line to inspect it.'
      : 'List view: every field and gate remains editable per task.';
    this.render();
    return true;
  }

  selectGraphTask(taskId) {
    const task = this.project.tasks.find(candidate => candidate.id === taskId);
    if (!task) return false;
    this.selectedTaskId = taskId;
    this.selectedEdge = null;
    this.preserveGraphScroll(() => this.render());
    return true;
  }

  selectGraphEdge(fromId, toId) {
    if (!this.project.tasks.some(task => task.id === fromId) || !this.project.tasks.some(task => task.id === toId)) {
      return false;
    }
    this.selectedEdge = { from: fromId, to: toId };
    this.selectedTaskId = null;
    this.preserveGraphScroll(() => this.render());
    return true;
  }

  preserveGraphScroll(callback) {
    const viewport = this.container.querySelector?.('[data-graph-viewport]');
    const scroll = viewport ? { left: viewport.scrollLeft, top: viewport.scrollTop } : null;
    callback();
    const next = this.container.querySelector?.('[data-graph-viewport]');
    if (scroll && next) {
      next.scrollLeft = scroll.left;
      next.scrollTop = scroll.top;
    }
  }

  scrollTaskIntoView(taskId) {
    setTimeout(() => {
      const node = this.container.querySelector?.(`[data-graph-task="${cssEscape(taskId)}"]`);
      const viewport = this.container.querySelector?.('[data-graph-viewport]');
      if (!node || !viewport) return;
      const nodeRect = node.getBoundingClientRect();
      const viewRect = viewport.getBoundingClientRect();
      if (nodeRect.right > viewRect.right) viewport.scrollLeft += nodeRect.right - viewRect.right + 32;
      if (nodeRect.bottom > viewRect.bottom) viewport.scrollTop += nodeRect.bottom - viewRect.bottom + 32;
      if (nodeRect.left < viewRect.left) viewport.scrollLeft -= viewRect.left - nodeRect.left + 32;
      if (nodeRect.top < viewRect.top) viewport.scrollTop -= viewRect.top - nodeRect.top + 32;
    }, 0);
  }

  zoomGraph(direction) {
    if (direction === 'fit') return this.fitGraph();
    const next = direction === 'reset'
      ? 1
      : this.graphZoom + (direction === 'in' ? 0.1 : -0.1);
    this.graphZoom = Math.min(1.5, Math.max(0.5, Math.round(next * 10) / 10));
    this.render();
    return this.graphZoom;
  }

  fitGraph() {
    const viewport = this.container.querySelector?.('[data-graph-viewport]');
    const bounds = graphBounds(resolveGraphPositions(this.project.tasks));
    const width = viewport?.clientWidth || bounds.width;
    const height = viewport?.clientHeight || bounds.height;
    const zoom = Math.min(1, (width - 32) / bounds.width, (height - 32) / bounds.height);
    this.graphZoom = Math.max(0.5, Math.min(1, Math.round(zoom * 100) / 100));
    this.render();
    return this.graphZoom;
  }

  addBlockTask(kind) {
    try {
      const block = GRAPH_BLOCKS.find(item => item.kind === kind);
      if (!block) throw new Error('Unknown computational block.');
      let config = this.getActiveConfig?.();
      if (!config) throw new Error('The current job has no valid Gaussian input configuration.');
      config = cloneJson(config);
      config.route = { ...config.route, jobType: block.jobType };
      if (block.pop) config.route.pop = block.pop;
      config.link0 ||= {};
      delete config.link0.oldCheckpoint;
      const base = safeBaseName(config.link0.checkpoint || config.title || 'calculation');
      const baseName = this.findAvailableBase(base);
      config.link0.checkpoint = `${baseName}.chk`;
      const titleBase = String(config.title || 'Calculation').split(' · ')[0].trim() || 'Calculation';
      const selected = this.project.tasks.find(task => task.id === this.selectedTaskId) || null;
      const task = createWorkflowTask(config, {
        title: `${titleBase} · ${block.label}`,
        inputName: `${baseName}.gjf`,
        outputName: `${baseName}.log`,
        dependencies: selected ? [selected.id] : [],
      });
      if (selected) {
        const positions = resolveGraphPositions(this.project.tasks);
        const position = positions[selected.id];
        if (position) {
          task.graph = findFreeGraphPosition(positions, {
            x: position.x + GRAPH_NODE_WIDTH + 104,
            y: position.y + 40,
          });
        }
      }
      const candidate = { ...this.project, tasks: [...this.project.tasks, task] };
      const validation = validateWorkflowProject(candidate);
      if (!validation.valid) throw new Error(validation.errors[0]);
      this.project = candidate;
      this.project.updatedAt = new Date().toISOString();
      this.selectedTaskId = task.id;
      this.selectedEdge = null;
      this.statusMessage = selected
        ? `Added ${task.title}; it depends on ${selected.title}. Import its output to unlock dependents.`
        : `Added ${task.title}. Connect it or edit it in the list view.`;
      this.render();
      this.scrollTaskIntoView(task.id);
      return task;
    } catch (error) {
      this.statusMessage = error instanceof Error ? error.message : String(error);
      this.render();
      return null;
    }
  }

  /**
   * Persist a dragged node position. Layout is not a calculation input, so this
   * must never invalidate attempts or downstream results.
   */
  moveTaskNode(taskId, x, y) {
    const task = this.project.tasks.find(candidate => candidate.id === taskId);
    if (!task) return false;
    const graph = clampGraphPosition({ x, y });
    this.project = {
      ...this.project,
      tasks: this.project.tasks.map(candidate => candidate.id === taskId ? { ...candidate, graph } : candidate),
      updatedAt: new Date().toISOString(),
    };
    this.statusMessage = `Moved ${task.title}.`;
    this.render();
    return true;
  }

  connectGraphTasks(fromId, toId) {
    const issue = connectionIssue(this.project.tasks, fromId, toId);
    if (issue) {
      this.statusMessage = issue;
      this.render();
      return false;
    }
    const target = this.project.tasks.find(task => task.id === toId);
    return this.setTaskDependencies(toId, [...target.dependencies, fromId]);
  }

  disconnectGraphEdge(fromId, toId) {
    const target = this.project.tasks.find(task => task.id === toId);
    if (!target) return false;
    const dependencies = target.dependencies.filter(id => id !== fromId);
    const checkpoint = target.checkpointFromTaskId === fromId ? null : undefined;
    this.selectedEdge = null;
    return this.setTaskDependencies(toId, dependencies, checkpoint);
  }

  clearCheckpointHandoff(fromId, toId) {
    const target = this.project.tasks.find(task => task.id === toId);
    if (!target || target.checkpointFromTaskId !== fromId) return false;
    // Clearing the binding must also remove Geom=/Guess= tokens. Leaving them
    // would produce an input that reads a checkpoint the task no longer has.
    const config = stripContinuationIntent(cloneJson(target.config));
    return this.updateTask(toId, { config, checkpointFromTaskId: null }, true);
  }

  /**
   * Bind a downstream task to an upstream checkpoint and rewrite its route for
   * that continuation mode. The dependency edge must already exist, so this can
   * never bind a checkpoint across unrelated branches.
   *
   * @param {string} fromId
   * @param {string} toId
   * @param {'checkpoint'|'allcheck'} mode
   * @returns {boolean}
   */
  setCheckpointHandoff(fromId, toId, mode) {
    if (mode !== 'checkpoint' && mode !== 'allcheck') return false;
    const upstream = this.project.tasks.find(task => task.id === fromId);
    const target = this.project.tasks.find(task => task.id === toId);
    if (!upstream?.config.link0?.checkpoint) {
      this.statusMessage = 'The upstream task has no checkpoint file to hand off.';
      this.render();
      return false;
    }
    if (!target || !target.dependencies.includes(fromId)) {
      this.statusMessage = 'A checkpoint hand-off requires a direct dependency on the upstream task.';
      this.render();
      return false;
    }
    const config = applyContinuationIntent(cloneJson(target.config), mode);
    config.link0 ||= {};
    delete config.link0.oldCheckpoint;
    return this.updateTask(toId, { config, checkpointFromTaskId: fromId }, true);
  }

  validateGraph() {
    const validation = validateWorkflowProject(this.project);
    const dependencies = this.project.tasks.reduce((sum, task) => sum + task.dependencies.length, 0);
    this.statusMessage = validation.valid
      ? `Graph valid: ${this.project.tasks.length} task(s), ${dependencies} dependency edge(s), no cycles. This is structural validation; run gates need imported Gaussian output.`
      : `Graph has ${validation.errors.length} issue(s): ${validation.errors[0]}`;
    this.render();
    return validation.valid;
  }

  handleGraphAction(button) {
    const { graphAction: action } = button.dataset;
    if (action === 'validate') return this.validateGraph();
    if (action === 'import-output') {
      this.container.querySelector('#workflow-output-input')?.click();
      return true;
    }
    if (action === 'toggle-focus') {
      this.graphFocus = !this.graphFocus;
      this._graphFocusChosen = true;
      this.render();
      return this.graphFocus;
    }
    if (action === 'clear-selection') {
      this.selectedTaskId = null;
      this.selectedEdge = null;
      this.render();
      return true;
    }
    if (action === 'edit-list') {
      const taskId = button.dataset.taskId || null;
      this.selectedTaskId = taskId;
      this.setView('list');
      if (taskId) {
        setTimeout(() => {
          this.container.querySelector?.(`[data-task-id="${cssEscape(taskId)}"]`)
            ?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
        }, 0);
      }
      return true;
    }
    if (action === 'export') return this.downloadTask(button.dataset.taskId);
    if (action === 'duplicate') return this.duplicateTask(button.dataset.taskId);
    if (action === 'delete') return this.removeTask(button.dataset.taskId);
    if (action === 'remove-edge') return this.disconnectGraphEdge(button.dataset.edgeFrom, button.dataset.edgeTo);
    if (action === 'clear-checkpoint') return this.clearCheckpointHandoff(button.dataset.edgeFrom, button.dataset.edgeTo);
    if (action === 'handoff-checkpoint') {
      return this.setCheckpointHandoff(button.dataset.edgeFrom, button.dataset.edgeTo, button.dataset.mode);
    }
    return false;
  }

  beginNodeDrag(event, taskId) {
    if (typeof document === 'undefined' || event.button !== 0) return;
    const node = event.target.closest?.('[data-graph-task]');
    const stage = this.container.querySelector('[data-graph-stage]');
    const task = this.project.tasks.find(candidate => candidate.id === taskId);
    if (!node || !stage || !task) return;
    event.preventDefault();

    const zoom = this.graphZoom || 1;
    const positions = resolveGraphPositions(this.project.tasks);
    const origin = { ...positions[taskId] };
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;

    const onMove = moveEvent => {
      const dx = (moveEvent.clientX - startX) / zoom;
      const dy = (moveEvent.clientY - startY) / zoom;
      if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
      moved = true;
      positions[taskId] = {
        x: Math.max(0, origin.x + dx),
        y: Math.max(0, origin.y + dy),
      };
      node.style.left = `${positions[taskId].x}px`;
      node.style.top = `${positions[taskId].y}px`;
      updateEdgeGeometry(stage, positions);
    };
    const finish = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', finish);
      document.removeEventListener('pointercancel', finish);
      if (!moved) return;
      this._suppressNodeClick = true;
      setTimeout(() => { this._suppressNodeClick = false; }, 0);
      this.moveTaskNode(taskId, positions[taskId].x, positions[taskId].y);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', finish);
    document.addEventListener('pointercancel', finish);
  }

  beginConnectionDrag(event, fromId) {
    if (typeof document === 'undefined' || event.button !== 0) return;
    const stage = this.container.querySelector('[data-graph-stage]');
    const svg = this.container.querySelector('.wf-graph-edges');
    const from = resolveGraphPositions(this.project.tasks)[fromId];
    if (!stage || !svg || !from) return;
    event.preventDefault();
    event.stopPropagation();

    const zoom = this.graphZoom || 1;
    const stageRect = stage.getBoundingClientRect();
    const start = { x: from.x + GRAPH_NODE_WIDTH, y: from.y + GRAPH_NODE_HEIGHT / 2 };
    const preview = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    preview.setAttribute('class', 'wf-edge is-preview');
    svg.appendChild(preview);

    const pointAt = moveEvent => ({
      x: (moveEvent.clientX - stageRect.left) / zoom,
      y: (moveEvent.clientY - stageRect.top) / zoom,
    });
    const draw = moveEvent => {
      const point = pointAt(moveEvent);
      const reach = Math.max(40, Math.abs(point.x - start.x) * 0.5);
      preview.setAttribute('d',
        `M ${start.x} ${start.y} C ${start.x + reach} ${start.y}, ${point.x - reach} ${point.y}, ${point.x} ${point.y}`);
    };
    draw(event);

    const clearTargets = () => this.container.querySelectorAll?.('.wf-node.is-drop-target, .wf-node.is-drop-invalid')
      .forEach(node => node.classList.remove('is-drop-target', 'is-drop-invalid'));
    const highlightTarget = moveEvent => {
      clearTargets();
      const candidate = document.elementFromPoint?.(moveEvent.clientX, moveEvent.clientY)?.closest?.('[data-graph-task]');
      if (!candidate) return;
      const issue = candidate.dataset.graphTask === fromId
        ? 'self'
        : connectionIssue(this.project.tasks, fromId, candidate.dataset.graphTask);
      candidate.classList.add(issue ? 'is-drop-invalid' : 'is-drop-target');
    };
    const onMove = moveEvent => {
      draw(moveEvent);
      highlightTarget(moveEvent);
    };
    const finish = upEvent => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', finish);
      document.removeEventListener('pointercancel', finish);
      clearTargets();
      preview.remove();
      const target = document.elementFromPoint?.(upEvent.clientX, upEvent.clientY)?.closest?.('[data-graph-task]');
      if (!target) {
        this.statusMessage = 'Connection cancelled: drop on a task to add a dependency.';
        this.render();
        return;
      }
      this.connectGraphTasks(fromId, target.dataset.graphTask);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', finish);
    document.addEventListener('pointercancel', finish);
  }

  beginCanvasPan(event, viewport) {
    if (typeof document === 'undefined' || event.button !== 0) return;
    if (event.target.closest?.('[data-graph-task], path[data-graph-edge-from], [data-graph-port-out]')) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const left = viewport.scrollLeft;
    const top = viewport.scrollTop;
    const onMove = moveEvent => {
      viewport.scrollLeft = left - (moveEvent.clientX - startX);
      viewport.scrollTop = top - (moveEvent.clientY - startY);
    };
    const finish = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', finish);
      document.removeEventListener('pointercancel', finish);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', finish);
    document.addEventListener('pointercancel', finish);
  }

  applyRelationshipEdits(taskId) {
    const dependencySelect = this.container.querySelector(`[data-task-dependencies="${cssEscape(taskId)}"]`);
    const checkpointSelect = this.container.querySelector(`[data-task-checkpoint="${cssEscape(taskId)}"]`);
    const dependencies = Array.from(dependencySelect?.selectedOptions || []).map(option => option.value);
    const checkpointFromTaskId = checkpointSelect?.value || null;
    this.setTaskDependencies(taskId, dependencies, checkpointFromTaskId);
  }

  updateGate(taskId, gateName, value) {
    const task = this.project.tasks.find(item => item.id === taskId);
    if (!task || !Object.hasOwn(task.gates, gateName)) return false;
    if (gateName === 'expectedImaginaryModes' && value !== null
      && (!Number.isInteger(value) || value < 0)) {
      this.statusMessage = 'Expected imaginary-mode count must be a non-negative integer.';
      this.render();
      return false;
    }
    if (gateName === 'minImaginaryMagnitude' && value !== null
      && (!Number.isFinite(value) || value < 0 || value > 10000)) {
      this.statusMessage = 'Saddle threshold must be a number between 0 and 10000 cm-1, or blank to disable.';
      this.render();
      return false;
    }
    const updated = this.updateTask(taskId, { gates: { ...task.gates, [gateName]: value } }, true);
    if (updated) this.revalidateLastOutput(taskId);
    return updated;
  }

  revalidateLastOutput(taskId) {
    const task = this.project.tasks.find(item => item.id === taskId);
    const latest = task?.attempts.slice().reverse().find(attempt => attempt.parsedSection);
    if (!task || !latest) return false;
    const evaluation = evaluateWorkflowOutput(task, latest.parsedSection);
    this.project = {
      ...this.project,
      updatedAt: new Date().toISOString(),
      tasks: this.project.tasks.map(item => item.id === taskId
        ? {
          ...item,
          activeAttemptId: latest.id,
          attempts: item.attempts.map(attempt => attempt.id === latest.id
            ? { ...attempt, overall: evaluation.overall, gates: evaluation.gates }
            : attempt),
        }
        : item),
    };
    this.statusMessage = `Updated validation gates and re-evaluated the last imported output for ${task.title}; downstream results remain invalidated.`;
    this.render();
    return true;
  }

  renameTask(taskId, title) {
    const normalized = String(title || '').trim();
    if (!normalized) {
      this.statusMessage = 'Task title cannot be empty.';
      this.render();
      return false;
    }
    return this.updateTask(taskId, { title: normalized.slice(0, 200) }, false);
  }

  updateTask(taskId, updates, invalidate = true) {
    const existing = this.project.tasks.find(task => task.id === taskId);
    if (!existing) return false;
    const base = invalidate ? invalidateTaskAndDescendants(this.project, taskId) : this.project;
    const candidate = {
      ...base,
      tasks: base.tasks.map(task => task.id === taskId ? { ...task, ...updates } : task),
      updatedAt: new Date().toISOString(),
    };
    const validation = validateWorkflowProject(candidate);
    if (!validation.valid) {
      this.statusMessage = validation.errors[0];
      this.render();
      return false;
    }
    this.project = candidate;
    this.statusMessage = invalidate
      ? `Updated ${existing.title}; this task and downstream results need fresh validation.`
      : `Renamed task to ${updates.title}.`;
    this.render();
    return true;
  }

  replaceTaskFromCurrent(taskId) {
    const existing = this.project.tasks.find(task => task.id === taskId);
    const active = this.getActiveConfig?.();
    if (!existing || !active) return false;
    const config = cloneJson(active);
    config.link0 ||= {};
    config.link0.checkpoint = existing.config.link0?.checkpoint || config.link0.checkpoint;
    delete config.link0.oldCheckpoint;
    return this.updateTask(taskId, { config }, true);
  }

  duplicateTask(taskId) {
    const source = this.project.tasks.find(task => task.id === taskId);
    if (!source) return null;
    const config = cloneJson(source.config);
    const base = this.findAvailableBase(safeBaseName(`${source.title}-copy`));
    config.link0 ||= {};
    config.link0.checkpoint = `${base}.chk`;
    delete config.link0.oldCheckpoint;
    const task = createWorkflowTask(config, {
      title: `${source.title} copy`,
      inputName: `${base}.gjf`,
      outputName: `${base}.log`,
      dependencies: [...source.dependencies],
      checkpointFromTaskId: source.checkpointFromTaskId,
      gates: { ...source.gates },
      ...(source.graph ? { graph: clampGraphPosition({ x: source.graph.x + 32, y: source.graph.y + 32 }) } : {}),
    });
    const candidate = { ...this.project, tasks: [...this.project.tasks, task] };
    const validation = validateWorkflowProject(candidate);
    if (!validation.valid) {
      this.statusMessage = validation.errors[0];
      this.render();
      return null;
    }
    this.project = candidate;
    this.statusMessage = `Duplicated ${source.title}.`;
    this.render();
    if (this.view === 'graph') this.scrollTaskIntoView(task.id);
    return task;
  }

  removeTask(taskId) {
    const descendants = getDescendantIds(this.project.tasks, taskId);
    if (descendants.length && !globalThis.confirm?.(`Remove this task and ${descendants.length} dependent task(s)?`)) return false;
    const removed = new Set([taskId, ...descendants]);
    this.project = {
      ...this.project,
      tasks: this.project.tasks.filter(task => !removed.has(task.id)),
      updatedAt: new Date().toISOString(),
    };
    if (removed.has(this.selectedTaskId)) this.selectedTaskId = null;
    if (this.selectedEdge && (removed.has(this.selectedEdge.from) || removed.has(this.selectedEdge.to))) {
      this.selectedEdge = null;
    }
    this.statusMessage = `Removed ${removed.size} task(s).`;
    this.render();
    return true;
  }

  buildTaskInput(taskId) {
    return buildTaskInputText(this.project, taskId, { requireReady: true });
  }

  downloadTask(taskId) {
    let gjf;
    let provenance;
    try {
      gjf = this.buildTaskInput(taskId);
      // Hash exactly the bytes downloaded below; the record is built before any
      // state changes so a failure leaves the task ready to retry.
      provenance = buildTaskProvenanceRecord(this.project, taskId, { inputText: gjf, requireReady: true });
    } catch (error) {
      this.statusMessage = error instanceof Error ? error.message : String(error);
      this.render();
      return false;
    }
    const task = this.project.tasks.find(item => item.id === taskId);
    downloadTextFile(gjf, task.inputName, 'text/plain;charset=utf-8');
    downloadTextFile(
      stringifyProvenanceRecord(provenance),
      `${task.inputName}${PROVENANCE_SUFFIX}`,
      'application/json;charset=utf-8',
    );
    this.project = {
      ...this.project,
      tasks: this.project.tasks.map(item => item.id === taskId
        ? { ...item, provenance: createCompactProvenance(provenance) }
        : item),
    };
    return this.markTaskAwaitingOutput(taskId);
  }

  /**
   * Build the single-file `--Link1--` variant of a continuation task: the
   * upstream step and this step in one Gaussian input, so a scheduler can run
   * the chain as one queued entity. The task must still be `ready`; this is an
   * explicit alternative to the normal one-task `.gjf`, not a replacement.
   *
   * @param {string} taskId
   * @returns {string} Gaussian input text containing both links.
   */
  buildTaskLink1Input(taskId) {
    const task = this.project.tasks.find(item => item.id === taskId);
    if (!task) throw new Error(`Unknown task "${taskId}".`);
    if (!task.checkpointFromTaskId) {
      throw new Error('This task has no checkpoint source; Link1 export is only available for a continuation task.');
    }
    const states = deriveTaskStates(this.project);
    if (states[taskId] !== 'ready') {
      throw new Error(`Task is not ready to export (current state: ${states[taskId]}).`);
    }
    const upstream = this.project.tasks.find(item => item.id === task.checkpointFromTaskId);
    if (!upstream?.config?.link0?.checkpoint) {
      throw new Error(`Task "${taskId}" checkpoint source has no checkpoint file.`);
    }

    const upstreamConfig = cloneJson(upstream.config);
    upstreamConfig.link0 ||= {};
    if (upstream.checkpointFromTaskId) {
      const earlier = this.project.tasks.find(item => item.id === upstream.checkpointFromTaskId);
      if (!earlier?.config?.link0?.checkpoint) {
        throw new Error(`Task "${upstream.id}" checkpoint source has no checkpoint file.`);
      }
      upstreamConfig.link0.oldCheckpoint = earlier.config.link0.checkpoint;
    }

    const continuationConfig = cloneJson(task.config);
    continuationConfig.link0 ||= {};
    continuationConfig.link0.oldCheckpoint = upstream.config.link0.checkpoint;
    return buildLink1Input([upstreamConfig, continuationConfig]);
  }

  downloadTaskLink1(taskId) {
    let gjf;
    try {
      gjf = this.buildTaskLink1Input(taskId);
    } catch (error) {
      this.statusMessage = error instanceof Error ? error.message : String(error);
      this.render();
      return false;
    }
    const task = this.project.tasks.find(item => item.id === taskId);
    const filename = `${safeBaseName(task.inputName.replace(/\.gjf$/i, ''))}-link1.gjf`;
    downloadTextFile(gjf, filename, 'text/plain;charset=utf-8');
    const marked = this.markTaskAwaitingOutput(taskId);
    if (marked) {
      this.statusMessage = `Prepared ${filename}: the upstream step and ${task.title} run as one Gaussian job chain. Import the downstream section of the resulting log here.`;
      this.render();
    }
    return marked;
  }

  downloadBundle() {
    if (this.project.tasks.length === 0) {
      this.statusMessage = 'Add at least one calculation task before exporting a bundle.';
      this.render();
      return false;
    }
    let bundle;
    try {
      bundle = buildWorkflowBundle(this.project);
    } catch (error) {
      this.statusMessage = error instanceof Error ? error.message : String(error);
      this.render();
      return false;
    }
    downloadBinaryFile(bundle.bytes, bundle.filename, 'application/zip');
    this.statusMessage = `Exported ${bundle.entryNames.length} files in ${bundle.filename}: inputs for all ${this.project.tasks.length} task(s), manifest.json, and scheduler templates. The scripts do not validate results; import each log here to evaluate the gates.`;
    this.render();
    return true;
  }

  markTaskAwaitingOutput(taskId) {
    const states = deriveTaskStates(this.project);
    if (states[taskId] !== 'ready') return false;
    this.project = {
      ...this.project,
      updatedAt: new Date().toISOString(),
      tasks: this.project.tasks.map(task => task.id === taskId
        ? { ...task, lastExportedAt: new Date().toISOString() }
        : task),
    };
    const task = this.project.tasks.find(item => item.id === taskId);
    this.statusMessage = `Prepared ${task.inputName}. Run it externally, then import its output; this app does not run Gaussian.`;
    this.render();
    return true;
  }

  retryTask(taskId) {
    const state = deriveTaskStates(this.project)[taskId];
    if (!['failed', 'incomplete', 'needs-review'].includes(state)) return false;
    this.project = invalidateTaskAndDescendants(this.project, taskId);
    this.statusMessage = 'Cleared the active result for a retry; prior attempt history is retained.';
    this.render();
    return true;
  }

  async importOutputFiles(files) {
    if (this.processingOutputs || files.length === 0) return;
    this.processingOutputs = true;
    this.statusMessage = `Parsing ${files.length} selected output file(s) locally…`;
    this.render();
    const errors = [];
    let parsedCount = 0;
    try {
      for (const file of files) {
        try {
          if (!isSafeOutputFilename(file.name)) throw new Error('Output filename must be a safe .log or .out basename.');
          const parsed = typeof file.stream === 'function'
            ? await parseGaussianLogStream(file.stream(), file.name)
            : parseGaussianLogText(await file.text(), file.name);
          parsedCount++;
          this.queueParsedOutput(parsed);
        } catch (error) {
          errors.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } finally {
      this.processingOutputs = false;
      this.statusMessage = errors.length
        ? `Parsed ${parsedCount} file(s); ${errors.length} could not be read: ${errors.join(' · ')}`
        : `Parsed ${parsedCount} file(s). Check assignments below; logs remain in this page only.`;
      this.render();
    }
  }

  queueParsedOutput(parsed) {
    if (!isSafeOutputFilename(parsed?.filename)) {
      this.statusMessage = 'Output filename must be a safe .log or .out basename.';
      this.render();
      return false;
    }
    const states = deriveTaskStates(this.project);
    const matches = this.project.tasks.filter(task => task.outputName.toLowerCase() === parsed.filename.toLowerCase());
    const suggestedTaskId = matches.length === 1 && states[matches[0].id] === 'awaiting-output'
      ? matches[0].id
      : null;
    if (suggestedTaskId && parsed.sections.length === 1) {
      this.assignParsedOutput(suggestedTaskId, parsed, 0);
      return;
    }
    this.pendingOutputs.push({
      id: createWorkflowId('output'),
      parsed,
      suggestedTaskId,
      sectionIndex: parsed.sections.length === 1 ? 0 : null,
    });
    this.statusMessage = matches.length === 0
      ? `${parsed.filename} did not match a task filename; choose a waiting task to assign it.`
      : parsed.sections.length > 1
        ? `${parsed.filename} contains multiple calculation sections; choose the task and section to assign.`
        : `${parsed.filename} matches a task that is not awaiting output; export that step before assigning its log.`;
    this.render();
  }

  assignPendingOutput(outputId, taskId, sectionIndex) {
    const pending = this.pendingOutputs.find(output => output.id === outputId);
    if (!pending || !taskId || !Number.isInteger(sectionIndex)) return false;
    return this.assignParsedOutput(taskId, pending.parsed, sectionIndex, outputId);
  }

  assignParsedOutput(taskId, parsed, sectionIndex = 0, pendingId = null) {
    const states = deriveTaskStates(this.project);
    const task = this.project.tasks.find(item => item.id === taskId);
    if (!task || states[taskId] !== 'awaiting-output') {
      this.statusMessage = 'Only an exported task awaiting its output can be validated.';
      this.render();
      return false;
    }
    const section = parsed.sections[sectionIndex];
    if (!section) {
      this.statusMessage = 'Select a calculation section present in the imported output.';
      this.render();
      return false;
    }
    const evaluation = evaluateWorkflowOutput(task, section);
    const attempt = {
      id: createWorkflowId('attempt'),
      outputFilename: parsed.filename,
      importedAt: new Date().toISOString(),
      overall: evaluation.overall,
      gates: evaluation.gates,
      summary: { status: section.status, sectionIndex: section.index },
      parsedSection: cloneJson(section),
    };
    this.project = {
      ...this.project,
      updatedAt: new Date().toISOString(),
      tasks: this.project.tasks.map(item => item.id === taskId
        ? { ...item, attempts: [...item.attempts, attempt].slice(-100), activeAttemptId: attempt.id }
        : item),
    };
    if (pendingId) this.pendingOutputs = this.pendingOutputs.filter(output => output.id !== pendingId);
    this.statusMessage = evaluation.overall === 'pass'
      ? `${task.title} passed its configured output gates.`
      : evaluation.overall === 'fail'
        ? `${task.title} failed an output gate; dependent tasks remain blocked.`
        : `${task.title} needs review; required evidence is missing or unknown, so dependents remain blocked.`;
    this.render();
    return true;
  }

  findAvailableBase(proposed, tasks = this.project.tasks) {
    const base = safeBaseName(proposed);
    const usedInputs = new Set(tasks.map(task => task.inputName.toLowerCase()));
    const usedOutputs = new Set(tasks.map(task => task.outputName.toLowerCase()));
    const usedCheckpoints = new Set(tasks.map(task => task.config.link0?.checkpoint?.toLowerCase()).filter(Boolean));
    for (let suffix = 1; suffix <= 1000; suffix++) {
      const candidate = suffix === 1 ? base : `${base}-${suffix}`;
      if (!usedInputs.has(`${candidate}.gjf`.toLowerCase())
        && !usedOutputs.has(`${candidate}.log`.toLowerCase())
        && !usedOutputs.has(`${candidate}.out`.toLowerCase())
        && !usedCheckpoints.has(`${candidate}.chk`.toLowerCase())) return candidate;
    }
    throw new Error('Could not create a unique filename for this task.');
  }
}

function isSafeOutputFilename(filename) {
  return typeof filename === 'string' && filename.length > 0 && filename.length <= 255
    && !/[\\/\r\n\0]/.test(filename) && /\.(?:log|out)$/i.test(filename);
}

function requiresRouteKeyword(config, keyword) {
  const routeText = `${config.route?.jobType || ''} ${config.route?.custom || ''}`;
  return new RegExp(`(?:^|\\s)${keyword}(?:\\b|=)`, 'i').test(routeText);
}

function requiresCheckpointInput(config) {
  const routeText = `${config.route?.jobType || ''} ${config.route?.custom || ''}`;
  return routeReadsCheckpoint(routeText);
}

function isContinuationIntent(intent) {
  return Object.hasOwn(CONTINUATION_ROUTES, intent);
}

/**
 * Apply the task-editor intent to a snapshot of the active route.
 *
 * The user should not have to hand-type `Geom=Checkpoint Guess=Read`. Existing
 * `Geom=` (and, for the checkpoint mode, `Guess=`) tokens are replaced rather
 * than duplicated, so a route that already carried an old spelling cannot end
 * up with two conflicting keywords.
 *
 * @param {Object} config
 * @param {'standalone'|'checkpoint'|'allcheck'} intent
 * @returns {Object} A new config (the input is not mutated).
 */
function applyContinuationIntent(config, intent) {
  if (intent === undefined || intent === null || intent === 'standalone') return config;
  const tokens = CONTINUATION_ROUTES[intent];
  if (!tokens) throw new Error(`Unknown task intent "${intent}".`);

  const route = { ...config.route };
  const withoutGeom = stripRouteToken(route, 'Geom');
  const cleaned = intent === 'checkpoint' ? stripRouteToken(withoutGeom, 'Guess') : withoutGeom;
  cleaned.custom = [cleaned.custom, tokens].filter(Boolean).join(' ').trim();
  return { ...config, route: cleaned };
}

/**
 * Remove `Geom=`/`Guess=` tokens from a route. Used when a checkpoint binding
 * is cleared: the tokens are only meaningful with that binding.
 *
 * @param {Object} config
 * @returns {Object} A new config (the input is not mutated).
 */
function stripContinuationIntent(config) {
  const route = { ...config.route };
  const withoutGeom = stripRouteToken(route, 'Geom');
  const cleaned = stripRouteToken(withoutGeom, 'Guess');
  return { ...config, route: cleaned };
}

/** @param {Object} route @param {'Geom'|'Guess'} keyword */
function stripRouteToken(route, keyword) {
  const pattern = new RegExp(`\\b${keyword}\\s*=\\s*(?:\\([^)]*\\)|\\S+)`, 'gi');
  const next = { ...route };
  for (const field of ['jobType', 'custom']) {
    if (typeof next[field] !== 'string') continue;
    next[field] = next[field].replace(pattern, ' ').replace(/\s+/g, ' ').trim();
  }
  return next;
}

function safeBaseName(value) {
  const normalized = String(value || 'calculation').normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const withoutExtension = normalized.replace(/\.chk$/i, '');
  const safe = withoutExtension.replace(/[^A-Za-z0-9_. -]/g, '').replace(/^\.+/, '').trim().replace(/\s+/g, '-');
  return (safe || 'calculation').slice(0, 100);
}

function getDescendantIds(tasks, taskId) {
  const found = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of tasks) {
      if (!found.has(task.id) && task.dependencies.some(id => id === taskId || found.has(id))) {
        found.add(task.id);
        changed = true;
      }
    }
  }
  return [...found];
}

function cssEscape(value) {
  return globalThis.CSS?.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, '\\$&');
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function downloadTextFile(text, filename, type) {
  downloadBlob(new Blob([text], { type }), filename);
}

function downloadBinaryFile(bytes, filename, type) {
  downloadBlob(new Blob([bytes], { type }), filename);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
