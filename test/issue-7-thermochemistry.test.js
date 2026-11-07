import { describe, expect, it } from 'vitest';
import { parseGaussianLogText } from '../src/parsers/gaussianLogParser.js';
import {
  createWorkflowProject,
  createWorkflowTask,
  parseWorkflowProjectJson,
  serializeWorkflowProject,
  validateWorkflowProject,
} from '../src/utils/workflowModel.js';
import { evaluateWorkflowOutput } from '../src/utils/workflowGates.js';
import { formatGaussianResultsCsv, GaussianOutputInspector } from '../src/components/GaussianOutputInspector.js';

// Synthetic Gaussian 16 Freq output. The electronic energy plus each correction equals the
// matching "Sum of electronic and ..." total, as it does in a real log.
const COMPLETE_FREQ_LOG = [
  ' Entering Gaussian System',
  ' #p B3LYP/6-31G(d) Freq',
  '',
  ' SCF Done:  E(RB3LYP) =  -76.4081234567     A.U. after   10 cycles',
  ' Frequencies --   1600.1234  3700.5678  3800.9012',
  '',
  ' -------------------',
  ' - Thermochemistry -',
  ' -------------------',
  ' Temperature   298.150 Kelvin.  Pressure   1.00000 Atm.',
  ' Zero-point correction=                           0.021234 (Hartree/Particle)',
  ' Thermal correction to Energy=                    0.024056',
  ' Thermal correction to Enthalpy=                  0.025000',
  ' Thermal correction to Gibbs Free Energy=        -0.001234',
  ' Sum of electronic and zero-point Energies=           -76.386889',
  ' Sum of electronic and thermal Energies=              -76.384067',
  ' Sum of electronic and thermal Enthalpies=            -76.383123',
  ' Sum of electronic and thermal Free Energies=         -76.409357',
  '',
  ' Normal termination of Gaussian 16 at Fri Nov  6 18:00:00 2026.',
].join('\n');

function freqTask(id = 'freq-job', overrides = {}) {
  return createWorkflowTask({
    link0: { checkpoint: `${id}.chk` },
    route: { method: 'B3LYP', basisSet: '6-31G(d)', jobType: 'Freq' },
    title: `${id} frequency calculation`,
    charge: 0,
    multiplicity: 1,
    atoms: [{ symbol: 'O', x: 0, y: 0, z: 0 }, { symbol: 'H', x: 0, y: 1, z: 0 }, { symbol: 'H', x: 0, y: -1, z: 0 }],
    ...overrides,
  }, { id, inputName: `${id}.gjf`, outputName: `${id}.log` });
}

function projectWithParsedAttempt(id = 'freq-job') {
  const parsed = parseGaussianLogText(COMPLETE_FREQ_LOG, `${id}.log`);
  const project = createWorkflowProject('Thermochemistry workflow');
  const task = freqTask(id);
  task.attempts.push({
    id: `${id}-attempt-1`,
    outputFilename: `${id}.log`,
    importedAt: '2026-11-06T00:00:00.000Z',
    overall: 'unknown',
    gates: [],
    summary: { status: 'completed', sectionIndex: 1 },
    parsedSection: parsed.sections[0],
  });
  task.activeAttemptId = `${id}-attempt-1`;
  project.tasks.push(task);
  return project;
}

