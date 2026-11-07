import { describe, expect, it } from 'vitest';
import {
  BOLTZMANN_TEMPERATURE_K,
  DEFAULT_RMSD_THRESHOLD,
  ENSEMBLE_SPREAD_WARNING_KCAL,
  GAS_CONSTANT_KCAL_PER_MOL_K,
  boltzmannPopulations,
  buildEnsembleWarnings,
  generateConformerEnsemble,
  heavyAtomRmsd,
  normalizeConformerLimit,
} from '../src/utils/conformerEnsemble.js';
import {
  describeEnsembleSpread,
  validateConformerMetadata,
} from '../src/utils/conformerMetadata.js';
import { generateGJF } from '../src/generators/gjfGenerator.js';
import {
  createWorkflowProject,
  createWorkflowTask,
  parseWorkflowProjectJson,
  serializeWorkflowProject,
  validateWorkflowProject,
} from '../src/utils/workflowModel.js';
import { buildTaskInputText } from '../src/utils/workflowInput.js';
import { WorkflowWorkbench } from '../src/components/WorkflowWorkbench.js';

let butaneCache = null;

/** Butane is the canonical flexible-molecule smoke test; generate it once. */
function butane(options = {}) {
  if (!butaneCache) butaneCache = generateConformerEnsemble('CCCC', { count: 10, ...options });
  return butaneCache;
}

function baseConfig(atoms) {
  return {
    link0: { memory: '4GB', nproc: '4', checkpoint: 'butane.chk' },
    route: { verbosity: '#N', method: 'B3LYP', basisSet: '6-31G(d)', jobType: 'Opt' },
    title: 'Butane conformer',
    charge: 0,
    multiplicity: 1,
    atoms,
  };
}

function makeContainer(overrides = {}) {
  return {
    innerHTML: '',
    querySelector: (selector) => overrides[selector] ?? null,
    querySelectorAll: () => [],
  };
}

function rotateAndTranslate(atoms, angle, shift) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return atoms.map((atom) => ({
    symbol: atom.symbol,
    x: cos * atom.x - sin * atom.y + shift.x,
    y: sin * atom.x + cos * atom.y + shift.y,
    z: atom.z + shift.z,
  }));
}

describe('conformer ensemble: butane', () => {
  it('yields several distinct conformers with a population table that sums to one', () => {
    const ensemble = butane();

    expect(ensemble.method).toBe('MMFF94');
    expect(ensemble.generatedCount).toBeGreaterThanOrEqual(2);
    expect(ensemble.retainedCount).toBeGreaterThanOrEqual(2);
    expect(ensemble.retainedCount).toBeLessThanOrEqual(ensemble.generatedCount);
    expect(ensemble.conformers).toHaveLength(ensemble.retainedCount);

    const populations = ensemble.conformers.map(conformer => conformer.population);
    expect(populations.every(value => typeof value === 'number' && value > 0 && value <= 1)).toBe(true);
    const sum = populations.reduce((total, value) => total + value, 0);
    expect(sum).toBeCloseTo(1, 9);

    // Retained conformers are genuinely different geometries.
    for (let i = 0; i < ensemble.conformers.length; i += 1) {
      for (let j = i + 1; j < ensemble.conformers.length; j += 1) {
        expect(heavyAtomRmsd(ensemble.conformers[i].atoms, ensemble.conformers[j].atoms))
          .toBeGreaterThan(DEFAULT_RMSD_THRESHOLD);
      }
    }

    // Provenance metadata mirrors the ranking.
    ensemble.conformers.forEach((conformer, index) => {
      expect(conformer.index).toBe(index);
      expect(conformer.metadata).toEqual({
        index,
        energyKcal: conformer.energyKcal,
        relativeKcal: conformer.relativeKcal,
        population: conformer.population,
        ensembleSpreadKcal: ensemble.spreadKcal,
        method: 'MMFF94',
        generatedCount: ensemble.generatedCount,
        retainedCount: ensemble.retainedCount,
      });
      expect(validateConformerMetadata(conformer.metadata)).toEqual([]);
    });
  });

  it('uses real MMFF94 energies, sorted ascending, with relative energies from the minimum', () => {
    const ensemble = butane();
    const energies = ensemble.conformers.map(conformer => conformer.energyKcal);

    expect(energies.every(Number.isFinite)).toBe(true);
    expect(energies).toEqual([...energies].sort((a, b) => a - b));
    expect(ensemble.conformers[0].relativeKcal).toBeCloseTo(0, 12);

    const lowest = Math.min(...energies);
    ensemble.conformers.forEach((conformer) => {
      expect(conformer.relativeKcal).toBeCloseTo(conformer.energyKcal - lowest, 10);
      // A force-field energy is a handful of kcal/mol for butane; this guards
      // against a fabricated or uninitialised value without hard-coding one.
      expect(Math.abs(conformer.energyKcal)).toBeLessThan(100);
    });

    expect(ensemble.spreadKcal).toBeCloseTo(Math.max(...energies) - lowest, 10);
    expect(ensemble.spreadKcal).toBeGreaterThan(0);

    // Boltzmann weights follow exp(-ΔE/RT); check the ratio directly.
    const kT = GAS_CONSTANT_KCAL_PER_MOL_K * BOLTZMANN_TEMPERATURE_K;
    for (let i = 1; i < ensemble.conformers.length; i += 1) {
      const expectedRatio = Math.exp(-(energies[i] - lowest) / kT);
      const actualRatio = ensemble.conformers[i].population / ensemble.conformers[0].population;
      expect(actualRatio).toBeCloseTo(expectedRatio, 9);
    }
  });

  it('superimposes conformers before measuring RMSD', () => {
    const conformer = butane().conformers[0];
    const moved = rotateAndTranslate(conformer.atoms, 0.7, { x: 3, y: -2, z: 1.5 });
    expect(heavyAtomRmsd(conformer.atoms, moved)).toBeLessThan(1e-6);
    expect(heavyAtomRmsd(conformer.atoms, conformer.atoms)).toBe(0);
  });

  it('prunes duplicate geometries by the heavy-atom RMSD threshold', () => {
    const loose = generateConformerEnsemble('CCCC', { count: 10, rmsdThreshold: 50 });
    expect(loose.retainedCount).toBe(1);
    expect(loose.generatedCount).toBeGreaterThan(1);

    const strict = generateConformerEnsemble('CCCC', { count: 10, rmsdThreshold: 0.01 });
    expect(strict.retainedCount).toBeGreaterThanOrEqual(butane().retainedCount);
    expect(strict.conformers.length).toBe(strict.retainedCount);
  });
});

