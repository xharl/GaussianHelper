import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildWorkflowBundle } from '../src/utils/bundleExport.js';
import { createZip } from '../src/utils/zipWriter.js';
import { createWorkflowProject } from '../src/utils/workflowModel.js';
import { WorkflowWorkbench } from '../src/components/WorkflowWorkbench.js';

const FIXED_DATE = new Date('2026-11-06T12:34:56.000Z');
const hasPython = spawnSync('python3', ['--version']).status === 0;

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
      requireThermochemistry: false,
      expectedImaginaryModes: null,
    },
    activeAttemptId: null,
    lastExportedAt: null,
    attempts: [],
    ...overrides,
  };
}

function diamondProject() {
  return {
    schemaVersion: 1,
    id: 'project-diamond',
    name: 'Diamond workflow',
    createdAt: FIXED_DATE.toISOString(),
    updatedAt: FIXED_DATE.toISOString(),
    tasks: [
      makeTask('A'),
      makeTask('B', ['A']),
      makeTask('C', ['A']),
      makeTask('D', ['B', 'C']),
      makeTask('E', ['D']),
    ],
  };
}

function crc32Bytes(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readStoredZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= 0 && offset >= bytes.length - 65557; offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  expect(eocd).toBeGreaterThanOrEqual(0);
  const count = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  expect(centralOffset + centralSize).toBeLessThanOrEqual(eocd);

  const decoder = new TextDecoder();
  const entries = new Map();
  let cursor = centralOffset;
  for (let index = 0; index < count; index++) {
    expect(view.getUint32(cursor, true)).toBe(0x02014b50);
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const checksum = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));

    expect(view.getUint32(localOffset, true)).toBe(0x04034b50);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = bytes.subarray(dataStart, dataStart + compressedSize);
    expect(method).toBe(0);
    expect(flags & 0x0800).toBe(0x0800);
    expect(compressedSize).toBe(uncompressedSize);
    expect(crc32Bytes(data)).toBe(checksum);
    entries.set(name, { name, bytes: data, text: decoder.decode(data), flags, method });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  expect(entries.size).toBe(count);
  return entries;
}

