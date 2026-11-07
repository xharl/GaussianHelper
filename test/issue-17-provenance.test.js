import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { generateGJF } from '../src/generators/gjfGenerator.js';
import {
  APP_COMMIT,
  APP_VERSION,
  PROVENANCE_SCHEMA_VERSION,
  PROVENANCE_SUFFIX,
  TAUTOMER_NOTE,
  buildProvenanceRecord,
  buildProvenanceRecordSync,
  createCompactProvenance,
  normalizeCompactProvenance,
  resolveAppCommit,
  sha256Hex,
  sha256HexSync,
  stringifyProvenanceRecord,
  validateCompactProvenance,
  validateProvenanceRecord,
} from '../src/utils/provenance.js';
import { buildWorkflowBundle } from '../src/utils/bundleExport.js';
import {
  buildTaskInputText,
  buildTaskProvenanceRecord,
  taskProvenanceContext,
} from '../src/utils/workflowInput.js';
import {
  createWorkflowProject,
  createWorkflowTask,
  invalidateTaskAndDescendants,
  parseWorkflowProjectJson,
  serializeWorkflowProject,
  validateWorkflowProject,
} from '../src/utils/workflowModel.js';
import { WorkflowWorkbench } from '../src/components/WorkflowWorkbench.js';

const FIXED_DATE = new Date('2026-11-07T12:34:56.000Z');
const LATER_DATE = new Date('2027-01-02T03:04:05.000Z');
const ETHANOL_ATOMS = [
  { symbol: 'C', x: 0, y: 0, z: 0 },
  { symbol: 'C', x: 1.5, y: 0, z: 0 },
  { symbol: 'O', x: 2.9, y: 0, z: 0 },
  { symbol: 'H', x: -0.5, y: 1, z: 0 },
  { symbol: 'H', x: -0.5, y: -1, z: 0 },
  { symbol: 'H', x: -0.5, y: 0, z: 1 },
  { symbol: 'H', x: 1.5, y: 1, z: 0 },
  { symbol: 'H', x: 1.5, y: -1, z: 0 },
  { symbol: 'H', x: 1.5, y: 0, z: 1 },
];

function ethanolConfig(overrides = {}) {
  return {
    link0: { memory: '8GB', nproc: 4, checkpoint: 'ethanol.chk' },
    route: {
      verbosity: '#N',
      method: 'B3LYP',
      basisSet: '6-31G(d)',
      jobType: 'Opt Freq',
      scf: 'SCF=Tight',
      grid: 'Integral=UltraFine',
      dispersion: 'EmpiricalDispersion=GD3BJ',
      solvation: 'SCRF=(SMD,Solvent=Water)',
      pop: 'Pop=Full',
      custom: 'MaxDisk=20GB',
    },
    title: 'Ethanol',
    charge: 0,
    multiplicity: 1,
    atoms: ETHANOL_ATOMS.map(atom => ({ ...atom })),
    ...overrides,
  };
}

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
      requireFinalEnergy: false,
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