describe('conformer ensemble: warnings and rigid molecules', () => {
  it('warns only above the 2 kcal/mol spread threshold', () => {
    expect(describeEnsembleSpread(ENSEMBLE_SPREAD_WARNING_KCAL)).toBeNull();
    expect(describeEnsembleSpread(1.2)).toBeNull();
    expect(describeEnsembleSpread(2.4))
      .toBe('ensemble spread 2.40 kcal/mol — the reported value depends on conformer choice');
    expect(describeEnsembleSpread(null)).toBeNull();

    expect(buildEnsembleWarnings({ spreadKcal: 2.5, energyFailures: 0, generatedCount: 4 }))
      .toEqual([expect.stringContaining('ensemble spread 2.50 kcal/mol')]);
    expect(buildEnsembleWarnings({ spreadKcal: 1.5, energyFailures: 0, generatedCount: 4 }))
      .toEqual([]);
  });

  it('raises the spread warning for a real flexible molecule', () => {
    const hexane = generateConformerEnsemble('CCCCCC', { count: 6 });
    expect(hexane.spreadKcal).toBeGreaterThan(ENSEMBLE_SPREAD_WARNING_KCAL);
    expect(hexane.warnings).toContainEqual(
      expect.stringMatching(/^ensemble spread \d+\.\d{2} kcal\/mol — the reported value depends on conformer choice$/),
    );
    expect(hexane.warnings).toContainEqual(expect.stringContaining('depends on conformer choice'));
  });

  it('returns a single ranked conformer for rigid molecules', () => {
    const water = generateConformerEnsemble('O', { count: 8 });
    expect(water.retainedCount).toBe(1);
    expect(water.generatedCount).toBe(1);
    expect(water.spreadKcal).toBe(0);
    expect(water.conformers[0].population).toBe(1);
    expect(water.conformers[0].relativeKcal).toBe(0);
    expect(water.warnings).toEqual([]);

    const benzene = generateConformerEnsemble('c1ccccc1', { count: 8 });
    expect(benzene.retainedCount).toBe(1);
  });

  it('clamps the requested conformer count to the supported range', () => {
    expect(normalizeConformerLimit(0)).toBe(1);
    expect(normalizeConformerLimit(3.9)).toBe(3);
    expect(normalizeConformerLimit(500)).toBe(50);
    expect(normalizeConformerLimit('nonsense')).toBe(10);
    expect(generateConformerEnsemble('CCCC', { count: 500 }).requestedCount).toBe(50);
  });
});