describe('Gaussian thermochemistry parsing', () => {
  it('extracts ZPE, thermal corrections, H/G totals, and conditions from a complete Freq log', () => {
    const result = parseGaussianLogText(COMPLETE_FREQ_LOG, 'water-freq.log');
    const [section] = result.sections;

    expect(section.thermochemistry.zeroPointHartree).toBeCloseTo(0.021234, 9);
    expect(section.thermochemistry.thermalCorrectionHartree).toMatchObject({
      energy: expect.closeTo(0.024056, 9),
      enthalpy: expect.closeTo(0.025, 9),
      gibbs: expect.closeTo(-0.001234, 9),
    });
    expect(section.thermochemistry.totalsHartree.zpe).toBeCloseTo(-76.386889, 9);
    expect(section.thermochemistry.totalsHartree.energy).toBeCloseTo(-76.384067, 9);
    expect(section.thermochemistry.totalsHartree.enthalpy).toBeCloseTo(-76.383123, 9);
    expect(section.thermochemistry.totalsHartree.gibbs).toBeCloseTo(-76.409357, 9);
    expect(section.thermochemistry.temperatureK).toBeCloseTo(298.15, 9);
    expect(section.thermochemistry.pressureAtm).toBeCloseTo(1, 9);
    expect(section.thermochemistry.failure).toBeNull();
    // The free-energy total is the last thermochemistry line and therefore the evidence anchor.
    expect(section.thermochemistry.line).toBe(18);
    expect(section.thermochemistry.evidence).toContain('Sum of electronic and thermal Free Energies');
  });

  it('accepts D exponents and temperature/pressure split across two lines', () => {
    const text = [
      ' Temperature   298.150 Kelvin.',
      ' Pressure   1.00000 Atm.',
      ' Thermal correction to Energy=                    2.4056D-02',
      ' Sum of electronic and zero-point Energies=     -7.6386889D+01',
      ' Sum of electronic and thermal Free Energies=   -7.6409357D+01',
      ' Normal termination of Gaussian 16',
    ].join('\n');
    const [section] = parseGaussianLogText(text, 'd-exponent.log').sections;

    expect(section.thermochemistry.temperatureK).toBeCloseTo(298.15, 9);
    expect(section.thermochemistry.pressureAtm).toBeCloseTo(1, 9);
    expect(section.thermochemistry.thermalCorrectionHartree.energy).toBeCloseTo(0.024056, 9);
    expect(section.thermochemistry.totalsHartree.zpe).toBeCloseTo(-76.386889, 9);
    expect(section.thermochemistry.totalsHartree.gibbs).toBeCloseTo(-76.409357, 9);
  });

  it('keeps missing totals null on a truncated log instead of inventing values', () => {
    const truncated = [
      ' SCF Done:  E(RB3LYP) =  -76.4081234567     A.U. after   10 cycles',
      ' Frequencies --   1600.1234  3700.5678',
      ' Temperature   298.150 Kelvin.  Pressure   1.00000 Atm.',
      ' Zero-point correction=                           0.021234 (Hartree/Particle)',
      ' Thermal correction to Energy=                    0.024056',
      ' Normal termination of Gaussian 16 at Fri Nov  6 18:00:00 2026.',
    ].join('\n');
    const [section] = parseGaussianLogText(truncated, 'truncated.log').sections;

    expect(section.status).toBe('completed');
    expect(section.thermochemistry.zeroPointHartree).toBeCloseTo(0.021234, 9);
    expect(section.thermochemistry.thermalCorrectionHartree.energy).toBeCloseTo(0.024056, 9);
    expect(section.thermochemistry.thermalCorrectionHartree.gibbs).toBeNull();
    expect(section.thermochemistry.totalsHartree.zpe).toBeNull();
    expect(section.thermochemistry.totalsHartree.enthalpy).toBeNull();
    expect(section.thermochemistry.totalsHartree.gibbs).toBeNull();

    const failedGate = evaluateWorkflowOutput(
      { gates: { requireThermochemistry: true, requireScfRecord: false } },
      section,
    );
    expect(failedGate.gates.find(gate => gate.name === 'Thermochemistry')).toMatchObject({ result: 'unknown', required: true });
  });

  it('keeps per-section values separate when a log contains two Freq sections', () => {
    const secondSection = [
      ' SCF Done:  E(RB3LYP) =  -76.5000000000     A.U. after   8 cycles',
      ' Frequencies --   1500.0000  3600.0000',
      ' Temperature   310.000 Kelvin.  Pressure   1.50000 Atm.',
      ' Zero-point correction=                           0.020000 (Hartree/Particle)',
      ' Thermal correction to Energy=                    0.023000',
      ' Thermal correction to Enthalpy=                  0.024000',
      ' Thermal correction to Gibbs Free Energy=        -0.002000',
      ' Sum of electronic and zero-point Energies=           -76.480000',
      ' Sum of electronic and thermal Energies=              -76.477000',
      ' Sum of electronic and thermal Enthalpies=            -76.476000',
      ' Sum of electronic and thermal Free Energies=         -76.502000',
      ' Normal termination of Gaussian 16 at Fri Nov  6 18:05:00 2026.',
    ].join('\n');
    const result = parseGaussianLogText(`${COMPLETE_FREQ_LOG}\n${secondSection}`, 'two-freq.log');

    expect(result.sections).toHaveLength(2);
    const [first, second] = result.sections;
    expect(first.thermochemistry.totalsHartree.gibbs).toBeCloseTo(-76.409357, 9);
    expect(second.thermochemistry.totalsHartree.gibbs).toBeCloseTo(-76.502, 9);
    expect(second.thermochemistry.totalsHartree.zpe).toBeCloseTo(-76.48, 9);
    expect(second.thermochemistry.temperatureK).toBeCloseTo(310, 9);
    expect(second.thermochemistry.pressureAtm).toBeCloseTo(1.5, 9);
    expect(second.thermochemistry.line).not.toBe(first.thermochemistry.line);
    expect(second.thermochemistry.evidence).toContain('-76.502000');

    const thirdSection = [
      ' SCF Done:  E(RHF) =  -76.4000000000     A.U.',
      ' Normal termination of Gaussian 16',
    ].join('\n');
    const [firstOfThree, , third] = parseGaussianLogText(
      `${COMPLETE_FREQ_LOG}\n${secondSection}\n${thirdSection}`,
      'three-sections.log',
    ).sections;
    expect(firstOfThree.thermochemistry.totalsHartree.gibbs).toBeCloseTo(-76.409357, 9);
    expect(third.thermochemistry).toMatchObject({
      zeroPointHartree: null,
      temperatureK: null,
      pressureAtm: null,
      line: null,
      evidence: null,
      failure: null,
    });
    expect(third.thermochemistry.totalsHartree).toEqual({ zpe: null, energy: null, enthalpy: null, gibbs: null });
  });

  it('does not let a later link inherit thermochemistry from an unterminated prior link', () => {
    const text = [
      ' Sum of electronic and thermal Free Energies=         -76.409357',
      ' --Link1--',
      ' SCF Done:  E(RHF) =  -76.4000000000     A.U.',
      ' Normal termination of Gaussian 16',
    ].join('\n');
    const [section] = parseGaussianLogText(text, 'link1.log').sections;

    expect(section.thermochemistry.totalsHartree.gibbs).toBeNull();
    expect(section.thermochemistry.evidence).toBeNull();
  });

  it('records explicit thermochemistry failure evidence', () => {
    const text = [
      ' SCF Done:  E(RHF) =  -76.4000000000     A.U.',
      ' Frequencies --   100.0  200.0',
      ' Thermochemistry failed: no valid frequencies were available.',
      ' Normal termination of Gaussian 16',
    ].join('\n');
    const [section] = parseGaussianLogText(text, 'thermo-failure.log').sections;

    expect(section.thermochemistry.failure).toMatchObject({ line: 3 });
    expect(section.thermochemistry.failure.evidence).toContain('Thermochemistry failed');
  });
});

