import { parseGaussianLogStream, parseGaussianLogText } from '../parsers/gaussianLogParser.js';
import { buildLink1Input } from '../generators/gjfGenerator.js';
import { evaluateWorkflowOutput } from '../utils/workflowGates.js';
import { buildWorkflowBundle } from '../utils/bundleExport.js';
import { buildTaskInputText, buildTaskProvenanceRecord } from '../utils/workflowInput.js';
import { PROVENANCE_SUFFIX, createCompactProvenance, stringifyProvenanceRecord } from '../utils/provenance.js';
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

const STATUS_LABELS = {
  blocked: 'Blocked',
  ready: 'Ready',
  'awaiting-output': 'Awaiting output',
  passed: 'Passed',
  failed: 'Failed',
  incomplete: 'Incomplete',
  'needs-review': 'Needs review',
};

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
    this.render();
  }

  render() {
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
            ${this.project.tasks.length ? `
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
            ${this.getActiveEnsemble ? `
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

        ${this.project.tasks.length ? `
          <div class="workflow-progress" aria-label="Project progress">
            ${[['passed', 'Passed'], ['ready', 'Ready'], ['blocked', 'Blocked'], ['awaiting-output', 'Awaiting output'], ['failed', 'Failed'], ['incomplete', 'Incomplete'], ['needs-review', 'Needs review']]
              .map(([key, label]) => `<div class="workflow-progress-item"><strong>${counts[key] || 0}</strong><span>${label}</span></div>`).join('')}
          </div>
          <section class="workflow-task-list" aria-label="Calculation tasks">
            ${topologicallySortTasks(this.project.tasks).map(task => this.renderTask(task, states)).join('')}
          </section>
        ` : '<section class="card workflow-empty"><div class="card-body"><strong>No calculation steps yet.</strong><p>Add the active job to create the first step.</p></div></section>'}
      </div>
    `;
    this.bindEvents();
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
            <label class="workflow-field"><span>Expected imaginary modes (optional)</span>
              <input class="form-input" type="number" min="0" step="1" data-task-id="${escapeHtml(task.id)}" data-workflow-imaginary-modes="${escapeHtml(task.id)}"
                value="${task.gates.expectedImaginaryModes ?? ''}" />
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
  const geomPattern = /\bGeom\s*=\s*(?:\([^)]*\)|\S+)/gi;
  const guessPattern = /\bGuess\s*=\s*(?:\([^)]*\)|\S+)/gi;
  for (const field of ['jobType', 'custom']) {
    if (typeof route[field] !== 'string') continue;
    let value = route[field].replace(geomPattern, ' ');
    if (intent === 'checkpoint') value = value.replace(guessPattern, ' ');
    route[field] = value.replace(/\s+/g, ' ').trim();
  }
  route.custom = [route.custom, tokens].filter(Boolean).join(' ').trim();
  return { ...config, route };
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