describe('workflow bundle export', () => {
  it('exports every task input, the manifest, and all scheduler templates for a 5-task diamond', () => {
    const project = diamondProject();
    const bundle = buildWorkflowBundle(project, { date: FIXED_DATE });

    expect(bundle.filename).toBe('Diamond-workflow.workflow.zip');
    expect(bundle.bytes.subarray(0, 4)).toEqual(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));

    const entries = readStoredZip(bundle.bytes);
    expect([...entries.keys()].sort()).toEqual([
      'A.gjf', 'B.gjf', 'C.gjf', 'D.gjf', 'E.gjf',
      'manifest.json',
      'run-all.sh',
      'submit-pbs.sh', 'submit-slurm.sh',
      'task-A.pbs', 'task-A.slurm',
      'task-B.pbs', 'task-B.slurm',
      'task-C.pbs', 'task-C.slurm',
      'task-D.pbs', 'task-D.slurm',
      'task-E.pbs', 'task-E.slurm',
    ].sort());

    for (const id of ['A', 'B', 'C', 'D', 'E']) {
      const input = entries.get(`${id}.gjf`).text;
      expect(input).toContain(`%Chk=${id}.chk`);
      expect(input).toContain('HF/3-21G');
      expect(input).toContain('H');
    }
    expect(entries.get('manifest.json').text.endsWith('\n')).toBe(true);
    expect(entries.get('submit-slurm.sh').text).toContain('does not inspect Gaussian logs or validate results');
    expect(entries.get('run-all.sh').text).toContain('# "$GAUSSIAN_CMD" < "A.gjf" > "A.log"');
  });

  it('encodes the diamond dependency structure exactly in the SLURM and PBS submit scripts', () => {
    const entries = readStoredZip(buildWorkflowBundle(diamondProject(), { date: FIXED_DATE }).bytes);
    const slurm = entries.get('submit-slurm.sh').text;

    expect(slurm).toContain('JID_1=$(sbatch --parsable task-A.slurm)');
    expect(slurm).toContain('JID_2=$(sbatch --parsable --dependency=afterok:${JID_1} task-B.slurm)');
    expect(slurm).toContain('JID_3=$(sbatch --parsable --dependency=afterok:${JID_1} task-C.slurm)');
    expect(slurm).toContain('JID_4=$(sbatch --parsable --dependency=afterok:${JID_2}:${JID_3} task-D.slurm)');
    expect(slurm).toContain('JID_5=$(sbatch --parsable --dependency=afterok:${JID_4} task-E.slurm)');
    expect(slurm).not.toMatch(/g16|validate.*pass|passed/i);

    const pbs = entries.get('submit-pbs.sh').text;
    expect(pbs).toContain('JID_1=$(qsub task-A.pbs)');
    expect(pbs).toContain('JID_4=$(qsub -W depend=afterok:${JID_2}:${JID_3} task-D.pbs)');
    expect(pbs).toContain('JID_5=$(qsub -W depend=afterok:${JID_4} task-E.pbs)');

    expect(entries.get('task-D.slurm').text).toContain('"$GAUSSIAN_CMD" < "D.gjf" > "D.log"');
    expect(entries.get('task-D.pbs').text).toContain('"$GAUSSIAN_CMD" < "D.gjf" > "D.log"');
  });

  it('writes a manifest whose tasks, filenames, gates, and DAG edges match the project', () => {
    const project = diamondProject();
    const bundle = buildWorkflowBundle(project, { date: FIXED_DATE });
    const manifest = bundle.manifest;

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.generatedAt).toBe(FIXED_DATE.toISOString());
    expect(manifest.project).toEqual({ id: 'project-diamond', name: 'Diamond workflow' });
    expect(manifest.tasks.map(task => task.id)).toEqual(['A', 'B', 'C', 'D', 'E']);

    const byDependency = manifest.tasks.find(task => task.id === 'D');
    expect(byDependency.dependencies).toEqual(['B', 'C']);
    expect(byDependency.input).toBe('D.gjf');
    expect(byDependency.output).toBe('D.log');
    expect(byDependency.checkpoint).toBe('D.chk');
    expect(byDependency.gates).toEqual(project.tasks.find(task => task.id === 'D').gates);

    expect(manifest.dag.edges.map(edge => `${edge.from}->${edge.to}`).sort()).toEqual([
      'A->B', 'A->C', 'B->D', 'C->D', 'D->E',
    ].sort());

    const parsedFromZip = JSON.parse(readStoredZip(bundle.bytes).get('manifest.json').text);
    expect(parsedFromZip).toEqual(manifest);
  });

  it.runIf(hasPython)('is a valid archive according to Python zipfile, with clean CRCs', () => {
    const directory = mkdtempSync(join(tmpdir(), 'gh-bundle-'));
    const archivePath = join(directory, 'bundle.zip');
    try {
      const bundle = buildWorkflowBundle(diamondProject(), { date: FIXED_DATE });
      writeFileSync(archivePath, bundle.bytes);
      const script = [
        'import json, sys, zipfile',
        'with zipfile.ZipFile(sys.argv[1]) as archive:',
        '    print(json.dumps({"bad": archive.testzip(), "names": archive.namelist(),',
        '                      "manifest": json.loads(archive.read("manifest.json"))}))',
      ].join('\n');
      const result = spawnSync('python3', ['-c', script, archivePath], { encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.bad).toBeNull();
      expect(parsed.names.sort()).toEqual(bundle.entryNames.slice().sort());
      expect(parsed.manifest.dag.edges).toEqual(bundle.manifest.dag.edges);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects an empty project and leaves the export button disabled', () => {
    const empty = createWorkflowProject('Empty project');
    expect(() => buildWorkflowBundle(empty)).toThrow(/at least one calculation task/i);

    const container = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
    const workbench = new WorkflowWorkbench(container, () => null);
    expect(workbench.downloadBundle()).toBe(false);
    expect(workbench.statusMessage).toMatch(/at least one calculation task/i);
    expect(container.innerHTML).toContain('id="workflow-export-bundle"');
    expect(container.innerHTML).toMatch(/id="workflow-export-bundle"[^>]*disabled/);
  });

  it('exports blocked checkpoint-dependent inputs with their %OldChk link', () => {
    const project = diamondProject();
    const downstream = project.tasks.find(task => task.id === 'B');
    downstream.config.route = { method: 'HF', basisSet: '3-21G', jobType: 'Freq Geom=AllCheck Guess=Read' };
    downstream.checkpointFromTaskId = 'A';
    downstream.gates.requireFrequencyRecord = true;
    downstream.gates.requireThermochemistry = true;

    const entries = readStoredZip(buildWorkflowBundle(project, { date: FIXED_DATE }).bytes);
    const input = entries.get('B.gjf').text;
    expect(input).toContain('%OldChk=A.chk');
    expect(input).toContain('%Chk=B.chk');
    expect(entries.get('manifest.json').text).toContain('"checkpointFromTaskId": "A"');
  });

  it('produces the archive through the Workbench download path without marking tasks awaiting output', () => {
    const workbench = new WorkflowWorkbench(
      { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] },
      () => diamondProject().tasks[0].config,
    );
    const task = workbench.addCurrentTask();
    expect(task).not.toBeNull();
    const originalDocument = globalThis.document;
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    let clicks = 0;
    let downloadName = '';
    globalThis.document = {
      createElement: () => ({
        click: () => { clicks++; },
        remove: () => {},
        set href(value) { this._href = value; },
        get href() { return this._href; },
        set download(value) { downloadName = value; },
        get download() { return downloadName; },
      }),
      body: { appendChild: () => {} },
    };
    URL.createObjectURL = () => 'blob:workflow-bundle';
    URL.revokeObjectURL = () => {};
    try {
      expect(workbench.downloadBundle()).toBe(true);
      expect(clicks).toBe(1);
      expect(workbench.project.tasks[0].lastExportedAt).toBeNull();
      expect(workbench.statusMessage).toMatch(/do not validate results/i);
    } finally {
      globalThis.document = originalDocument;
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    }
    expect(downloadName).toMatch(/\.workflow\.zip$/);
  });

  it('does not mutate task state when building a bundle', () => {
    const project = diamondProject();
    const before = JSON.stringify(project);
    buildWorkflowBundle(project, { date: FIXED_DATE });
    expect(JSON.stringify(project)).toBe(before);
  });
});

describe('zip writer guards', () => {
  it('rejects empty archives, duplicate names, and path traversal names', () => {
    expect(() => createZip([])).toThrow(/at least one entry/i);
    expect(() => createZip([{ name: 'a.txt', data: 'a' }, { name: 'a.txt', data: 'b' }])).toThrow(/duplicate/i);
    expect(() => createZip([{ name: '../escape.txt', data: 'x' }])).toThrow(/safe relative path/i);
    expect(() => createZip([{ name: '/absolute.txt', data: 'x' }])).toThrow(/safe relative path/i);
  });
});