describe('requireThermochemistry workflow gate', () => {
  function task(gates = {}) {
    return {
      gates: {
        requireNormalTermination: true,
        requireScfRecord: false,
        requireOptimizationComplete: false,
        requireFrequencyRecord: true,
        requireThermochemistry: true,
        expectedImaginaryModes: null,
        ...gates,
      },
    };
  }

  const section = parseGaussianLogText(COMPLETE_FREQ_LOG, 'freq.log').sections[0];

  it('defaults to required for Freq routes and optional elsewhere', () => {
    expect(freqTask().gates.requireThermochemistry).toBe(true);
    const singlePoint = createWorkflowTask({
      link0: { checkpoint: 'sp.chk' },
      route: { method: 'HF', basisSet: '3-21G', jobType: 'SP' },
      title: 'Single point',
      charge: 0,
      multiplicity: 1,
      atoms: [{ symbol: 'H', x: 0, y: 0, z: 0 }],
    });
    expect(singlePoint.gates.requireThermochemistry).toBe(false);
  });

  it('passes only when the ZPE, enthalpy, and Gibbs totals are all present', () => {
    const result = evaluateWorkflowOutput(task(), section);
    expect(result.overall).toBe('pass');
    expect(result.gates.find(gate => gate.name === 'Thermochemistry'))
      .toMatchObject({ result: 'pass', required: true, line: 18 });
  });

  it('returns unknown, never pass, when the thermochemistry block is missing', () => {
    const result = evaluateWorkflowOutput(task(), section);
    expect(result.overall).toBe('pass');

    const withoutThermochemistry = { ...section, thermochemistry: undefined };
    const missing = evaluateWorkflowOutput(task(), withoutThermochemistry);
    expect(missing.overall).toBe('unknown');
    expect(missing.gates.find(gate => gate.name === 'Thermochemistry'))
      .toMatchObject({ result: 'unknown', required: true, line: null });
  });

  it('fails when the log explicitly reports a thermochemistry failure', () => {
    const failure = parseGaussianLogText([
      ' SCF Done:  E(RHF) =  -76.4000000000     A.U.',
      ' Frequencies --   100.0  200.0',
      ' Thermochemistry failed: no valid frequencies were available.',
      ' Normal termination of Gaussian 16',
    ].join('\n'), 'thermo-failure.log').sections[0];

    const result = evaluateWorkflowOutput(task(), failure);
    expect(result.overall).toBe('fail');
    expect(result.gates.find(gate => gate.name === 'Thermochemistry'))
      .toMatchObject({ result: 'fail', line: 3 });
  });
});

