/**
 * @fileoverview Whole-workflow bundle export.
 *
 * A bundle is a single ZIP containing every task input, a per-input
 * `.provenance.json` sidecar, a data-only `manifest.json` describing the DAG
 * and gates, and inert scheduler templates. Gate evaluation stays in the
 * browser: the exported scripts never parse Gaussian output, so they cannot
 * claim a calculation passed.
 */

import {
  topologicallySortTasks,
  validateWorkflowProject,
  WORKFLOW_SCHEMA_VERSION,
} from './workflowModel.js';
import { buildTaskInputText, buildTaskProvenanceRecord } from './workflowInput.js';
import { PROVENANCE_SUFFIX, stringifyProvenanceRecord } from './provenance.js';
import { createZip } from './zipWriter.js';

export const BUNDLE_SCHEMA_VERSION = 1;
export const BUNDLE_MANIFEST_NAME = 'manifest.json';

/**
 * Build the complete bundle in memory.
 *
 * Every task input is exported, including blocked or already-exported tasks.
 * That intentionally differs from the single-task download rule, which only
 * offers a `ready` task so results are validated one at a time before the next
 * input is requested.
 *
 * @param {Object} project Workflow project (must validate).
 * @param {{ date?: Date|string|number }} [options]
 * @returns {{ filename: string, bytes: Uint8Array, manifest: Object, entryNames: string[] }}
 */
export function buildWorkflowBundle(project, options = {}) {
  const validation = validateWorkflowProject(project);
  if (!validation.valid) {
    throw new Error(`Cannot export bundle: ${validation.errors.join(' ')}`);
  }
  if (project.tasks.length === 0) {
    throw new Error('Add at least one calculation task before exporting a bundle.');
  }

  const generatedAt = normaliseDate(options.date);
  const ordered = topologicallySortTasks(project.tasks);
  const manifest = buildBundleManifest(project, { generatedAt, orderedTasks: ordered });

  const entries = [
    { name: BUNDLE_MANIFEST_NAME, data: `${JSON.stringify(manifest, null, 2)}\n` },
  ];
  for (const task of ordered) {
    const inputText = buildTaskInputText(project, task.id, { requireReady: false });
    entries.push({ name: task.inputName, data: inputText });
    // One sidecar per input, hashing exactly the bytes written beside it.
    entries.push({
      name: `${task.inputName}${PROVENANCE_SUFFIX}`,
      data: stringifyProvenanceRecord(buildTaskProvenanceRecord(project, task.id, {
        inputText,
        generatedAt,
        requireReady: false,
      })),
    });
  }

  entries.push(
    { name: 'submit-slurm.sh', data: renderSlurmSubmitScript(project, ordered) },
    ...ordered.map(task => ({
      name: `task-${task.id}.slurm`,
      data: renderSlurmTaskScript(project, task),
    })),
    { name: 'submit-pbs.sh', data: renderPbsSubmitScript(project, ordered) },
    ...ordered.map(task => ({
      name: `task-${task.id}.pbs`,
      data: renderPbsTaskScript(project, task),
    })),
    { name: 'run-all.sh', data: renderRunAllScript(project, ordered) },
  );

  return {
    filename: `${safeBundleBaseName(project.name)}.workflow.zip`,
    bytes: createZip(entries, { date: generatedAt }),
    manifest,
    entryNames: entries.map(entry => entry.name),
  };
}

/**
 * Build the data-only manifest. No validation logic is embedded here; the
 * `gates` values are the configuration the browser will apply after logs are
 * imported.
 *
 * @param {Object} project
 * @param {{ generatedAt?: string, orderedTasks?: Object[] }} [options]
 * @returns {Object}
 */
