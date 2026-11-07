/**
 * @fileoverview Builds the Gaussian input text for a workflow task.
 *
 * Both the single-task download in the Workbench and the whole-workflow bundle
 * export use this module, so route, geometry, checkpoint, and GenECP handling
 * stay in one place. Single-task downloads additionally require the task to be
 * in the `ready` state; a bundle export deliberately exports every task input.
 */

import { generateGJF } from '../generators/gjfGenerator.js';
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

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}