describe('thermochemistry project persistence', () => {
  it('round-trips the parsed values and re-derives a passing verdict on load', () => {
    const project = projectWithParsedAttempt();
    const json = serializeWorkflowProject(project);
    const loaded = parseWorkflowProjectJson(json);
    const attempt = loaded.tasks[0].attempts[0];
    const thermochemistry = attempt.parsedSection.thermochemistry;

    expect(thermochemistry.totalsHartree.zpe).toBeCloseTo(-76.386889, 9);
    expect(thermochemistry.totalsHartree.enthalpy).toBeCloseTo(-76.383123, 9);
    expect(thermochemistry.totalsHartree.gibbs).toBeCloseTo(-76.409357, 9);
    expect(thermochemistry.temperatureK).toBeCloseTo(298.15, 9);
    expect(thermochemistry.pressureAtm).toBeCloseTo(1, 9);
    expect(thermochemistry.evidence).toContain('Sum of electronic and thermal Free Energies');
    expect(attempt.overall).toBe('pass');
    expect(attempt.gates.find(gate => gate.name === 'Thermochemistry'))
      .toMatchObject({ result: 'pass', required: true });
  });

  it('re-validates stored values and rejects malformed or unbounded thermochemistry evidence', () => {
    const tamperedTemperature = projectWithParsedAttempt();
    tamperedTemperature.tasks[0].attempts[0].parsedSection.thermochemistry.temperatureK = 'warm';
    expect(() => parseWorkflowProjectJson(JSON.stringify(tamperedTemperature)))
      .toThrow(/parsed section evidence/i);

    const oversizedEvidence = projectWithParsedAttempt();
    oversizedEvidence.tasks[0].attempts[0].parsedSection.thermochemistry.evidence = 'x'.repeat(301);
    expect(() => parseWorkflowProjectJson(JSON.stringify(oversizedEvidence)))
      .toThrow(/parsed section evidence/i);

    const nonFiniteTotal = projectWithParsedAttempt();
    nonFiniteTotal.tasks[0].attempts[0].parsedSection.thermochemistry.totalsHartree.gibbs = null;
    nonFiniteTotal.tasks[0].attempts[0].overall = 'pass';
    expect(parseWorkflowProjectJson(JSON.stringify(nonFiniteTotal)).tasks[0].attempts[0].overall)
      .toBe('unknown');
  });

  it('rejects an explicit false thermochemistry gate on a Freq route', () => {
    const project = createWorkflowProject('Thermochemistry gate validation');
    const task = freqTask();
    task.gates.requireThermochemistry = false;
    project.tasks.push(task);
    const result = validateWorkflowProject(project);

    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/Freq route requires the thermochemistry gate/i);
  });

  it('normalizes a pre-gate project file that omits requireThermochemistry', () => {
    const project = projectWithParsedAttempt();
    delete project.tasks[0].gates.requireThermochemistry;
    expect(validateWorkflowProject(project)).toEqual({ valid: true, errors: [] });

    const loaded = parseWorkflowProjectJson(serializeWorkflowProject(project));
    expect(loaded.tasks[0].gates.requireThermochemistry).toBe(true);
  });
});