function digest(text) {
  return createHash('sha256').update(text).digest('hex');
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
  if (eocd < 0) throw new Error('No ZIP end-of-central-directory record found.');
  const count = view.getUint16(eocd + 10, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const entries = new Map();
  let cursor = centralOffset;
  for (let index = 0; index < count; index++) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error('Bad central directory entry.');
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    entries.set(name, decoder.decode(bytes.subarray(dataStart, dataStart + compressedSize)));
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

describe('provenance record', () => {
  it('contains every required field with values derived from the actual input', async () => {
    const config = ethanolConfig();
    const inputText = generateGJF(config);
    const record = await buildProvenanceRecord(config, {
      inputText,
      inputName: 'ethanol.gjf',
      generatedAt: FIXED_DATE,
      taskId: 'task-ethanol',
      parentTaskIds: ['task-prep'],
      geometrySource: { kind: 'smiles', smiles: 'CCO' },
    });

    expect(validateProvenanceRecord(record)).toEqual([]);
    expect(record.schemaVersion).toBe(PROVENANCE_SCHEMA_VERSION);
    expect(record.app).toEqual({ commit: APP_COMMIT, name: 'gaussian-helper', version: APP_VERSION });
    expect(record.generatedAt).toBe(FIXED_DATE.toISOString());
    expect(record.input).toEqual({ filename: 'ethanol.gjf', sha256: digest(inputText) });
    expect(record.input.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(record.calculation).toEqual({
      basisSet: '6-31G(d)',
      custom: 'MaxDisk=20GB',
      dispersion: 'EmpiricalDispersion=GD3BJ',
      grid: 'Integral=UltraFine',
      jobType: 'Opt Freq',
      method: 'B3LYP',
      pop: 'Pop=Full',
      scf: 'SCF=Tight',
      solvation: 'SCRF=(SMD,Solvent=Water)',
    });
    expect(record.molecule.atomCount).toBe(9);
    expect(record.molecule.hillFormula).toBe('C2H6O');
    expect(record.molecule.charge).toBe(0);
    expect(record.molecule.multiplicity).toBe(1);
    expect(record.molecule.geometrySource).toEqual({ filename: null, kind: 'smiles', note: null, smiles: 'CCO' });
    expect(record.molecule.conformer).toBeNull();
    expect(record.molecule.tautomer).toBeNull();
    expect(record.molecule.protomer).toBeNull();
    expect(record.molecule.tautomerNote).toBe(TAUTOMER_NOTE);
    expect(record.task).toEqual({ id: 'task-ethanol', parentTaskIds: ['task-prep'] });

    // Without an explicit inputText the record hashes generateGJF(config).
    const implicit = await buildProvenanceRecord(config, { generatedAt: FIXED_DATE });
    expect(implicit.input).toEqual({ filename: null, sha256: digest(generateGJF(config)) });
  });

  it('sorts keys recursively and is stable across builds except for the timestamp', async () => {
    const config = ethanolConfig();
    const context = { inputName: 'ethanol.gjf', geometrySource: { kind: 'drawn' }, taskId: 'task-1' };
    const first = await buildProvenanceRecord(config, { ...context, generatedAt: FIXED_DATE });
    const second = await buildProvenanceRecord(config, { ...context, generatedAt: FIXED_DATE });
    const later = await buildProvenanceRecord(config, { ...context, generatedAt: LATER_DATE });

    expect(first).toEqual(second);
    expect(stringifyProvenanceRecord(first)).toBe(stringifyProvenanceRecord(second));
    expect(Object.keys(first)).toEqual(['app', 'calculation', 'generatedAt', 'input', 'molecule', 'schemaVersion', 'task']);
    expect(Object.keys(first.calculation)).toEqual([
      'basisSet', 'custom', 'dispersion', 'grid', 'jobType', 'method', 'pop', 'scf', 'solvation',
    ]);
    expect(Object.keys(first.molecule)).toEqual([
      'atomCount', 'charge', 'conformer', 'geometrySource', 'hillFormula',
      'multiplicity', 'protomer', 'tautomer', 'tautomerNote',
    ].sort());

    const withoutTimestamp = record => ({ ...record, generatedAt: null });
    expect(withoutTimestamp(later)).toEqual(withoutTimestamp(first));
    expect(later.generatedAt).toBe(LATER_DATE.toISOString());
    // Only the generatedAt string differs between the two pretty-printed files.
    expect(stringifyProvenanceRecord(later).replace(LATER_DATE.toISOString(), 'TIMESTAMP'))
      .toBe(stringifyProvenanceRecord(first).replace(FIXED_DATE.toISOString(), 'TIMESTAMP'));
  });

  it('hashes with WebCrypto and the synchronous path identically to node:crypto', async () => {
    const samples = ['', 'a', 'Ethanol', 'line\nbreak', 'ünïcode ✓', 'x'.repeat(1000)];
    for (const sample of samples) {
      expect(sha256HexSync(sample)).toBe(digest(sample));
      expect(await sha256Hex(sample)).toBe(digest(sample));
    }

    const config = ethanolConfig();
    const context = { inputText: generateGJF(config), generatedAt: FIXED_DATE };
    expect(await buildProvenanceRecord(config, context)).toEqual(buildProvenanceRecordSync(config, context));
  });

  it('records every geometry source honestly and infers only checkpoint input', async () => {
    const base = { inputText: generateGJF(ethanolConfig()), generatedAt: FIXED_DATE };
    const drawn = await buildProvenanceRecord(ethanolConfig(), { ...base, geometrySource: { kind: 'drawn' } });
    expect(drawn.molecule.geometrySource.kind).toBe('drawn');

    const fromFile = await buildProvenanceRecord(ethanolConfig(), {
      ...base,
      geometrySource: { kind: 'file', filename: 'ethanol.xyz' },
    });
    expect(fromFile.molecule.geometrySource).toMatchObject({ kind: 'file', filename: 'ethanol.xyz' });

    const checkpointConfig = ethanolConfig({
      route: { method: 'B3LYP', basisSet: '6-31G(d)', jobType: 'Freq Geom=AllCheck Guess=Read' },
    });
    const checkpoint = await buildProvenanceRecord(checkpointConfig, {
      inputText: generateGJF(checkpointConfig),
      generatedAt: FIXED_DATE,
    });
    expect(checkpoint.molecule.geometrySource).toMatchObject({ kind: 'checkpoint', filename: 'ethanol.chk' });

    const unknown = await buildProvenanceRecord(ethanolConfig(), base);
    expect(unknown.molecule.geometrySource.kind).toBe('unknown');
    expect(unknown.molecule.geometrySource.note).toMatch(/not recorded/i);

    await expect(buildProvenanceRecord(ethanolConfig(), {
      ...base,
      geometrySource: { kind: 'file' },
    })).rejects.toThrow(/geometrySource|geometry source/i);
    await expect(buildProvenanceRecord(ethanolConfig(), {
      ...base,
      geometrySource: { kind: 'drawn', filename: '../escape.xyz' },
    })).rejects.toThrow(/geometrySource|geometry source/i);
  });

  it('carries conformer and ensemble data without storing a second geometry', async () => {
    const config = ethanolConfig();
    const conformer = {
      index: 2,
      energyKcal: -12.3456,
      relativeKcal: 0.8,
      population: 0.42,
      ensembleSpreadKcal: 3.1,
      method: 'MMFF94',
      generatedCount: 10,
      retainedCount: 4,
    };
    const record = await buildProvenanceRecord(config, {
      inputText: generateGJF(config),
      generatedAt: FIXED_DATE,
      conformer,
    });
    expect(record.molecule.conformer).toEqual(conformer);
    expect(record.molecule.conformer.atoms).toBeUndefined();

    await expect(buildProvenanceRecord(config, {
      inputText: generateGJF(config),
      generatedAt: FIXED_DATE,
      conformer: { ...conformer, index: 9 },
    })).rejects.toThrow(/conformer/i);
  });

  it('reports zero atoms and no formula for checkpoint-only geometry instead of inventing them', async () => {
    const config = ethanolConfig({ atoms: [] });
    const record = await buildProvenanceRecord(config, {
      inputText: generateGJF(config),
      generatedAt: FIXED_DATE,
    });
    expect(record.molecule.atomCount).toBe(0);
    expect(record.molecule.hillFormula).toBeNull();
  });

  it('falls back to "unknown" when no build-time commit define is present', async () => {
    expect(resolveAppCommit(undefined)).toBe('unknown');
    expect(resolveAppCommit('')).toBe('unknown');
    expect(resolveAppCommit('not-a-sha')).toBe('unknown');
    expect(resolveAppCommit('0bc2c83')).toBe('0bc2c83');
    expect(resolveAppCommit('0BC2C83')).toBe('0bc2c83');
    // Vitest runs source files without Vite's define, so the constant must
    // expose the fallback rather than an empty or invented value.
    expect(APP_COMMIT).toBe('unknown');

    const config = ethanolConfig();
    const record = await buildProvenanceRecord(config, {
      inputText: generateGJF(config),
      generatedAt: FIXED_DATE,
      appCommit: 'abc1234',
    });
    expect(record.app.commit).toBe('abc1234');
  });
});

describe('workflow bundle provenance', () => {
  it('writes one sidecar per task, hashing the exact bytes in the archive, and references it from manifest.json', () => {
    const project = diamondProject();
    const before = JSON.stringify(project);
    const bundle = buildWorkflowBundle(project, { date: FIXED_DATE });
    const entries = readStoredZip(bundle.bytes);

    expect(JSON.stringify(project)).toBe(before);
    expect(bundle.entryNames).toContain(`A.gjf${PROVENANCE_SUFFIX}`);
    expect(bundle.manifest.tasks.map(task => task.provenance)).toEqual(
      ['A', 'B', 'C', 'D', 'E'].map(id => `${id}.gjf${PROVENANCE_SUFFIX}`),
    );

    for (const task of project.tasks) {
      const sidecarName = `${task.inputName}${PROVENANCE_SUFFIX}`;
      const manifestTask = bundle.manifest.tasks.find(item => item.id === task.id);
      expect(manifestTask.provenance).toBe(sidecarName);
      expect(entries.has(sidecarName)).toBe(true);

      const inputText = entries.get(task.inputName);
      const sidecarText = entries.get(sidecarName);
      expect(sidecarText.startsWith('{\n  "app": {')).toBe(true);
      const record = JSON.parse(sidecarText);
      expect(validateProvenanceRecord(record)).toEqual([]);
      expect(record.generatedAt).toBe(FIXED_DATE.toISOString());
      expect(record.input).toEqual({ filename: task.inputName, sha256: digest(inputText) });
      expect(record.task).toEqual({ id: task.id, parentTaskIds: task.dependencies });
      expect(record.app.commit).toBe(APP_COMMIT);
      expect(record.molecule.geometrySource.kind).toBe('unknown');
      expect(inputText).toBe(buildTaskInputText(project, task.id, { requireReady: false }));
    }
  });

  it('hashes checkpoint-dependent inputs after %OldChk is added', () => {
    const project = diamondProject();
    const downstream = project.tasks.find(task => task.id === 'B');
    downstream.config.route = { method: 'HF', basisSet: '3-21G', jobType: 'Freq Geom=AllCheck Guess=Read' };
    downstream.checkpointFromTaskId = 'A';
    downstream.gates.requireFrequencyRecord = true;
    downstream.gates.requireThermochemistry = true;

    const entries = readStoredZip(buildWorkflowBundle(project, { date: FIXED_DATE }).bytes);
    const inputText = entries.get('B.gjf');
    expect(inputText).toContain('%OldChk=A.chk');
    const record = JSON.parse(entries.get(`B.gjf${PROVENANCE_SUFFIX}`));
    expect(record.input.sha256).toBe(digest(inputText));
    expect(record.molecule.geometrySource).toMatchObject({ kind: 'checkpoint', filename: 'B.chk' });
    expect(record.molecule.atomCount).toBe(0);
    expect(record.molecule.hillFormula).toBeNull();
  });

  it('builds the same record through the task helper with an explicit geometry source', () => {
    const project = diamondProject();
    const record = buildTaskProvenanceRecord(project, 'A', {
      inputText: buildTaskInputText(project, 'A', { requireReady: false }),
      generatedAt: FIXED_DATE,
      geometrySource: { kind: 'file', filename: 'A.xyz' },
    });
    expect(record.molecule.geometrySource).toMatchObject({ kind: 'file', filename: 'A.xyz' });
    expect(record.task).toEqual({ id: 'A', parentTaskIds: [] });
    expect(taskProvenanceContext(project, 'A', {
      inputText: 'x',
      geometrySource: { kind: 'drawn' },
    })).toMatchObject({ inputName: 'A.gjf', taskId: 'A', parentTaskIds: [] });
  });
});

describe('project JSON provenance', () => {
  async function projectWithProvenance() {
    const config = ethanolConfig();
    const full = await buildProvenanceRecord(config, {
      inputText: generateGJF(config),
      inputName: 'ethanol.gjf',
      generatedAt: FIXED_DATE,
      geometrySource: { kind: 'smiles', smiles: 'CCO' },
    });
    const project = createWorkflowProject('Provenance project');
    const task = createWorkflowTask(config, {
      id: 'task-ethanol',
      inputName: 'ethanol.gjf',
      outputName: 'ethanol.log',
      provenance: createCompactProvenance(full),
    });
    project.tasks.push(task);
    return { project, compact: task.provenance, full };
  }

  it('round-trips the bounded compact record through save and load', async () => {
    const { project, compact } = await projectWithProvenance();
    expect(compact).toEqual({
      schemaVersion: 1,
      app: { commit: APP_COMMIT, version: APP_VERSION },
      generatedAt: FIXED_DATE.toISOString(),
      geometrySource: { filename: null, kind: 'smiles', note: null, smiles: 'CCO' },
      conformer: null,
      inputSha256: digest(generateGJF(ethanolConfig())),
    });

    const json = serializeWorkflowProject(project);
    const stored = JSON.parse(json).tasks[0].provenance;
    expect(stored).toEqual(compact);
    const imported = parseWorkflowProjectJson(json);
    expect(imported.tasks[0].provenance).toEqual(compact);
    expect(validateWorkflowProject(imported)).toEqual({ valid: true, errors: [] });
  });

  it('tolerates projects without a provenance record', () => {
    const project = createWorkflowProject('Legacy project');
    project.tasks.push(createWorkflowTask(ethanolConfig(), {
      id: 'task-legacy',
      inputName: 'legacy.gjf',
      outputName: 'legacy.log',
    }));
    expect(project.tasks[0].provenance).toBeNull();
    expect(validateWorkflowProject(project).valid).toBe(true);
    const roundTripped = parseWorkflowProjectJson(serializeWorkflowProject(project));
    expect(roundTripped.tasks[0].provenance).toBeNull();
  });

  it('rejects unbounded or malformed provenance records', async () => {
    const { project, compact } = await projectWithProvenance();
    const cases = [
      { ...compact, inputSha256: compact.inputSha256.toUpperCase() },
      { ...compact, inputSha256: 'abc' },
      { ...compact, generatedAt: 'not-a-date' },
      { ...compact, schemaVersion: 2 },
      { ...compact, app: { version: 'x'.repeat(65), commit: 'unknown' } },
      { ...compact, extra: 'x'.repeat(5000) },
      { ...compact, geometrySource: { kind: 'telepathy' } },
      { ...compact, geometrySource: { kind: 'file' } },
      { ...compact, conformer: { index: 99 } },
    ];
    for (const malformed of cases) {
      expect(validateCompactProvenance(malformed).length).toBeGreaterThan(0);
      expect(normalizeCompactProvenance(malformed)).toBeNull();
      const candidate = {
        ...project,
        tasks: [{ ...project.tasks[0], provenance: malformed }],
      };
      const validation = validateWorkflowProject(candidate);
      expect(validation.valid).toBe(false);
      expect(validation.errors.join(' ')).toMatch(/provenance/i);
      expect(() => serializeWorkflowProject(candidate)).toThrow(/provenance/i);
      expect(() => parseWorkflowProjectJson(JSON.stringify(candidate))).toThrow(/provenance/i);
    }
  });

  it('clears a stale record when the task is invalidated', async () => {
    const { project } = await projectWithProvenance();
    const invalidated = invalidateTaskAndDescendants(project, 'task-ethanol');
    expect(invalidated.tasks[0].provenance).toBeNull();
    expect(invalidated.tasks[0].lastExportedAt).toBeNull();
  });
});

describe('workbench provenance display and download', () => {
  function stubContainer() {
    return { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
  }

  function stubDownloads() {
    const downloads = [];
    const blobs = [];
    return {
      downloads,
      blobs,
      install() {
        this.originalDocument = globalThis.document;
        this.originalCreateObjectURL = URL.createObjectURL;
        this.originalRevokeObjectURL = URL.revokeObjectURL;
        globalThis.document = {
          createElement: () => ({
            click: () => {},
            remove: () => {},
            set href(value) { this._href = value; },
            get href() { return this._href; },
            set download(value) { downloads.push(value); this._download = value; },
            get download() { return this._download; },
          }),
          body: { appendChild: () => {} },
        };
        URL.createObjectURL = blob => {
          blobs.push(blob);
          return `blob:provenance-${blobs.length}`;
        };
        URL.revokeObjectURL = () => {};
      },
      restore() {
        globalThis.document = this.originalDocument;
        URL.createObjectURL = this.originalCreateObjectURL;
        URL.revokeObjectURL = this.originalRevokeObjectURL;
      },
    };
  }

  it('downloads the .gjf plus a 2-space sidecar, persists the compact record, and shows it per task', async () => {
    const container = stubContainer();
    const workbench = new WorkflowWorkbench(container, () => ethanolConfig());
    const task = workbench.addCurrentTask();
    expect(task).not.toBeNull();
    expect(workbench.project.tasks[0].provenance).toBeNull();
    expect(container.innerHTML).toContain('Provenance: not recorded yet');
    expect(container.innerHTML).toContain(`${task.inputName}${PROVENANCE_SUFFIX}`);

    const downloads = stubDownloads();
    downloads.install();
    let exported;
    try {
      expect(workbench.downloadTask(task.id)).toBe(true);
      const gjfText = await downloads.blobs[0].text();
      const sidecarText = await downloads.blobs[1].text();
      exported = JSON.parse(sidecarText);

      expect(downloads.downloads).toEqual([task.inputName, `${task.inputName}${PROVENANCE_SUFFIX}`]);
      expect(sidecarText.startsWith('{\n  "app": {')).toBe(true);
      expect(sidecarText.endsWith('}\n')).toBe(true);
      expect(exported.input.sha256).toBe(digest(gjfText));
      expect(exported.input.sha256).toBe(sha256HexSync(gjfText));
      expect(exported.input.filename).toBe(task.inputName);
      expect(exported.task).toEqual({ id: task.id, parentTaskIds: [] });
      expect(exported.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    } finally {
      downloads.restore();
    }

    expect(workbench.project.tasks[0].lastExportedAt).not.toBeNull();
    const compact = workbench.project.tasks[0].provenance;
    expect(validateCompactProvenance(compact)).toEqual([]);
    expect(compact.inputSha256).toBe(exported.input.sha256);
    expect(compact.app).toEqual({ commit: APP_COMMIT, version: APP_VERSION });
    expect(container.innerHTML).toContain('Provenance');
    expect(container.innerHTML).toContain(compact.inputSha256);
    expect(container.innerHTML).toContain(task.inputName);
    expect(container.innerHTML).not.toContain('Provenance: not recorded yet');
  });

  it('escapes stored provenance values instead of injecting markup', () => {
    const container = stubContainer();
    const config = ethanolConfig();
    const project = createWorkflowProject('Escaping project');
    const task = createWorkflowTask(config, {
      id: 'task-escape',
      title: 'Escape',
      inputName: 'escape.gjf',
      outputName: 'escape.log',
      provenance: {
        schemaVersion: 1,
        app: { commit: 'unknown', version: '0.2.0-alpha' },
        generatedAt: FIXED_DATE.toISOString(),
        geometrySource: { kind: 'file', filename: '<img src=x onerror=alert(1)>', note: null },
        conformer: null,
        inputSha256: 'a'.repeat(64),
      },
    });
    project.tasks.push(task);

    const workbench = new WorkflowWorkbench(container, () => config);
    workbench.project = project;
    workbench.render();
    expect(container.innerHTML).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(container.innerHTML).not.toContain('<img src=x');
    expect(container.innerHTML).toContain('a'.repeat(64));
  });
});