describe('conformer ensemble: unavailable energies', () => {
  it('reports null energies and no populations when MMFF94 cannot type the molecule', () => {
    const platinum = generateConformerEnsemble('[Pt]', { count: 4 });

    expect(platinum.conformers.length).toBeGreaterThan(0);
    expect(platinum.energyAvailable).toBe(false);
    expect(platinum.spreadKcal).toBeNull();
    for (const conformer of platinum.conformers) {
      expect(conformer.energyKcal).toBeNull();
      expect(conformer.relativeKcal).toBeNull();
      expect(conformer.population).toBeNull();
      expect(conformer.metadata.energyKcal).toBeNull();
      expect(conformer.metadata.population).toBeNull();
      expect(conformer.metadata.ensembleSpreadKcal).toBeNull();
    }
    expect(platinum.warnings.join(' ')).toMatch(/MMFF94 energy is unavailable/);
    expect(platinum.warnings.join(' ')).not.toMatch(/\d+\.\d+ kcal\/mol — the reported value/);
  });

  it('never reports a population for a conformer whose energy failed', () => {
    // An injected minimiser keeps this deterministic: the real API throws for
    // unsupported elements, but which element is unsupported is a table detail.
    let call = 0;
    const ensemble = generateConformerEnsemble('CCCC', {
      count: 4,
      rmsdThreshold: 0,
      energyFn: () => {
        call += 1;
        return call === 2
          ? { energyKcal: null, reason: 'MMFF94 energy unavailable: test element' }
          : { energyKcal: -2 - call, reason: null };
      },
    });
    expect(ensemble.energyAvailable).toBe(false);
    expect(ensemble.conformers.every(conformer => conformer.population === null)).toBe(true);
    expect(ensemble.conformers.every(conformer => conformer.relativeKcal === null)).toBe(true);
    expect(ensemble.warnings[0]).toBe('MMFF94 energy unavailable: test element');
    expect(ensemble.warnings.join(' ')).toMatch(/populations and relative energies are not reported/);
  });

  it('withholds the whole population table rather than normalising partial energies', () => {
    expect(boltzmannPopulations([0, null, 1])).toEqual([null, null, null]);
    expect(boltzmannPopulations([])).toEqual([]);
  });
});

describe('conformer provenance in the workflow', () => {
  it('records the chosen conformer without changing the generated .gjf', () => {
    const conformer = butane().conformers[1];
    const config = baseConfig(conformer.atoms.map(atom => ({ ...atom })));
    const withoutMetadata = generateGJF(config);
    const withMetadata = generateGJF({ ...config, conformer: conformer.metadata });

    expect(withMetadata).toBe(withoutMetadata);
    expect(withoutMetadata).toContain('Butane conformer');
  });

  it('keeps task input byte-identical with and without provenance', () => {
    const conformer = butane().conformers[0];
    const config = baseConfig(conformer.atoms.map(atom => ({ ...atom })));
    const plain = createWorkflowTask(config, { id: 'task-plain', inputName: 'plain.gjf', outputName: 'plain.log' });
    const ranked = createWorkflowTask(
      { ...config, conformer: conformer.metadata },
      { id: 'task-ranked', inputName: 'ranked.gjf', outputName: 'ranked.log' },
    );

    const plainProject = { ...createWorkflowProject('plain'), tasks: [plain] };
    const rankedProject = { ...createWorkflowProject('ranked'), tasks: [ranked] };
    expect(buildTaskInputText(rankedProject, ranked.id)).toBe(buildTaskInputText(plainProject, plain.id));
    expect(ranked.config.conformer).toEqual(conformer.metadata);
  });

  it('round-trips the chosen conformer through a saved project and drops unknown fields', () => {
    const conformer = butane().conformers[0];
    const config = {
      ...baseConfig(conformer.atoms.map(atom => ({ ...atom }))),
      conformer: { ...conformer.metadata, rawLogText: 'PRIVATE_SENTINEL' },
    };
    const project = createWorkflowProject('Butane');
    project.tasks.push(createWorkflowTask(config, {
      id: 'task-butane',
      inputName: 'butane.gjf',
      outputName: 'butane.log',
    }));

    const json = serializeWorkflowProject(project);
    expect(json).not.toContain('PRIVATE_SENTINEL');
    expect(json).not.toContain('rawLogText');

    const imported = parseWorkflowProjectJson(json);
    expect(imported.tasks[0].config.conformer).toEqual(conformer.metadata);
  });

  it('rejects unbounded or self-inconsistent provenance', () => {
    const conformer = butane().conformers[0];
    const valid = conformer.metadata;
    const make = (patch) => () => createWorkflowTask(
      { ...baseConfig(conformer.atoms.map(atom => ({ ...atom }))), conformer: { ...valid, ...patch } },
      { id: 'task-bad', inputName: 'bad.gjf', outputName: 'bad.log' },
    );

    expect(make({ population: 1.5 })).toThrow(/conformer provenance/i);
    expect(make({ energyKcal: Number.POSITIVE_INFINITY })).toThrow(/conformer provenance/i);
    expect(make({ retainedCount: 6, generatedCount: 5 })).toThrow(/conformer provenance/i);
    expect(make({ index: 99 })).toThrow(/conformer provenance/i);
    expect(make({ method: 'UFF' })).toThrow(/conformer provenance/i);
    expect(make({ energyKcal: null, population: 0.4 })).toThrow(/conformer provenance/i);

    // A forged block is also visible to project-level validation.
    const task = createWorkflowTask(
      { ...baseConfig(conformer.atoms.map(atom => ({ ...atom }))), conformer: valid },
      { id: 'task-forged', inputName: 'forged.gjf', outputName: 'forged.log' },
    );
    task.config.conformer = { ...valid, population: 2 };
    const project = { ...createWorkflowProject('forged'), tasks: [task] };
    const validation = validateWorkflowProject(project);
    expect(validation.valid).toBe(false);
    expect(validation.errors.join(' ')).toMatch(/conformer provenance/);
  });
});