describe('thermochemistry inspector output', () => {
  it('shows ZPE, H and G totals with units plus the temperature and pressure', () => {
    const section = parseGaussianLogText(COMPLETE_FREQ_LOG, 'freq.log').sections[0];
    const inspector = Object.create(GaussianOutputInspector.prototype);
    const html = inspector.renderFileResult({
      filename: 'freq.log',
      summary: { status: 'completed', completed: 1, errors: 0, incomplete: 0 },
      sections: [section],
    });

    expect(html).toContain('ZPE total:');
    expect(html).toContain('-76.386889 Hartree');
    expect(html).toContain('H total:');
    expect(html).toContain('-76.383123 Hartree');
    expect(html).toContain('G total:');
    expect(html).toContain('-76.409357 Hartree');
    expect(html).toContain('298.15 K');
    expect(html).toContain('1 Atm');
    expect(html).toContain('Thermochemistry source, line 18');
  });

  it('escapes thermochemistry evidence in the inspector', () => {
    const section = parseGaussianLogText(COMPLETE_FREQ_LOG, 'freq.log').sections[0];
    const inspector = Object.create(GaussianOutputInspector.prototype);
    const html = inspector.renderFileResult({
      filename: 'freq.log',
      summary: { status: 'completed', completed: 1, errors: 0, incomplete: 0 },
      sections: [{
        ...section,
        thermochemistry: { ...section.thermochemistry, evidence: '<script>alert(1)</script>' },
      }],
    });

    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('adds thermochemistry columns to the CSV export with formula-injection protection', () => {
    const section = parseGaussianLogText(COMPLETE_FREQ_LOG, 'freq.log').sections[0];
    const csv = formatGaussianResultsCsv([{ filename: 'freq.log', sections: [section] }]);
    const [header, row] = csv.split('\r\n');

    expect(header).toContain('thermochemistry_zero_point_hartree');
    expect(header).toContain('thermochemistry_gibbs_total_hartree');
    expect(header).toContain('temperature_k');
    expect(header).toContain('pressure_atm');
    expect(header.split(',')).toHaveLength(row.split(',').length);
    expect(row).toContain('-76.386889');
    expect(row).toContain('-76.409357');
    expect(row).toContain(',298.15,');
    expect(row).toContain(',1,');

    const injected = formatGaussianResultsCsv([{
      filename: 'freq.log',
      sections: [{
        ...section,
        thermochemistry: { ...section.thermochemistry, evidence: '=SUM(A1:A2)' },
      }],
    }]);
    expect(injected.split('\r\n')[1]).toContain('"\'=SUM(A1:A2)"');
  });
});