export function buildBundleManifest(project, options = {}) {
  const ordered = options.orderedTasks || topologicallySortTasks(project.tasks);
  const generatedAt = new Date(options.generatedAt || Date.now());
  if (Number.isNaN(generatedAt.getTime())) throw new TypeError('A valid manifest timestamp is required.');
  return {
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    workflowSchemaVersion: WORKFLOW_SCHEMA_VERSION,
    generatedAt: generatedAt.toISOString(),
    project: {
      id: project.id,
      name: project.name,
    },
    tasks: ordered.map(task => ({
      id: task.id,
      title: task.title,
      dependencies: [...task.dependencies],
      input: task.inputName,
      output: task.outputName,
      provenance: `${task.inputName}${PROVENANCE_SUFFIX}`,
      checkpoint: task.config?.link0?.checkpoint || null,
      checkpointFromTaskId: task.checkpointFromTaskId || null,
      gates: { ...task.gates },
    })),
    dag: {
      edges: ordered.flatMap(task => task.dependencies.map(dependencyId => ({
        from: dependencyId,
        to: task.id,
      }))),
    },
  };
}

/**
 * Render the SLURM submission template. Jobs are submitted in topological
 * order and dependents use `afterok` on the captured job IDs.
 *
 * @param {Object} project
 * @param {Object[]} orderedTasks
 * @returns {string}
 */
export function renderSlurmSubmitScript(project, orderedTasks) {
  const variableByTask = new Map(orderedTasks.map((task, index) => [task.id, `JID_${index + 1}`]));
  const lines = [
    '#!/usr/bin/env bash',
    headerComments(project, 'SLURM submission template'),
    '# Each dependent job uses --dependency=afterok:<job ids>, so it starts only',
    '# after every listed dependency ends successfully.',
    '',
    'set -euo pipefail',
    'cd "$(dirname "$0")"',
    '',
  ];
  orderedTasks.forEach((task, index) => {
    const variable = `JID_${index + 1}`;
    const dependencyVariables = task.dependencies.map(id => `\${${variableByTask.get(id)}}`).join(':');
    const args = dependencyVariables
      ? `--parsable --dependency=afterok:${dependencyVariables}`
      : '--parsable';
    lines.push(`# ${oneLine(task.id)}: ${oneLine(task.title)}`);
    lines.push(`${variable}=$(sbatch ${args} task-${task.id}.slurm)`);
  });
  lines.push('', `echo "Submitted ${orderedTasks.length} jobs. Import Gaussian logs into GaussianHelper to validate results."`);
  return `${lines.join('\n')}\n`;
}

/**
 * Render one per-task SLURM script. It only runs Gaussian and never inspects
 * the result.
 *
 * @param {Object} project
 * @param {Object} task
 * @returns {string}
 */
export function renderSlurmTaskScript(project, task) {
  const jobName = safeJobName(task.id);
  return [
    '#!/usr/bin/env bash',
    headerComments(project, `SLURM task template for ${task.id}`),
    `#SBATCH --job-name=${jobName}`,
    `#SBATCH --output=${jobName}-%j.slurm.out`,
    '#SBATCH --ntasks=1',
    '',
    'set -euo pipefail',
    'cd "${SLURM_SUBMIT_DIR:-$(dirname "$0")}"',
    '',
    'GAUSSIAN_CMD="${GAUSSIAN_CMD:-g16}"',
    `"$GAUSSIAN_CMD" < "${task.inputName}" > "${task.outputName}"`,
    '',
  ].join('\n');
}

/**
 * Render the PBS submission template, with `depend=afterok` edges.
 *
 * @param {Object} project
 * @param {Object[]} orderedTasks
 * @returns {string}
 */