describe('workflow workbench: queue top-k conformers', () => {
  it('creates one task per retained conformer sharing the same dependencies', () => {
    const ensemble = butane();
    const config = baseConfig(ensemble.conformers[0].atoms.map(atom => ({ ...atom })));
    const sourceContainer = makeContainer();
    const sourceWorkbench = new WorkflowWorkbench(sourceContainer, () => config, () => ensemble);
    const source = sourceWorkbench.addCurrentTask();
    expect(source).not.toBeNull();

    const container = makeContainer({
      '#workflow-new-dependencies': { selectedOptions: [{ value: source.id }] },
      '#workflow-new-checkpoint': { value: '' },
    });
    const workbench = new WorkflowWorkbench(container, () => config, () => ensemble);
    workbench.project = sourceWorkbench.project;

    const created = workbench.queueConformerTasks(2);
    expect(created).toHaveLength(2);
    expect(workbench.project.tasks).toHaveLength(3);
    expect(validateWorkflowProject(workbench.project).valid).toBe(true);

    created.forEach((task, index) => {
      expect(task.dependencies).toEqual([source.id]);
      expect(task.config.conformer).toEqual(ensemble.conformers[index].metadata);
      expect(task.config.atoms).toEqual(ensemble.conformers[index].atoms);
      expect(task.title).toContain(`conformer ${index + 1}`);
    });
    expect(new Set(created.map(task => task.inputName)).size).toBe(created.length);
    expect(new Set(created.map(task => task.config.link0.checkpoint)).size).toBe(created.length);

    // Each queued task exports its own geometry, and the metadata does not
    // appear in the Gaussian input text.
    const firstInput = buildTaskInputText(workbench.project, created[0].id, { requireReady: false });
    const secondInput = buildTaskInputText(workbench.project, created[1].id, { requireReady: false });
    expect(firstInput).not.toBe(secondInput);
    expect(firstInput).not.toMatch(/ensembleSpread|energyKcal|relativeKcal|MMFF94/);
    expect(firstInput).toBe(generateGJF({ ...created[0].config, conformer: undefined }));
  });

  it('refuses to queue when no ensemble has been generated', () => {
    const config = baseConfig([{ symbol: 'O', x: 0, y: 0, z: 0 }]);
    const workbench = new WorkflowWorkbench(makeContainer(), () => config, () => null);
    expect(workbench.queueConformerTasks(2)).toEqual([]);
    expect(workbench.project.tasks).toHaveLength(0);
    expect(workbench.statusMessage).toMatch(/generate a conformer ensemble/i);
  });

  it('caps the queue at the retained conformers and at ten siblings', () => {
    const ensemble = butane();
    const config = baseConfig(ensemble.conformers[0].atoms.map(atom => ({ ...atom })));
    const workbench = new WorkflowWorkbench(makeContainer(), () => config, () => ensemble);
    const created = workbench.queueConformerTasks(9);
    expect(created).toHaveLength(Math.min(10, ensemble.conformers.length));
  });
});
