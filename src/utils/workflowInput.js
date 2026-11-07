/**
 * @fileoverview Builds the Gaussian input text for a workflow task.
 *
 * Both the single-task download in the Workbench and the whole-workflow bundle
 * export use this module, so route, geometry, checkpoint, and GenECP handling
 * stay in one place. Single-task downloads additionally require the task to be
 * in the `ready` state; a bundle export deliberately exports every task input.
 */

import { generateGJF } from '../generators/gjfGenerator.js';
import { buildProvenanceRecordSync } from './provenance.js';
import { deriveTaskStates } from './workflowModel.js';

/**
 * Render the `.gjf` text for one workflow task.
 *
 * @param {Object} project Validated workflow project.
 * @param {string} taskId
 * @param {{ requireReady?: boolean }} [options] Set `requireReady` to false to
 *   build inputs for blocked or already-exported tasks (bundle export).
 * @returns {string} Gaussian input file contents.
 */
export function buildTaskInputText(project, taskId, { requireReady = true } = {}) {
  const task = project.tasks.find(item => item.id === taskId);
  if (!task) throw new Error(`Unknown task "${taskId}".`);
  if (requireReady) {
    const states = deriveTaskStates(project);
    if (states[taskId] !== 'ready') {
      throw new Error(`Task is not ready to export (current state: ${states[taskId]}).`);
    }
  }

  const config = cloneJson(task.config);
  config.link0 ||= {};
  if (task.checkpointFromTaskId) {
    const source = project.tasks.find(item => item.id === task.checkpointFromTaskId);
    if (!source?.config?.link0?.checkpoint) {
      throw new Error(`Task "${taskId}" checkpoint source "${task.checkpointFromTaskId}" has no checkpoint file.`);
    }
    config.link0.oldCheckpoint = source.config.link0.checkpoint;
  }
  return generateGJF(config);
}

/**
 * Assemble the provenance context for one workflow task.
 *
 * `inputText` is generated once and reused by both the bundle and the
 * single-task download, so the SHA-256 always covers the exact exported bytes
 * (including `%OldChk`, which is derived from the project DAG rather than
 * stored in the task config).
 *
 * @param {Object} project Validated workflow project.
 * @param {string} taskId
 * @param {Object} [options]
 * @param {string} [options.inputText] Already-generated input text.
 * @param {Date|string|number} [options.generatedAt]
 * @param {boolean} [options.requireReady] Match the input builder's rule.
 * @param {Object} [options.geometrySource] Explicit source override.
 * @returns {Object} Context accepted by `buildProvenanceRecord`.
 */
export function taskProvenanceContext(project, taskId, options = {}) {
  const task = project.tasks.find(item => item.id === taskId);
  if (!task) throw new Error(`Unknown task "${taskId}".`);
  const inputText = options.inputText
    ?? buildTaskInputText(project, taskId, { requireReady: options.requireReady !== false });
  return {
    inputText,
    inputName: task.inputName,
    generatedAt: options.generatedAt,
    taskId: task.id,
    parentTaskIds: [...task.dependencies],
    // Reuse the geometry source recorded by a previous export; never invent a
    // source for a task that does not carry one.
    geometrySource: options.geometrySource ?? task.provenance?.geometrySource,
  };
}

/**
 * Build the synchronous provenance record for one workflow task.
 *
 * Used by the bundle writer and the single-task download, both of which need
 * the record before returning. The async `buildProvenanceRecord` is the
 * WebCrypto equivalent and is tested to produce identical bytes.
 *
 * @param {Object} project
 * @param {string} taskId
 * @param {Object} [options] Same options as {@link taskProvenanceContext}.
 * @returns {Object}
 */
export function buildTaskProvenanceRecord(project, taskId, options = {}) {
  const task = project.tasks.find(item => item.id === taskId);
  if (!task) throw new Error(`Unknown task "${taskId}".`);
  return buildProvenanceRecordSync(task.config, taskProvenanceContext(project, taskId, options));
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}