export function renderPbsSubmitScript(project, orderedTasks) {
  const variableByTask = new Map(orderedTasks.map((task, index) => [task.id, `JID_${index + 1}`]));
  const lines = [
    '#!/usr/bin/env bash',
    headerComments(project, 'PBS submission template'),
    '# Each dependent job uses -W depend=afterok:<job ids>, so it starts only',
    '# after every listed dependency ends successfully.',
    '',
    'set -euo pipefail',
    'cd "$(dirname "$0")"',
    '',
  ];
  orderedTasks.forEach((task, index) => {
    const variable = `JID_${index + 1}`;
    const dependencyVariables = task.dependencies.map(id => `\${${variableByTask.get(id)}}`).join(':');
    const args = dependencyVariables
      ? `-W depend=afterok:${dependencyVariables}`
      : '';
    lines.push(`# ${oneLine(task.id)}: ${oneLine(task.title)}`);
    lines.push(`${variable}=$(qsub ${args ? `${args} ` : ''}task-${task.id}.pbs)`);
  });
  lines.push('', `echo "Submitted ${orderedTasks.length} jobs. Import Gaussian logs into GaussianHelper to validate results."`);
  return `${lines.join('\n')}\n`;
}

/**
 * Render one per-task PBS script.
 *
 * @param {Object} project
 * @param {Object} task
 * @returns {string}
 */
export function renderPbsTaskScript(project, task) {
  const jobName = safeJobName(task.id);
  const processors = positiveInteger(task.config?.link0?.nproc, 1);
  return [
    '#!/usr/bin/env bash',
    headerComments(project, `PBS task template for ${task.id}`),
    `#PBS -N ${jobName}`,
    `#PBS -o ${jobName}.pbs.out`,
    '#PBS -j oe',
    `#PBS -l nodes=1:ppn=${processors}`,
    '',
    'cd "$PBS_O_WORKDIR"',
    'set -euo pipefail',
    '',
    'GAUSSIAN_CMD="${GAUSSIAN_CMD:-g16}"',
    `"$GAUSSIAN_CMD" < "${task.inputName}" > "${task.outputName}"`,
    '',
  ].join('\n');
}

/**
 * Render a fully commented plain-bash run sequence. Running this file does
 * nothing: every command is commented out on purpose.
 *
 * @param {Object} project
 * @param {Object[]} orderedTasks
 * @returns {string}
 */
export function renderRunAllScript(project, orderedTasks) {
  const lines = [
    '#!/usr/bin/env bash',
    headerComments(project, 'plain-bash run sequence'),
    '#',
    '# This file intentionally contains no executable commands. Every step below',
    '# is commented out so running or sourcing this file cannot start calculations.',
    '# Uncomment the sequence after reviewing the generated inputs.',
    '#',
    '# Run from this directory in topological order:',
    '#',
    '# GAUSSIAN_CMD="${GAUSSIAN_CMD:-g16}"',
  ];
  for (const task of orderedTasks) {
    lines.push(`# "$GAUSSIAN_CMD" < "${task.inputName}" > "${task.outputName}"`);
  }
  return `${lines.join('\n')}\n`;
}

function headerComments(project, label) {
  return [
    `# Generated by GaussianHelper from workflow project "${oneLine(project.name)}".`,
    `# ${label}. TEMPLATE ONLY.`,
    '# It does not inspect Gaussian logs or validate results. Import the outputs',
    '# into the Workflow Workbench to evaluate the configured gates.',
  ].join('\n');
}

function normaliseDate(value) {
  const date = value === undefined ? new Date() : (value instanceof Date ? value : new Date(value));
  if (Number.isNaN(date.getTime())) throw new TypeError('A valid export date is required.');
  return date;
}

function safeBundleBaseName(value) {
  const normalized = String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const safe = normalized
    .replace(/\.zip$/i, '')
    .replace(/[^A-Za-z0-9_. -]/g, '')
    .replace(/^\.+/, '')
    .trim()
    .replace(/\s+/g, '-');
  return (safe || 'gaussian-workflow').slice(0, 100);
}

function safeJobName(value) {
  return String(value).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 64) || 'gaussian-task';
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function oneLine(value) {
  return String(value ?? '').replace(/[\0\r\n]+/g, ' ').trim().slice(0, 200);
}
