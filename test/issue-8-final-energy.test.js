import { describe, expect, it } from 'vitest';
import { parseGaussianLogText } from '../src/parsers/gaussianLogParser.js';
import {
  createWorkflowProject,
  createWorkflowTask,
  parseWorkflowProjectJson,
  serializeWorkflowProject,
  validateWorkflowProject,
} from '../src/utils/workflowModel.js';
import { evaluateWorkflowOutput, methodRequiresFinalEnergy } from '../src/utils/workflowGates.js';
import { formatGaussianResultsCsv, GaussianOutputInspector } from '../src/components/GaussianOutputInspector.js';

// Synthetic Gaussian 16 fixtures shaped like the published keyword-documentation
// output blocks (gaussian.com/mp, /cc, /cbs, /gn). Numbers are illustrative and
// self-consistent where a relationship is asserted; none are claimed as measured.
const MP2_LOG = [
  ' Entering Gaussian System',
  ' #p MP2/6-31G(d)',
  '',
  ' SCF Done:  E(RHF) =  -76.0266031     A.U. after    8 cycles',
  ' E2=       -0.2365202345D+00     EUMP2=       -0.76263123334500D+02',
  '',
  ' Normal termination of Gaussian 16 at Fri Nov  6 18:00:00 2026.',
].join('\n');

const CCSD_T_LOG = [
  ' Entering Gaussian System',
  ' #p CCSD(T)/6-31G(d)',
  '',
  ' SCF Done:  E(RHF) =  -76.0266031     A.U. after    9 cycles',
  ' Wavefunction amplitudes converged. E(Corr)=     -0.2135000000',
  ' CCSD(T)= -0.76263123334500D+02',
  '',
  ' Normal termination of Gaussian 16 at Fri Nov  6 18:00:00 2026.',
].join('\n');

const G4_LOG = [
  ' Entering Gaussian System',
  ' #p G4',
  '',
  ' SCF Done:  E(RHF) =  -76.0266031     A.U. after   11 cycles',
  ' E(CCSD(T))=          -76.400000',
  ' G4(0 K)=            -76.434000   G4 Energy=          -76.431000',
  ' G4 Enthalpy=        -76.430000   G4 Free Energy=     -76.452000',
  '',
  ' Normal termination of Gaussian 16 at Fri Nov  6 18:00:00 2026.',
].join('\n');

// Summary block from the CBS-QB3 example on gaussian.com/cbs.
const CBS_QB3_LOG = [
  ' Entering Gaussian System',
  ' #p CBS-QB3',
  '',
  ' SCF Done:  E(RHF) =  -38.9364470     A.U. after   10 cycles',
  ' Complete Basis Set (CBS) Extrapolation:',
  ' Temperature=          298.150000 Pressure=                   1.000000',
  ' E(ZPE)=                 0.016991 E(Thermal)=                 0.019855',
  ' E(SCF)=               -38.936447 DE(MP2)=                   -0.114761',
  ' DE(CBS)=               -0.011936 DE(MP34)=                  -0.018720',
  ' DE(CCSD)=              -0.002759 DE(Int)=                    0.004204',
  ' DE(Empirical)=         -0.006404',
  ' CBS-QB3 (0 K)=        -39.069832 CBS-QB3 Energy=           -39.066969',
  ' CBS-QB3 Enthalpy=     -39.066025 CBS-QB3 Free Energy=      -39.088192',
  '',
  ' Normal termination of Gaussian 16 at Fri Nov  6 18:00:00 2026.',
].join('\n');

function taskFor(method, overrides = {}) {
  return createWorkflowTask({
    link0: { checkpoint: 'method.chk' },
    route: { method, basisSet: method === 'CBS-QB3' || method === 'G4' ? '' : '6-31G(d)', jobType: 'SP' },
    title: `${method} single point`,
    charge: 0,
    multiplicity: 2,
    atoms: [{ symbol: 'H', x: 0, y: 0, z: 0 }],
  }, { id: `task-${method.replace(/\W+/g, '-').toLowerCase()}`, inputName: 'method.gjf', outputName: 'method.log', ...overrides });
}

function sectionOf(log) {
  return parseGaussianLogText(log, 'method.log').sections[0];
}

describe('Gaussian post-SCF and composite final energies', () => {
  it('reads the MP2 energy from EUMP2, not the SCF reference', () => {
    const [section] = parseGaussianLogText(MP2_LOG, 'mp2.log').sections;

    expect(section.scf.energyHartree).toBeCloseTo(-76.0266031, 9);
    expect(section.finalEnergy).toMatchObject({ label: 'E(MP2)', line: 5 });
    expect(section.finalEnergy.valueHartree).toBeCloseTo(-76.2631233345, 9);
    expect(section.finalEnergy.evidence).toContain('EUMP2');
  });

  it('reads CCSD(T)= and ignores the CCSD correlation energy', () => {
    const [section] = parseGaussianLogText(CCSD_T_LOG, 'ccsdt.log').sections;

    expect(section.finalEnergy).toMatchObject({ label: 'CCSD(T)', line: 6 });
    expect(section.finalEnergy.valueHartree).toBeCloseTo(-76.2631233345, 9);
    expect(section.finalEnergy.valueHartree).not.toBeCloseTo(-0.2135, 6);
  });

  it('reads G4(0 K) and lets it supersede component lines from the same summary', () => {
    const [section] = parseGaussianLogText(G4_LOG, 'g4.log').sections;

    expect(section.finalEnergy).toMatchObject({ label: 'G4(0 K)', line: 6 });
    expect(section.finalEnergy.valueHartree).toBeCloseTo(-76.434, 9);
    // The thermal-corrected `G4 Energy=` column is never substituted for the 0 K energy.
    expect(section.finalEnergy.valueHartree).not.toBeCloseTo(-76.431, 6);
  });

  it('reads the CBS-QB3 (0 K) summary value and ignores DE(...) increments', () => {
    const [section] = parseGaussianLogText(CBS_QB3_LOG, 'cbs.log').sections;

    expect(section.finalEnergy).toMatchObject({ label: 'CBS-QB3 (0 K)', line: 12 });
    expect(section.finalEnergy.valueHartree).toBeCloseTo(-39.069832, 9);
    expect(section.finalEnergy.evidence).toContain('CBS-QB3 (0 K)');
  });

  it('accepts D exponents in every final-energy form', () => {
    const text = [
      ' E(MP2) =  -7.6263123D+01',
      ' CCSD(T)= -.76263123334500D+02',
      ' G4(0 K)= -7.6434000D+01',
      ' W1BD= -7.6400000D+01',
      ' Normal termination of Gaussian 16',
    ].join('\n');
    const [section] = parseGaussianLogText(text, 'd-exponent.log').sections;

    expect(section.finalEnergy).toMatchObject({ label: 'W1BD', line: 4 });
    expect(section.finalEnergy.valueHartree).toBeCloseTo(-76.4, 9);

    const single = parseGaussianLogText(' E(MP2) = -7.6263123D+01\nNormal termination of Gaussian 16\n').sections[0];
    expect(single.finalEnergy).toMatchObject({ label: 'E(MP2)', valueHartree: -76.263123 });
  });

  it('recognizes every documented label form with its printed label', () => {
    // Only the label mapping is asserted here; the numeric value is shared so a
    // mismatch points at the pattern table rather than at the arithmetic.
    const cases = [
      [' E(MP2) = -7.6263123D+01', 'E(MP2)'],
      [' E(MP3) = -7.6263123D+01', 'E(MP3)'],
      [' E(MP4) = -7.6263123D+01', 'E(MP4)'],
      [' MP4(SDTQ)= -7.6263123D+01', 'E(MP4)'],
      [' UMP4(SDQ)= -7.6263123D+01', 'E(MP4SDQ)'],
      [' E(MP4SDQ) = -7.6263123D+01', 'E(MP4SDQ)'],
      [' E(CCSD) = -7.6263123D+01', 'E(CCSD)'],
      [' E(CCSD(T)) = -7.6263123D+01', 'CCSD(T)'],
      [' QCISD(T)= -7.6263123D+01', 'QCISD(T)'],
      [' E(CBS-QB3)= -3.9069832D+01', 'E(CBS-QB3)'],
      [' E(CBS-4M)= -3.9069832D+01', 'E(CBS-4M)'],
      [' CBS-4M (0 K)= -3.9069832D+01', 'CBS-4M (0 K)'],
      [' E(CBS-APNO)= -3.9069832D+01', 'E(CBS-APNO)'],
      [' G3MP2(0 K)= -7.6328339D+01', 'G3MP2(0 K)'],
      [' G3B3(0 K)= -7.6328339D+01', 'G3B3(0 K)'],
      [' G3MP2B3(0 K)= -7.6328339D+01', 'G3MP2B3(0 K)'],
      [' G4MP2(0 K)= -7.6434000D+01', 'G4MP2(0 K)'],
      [' W1BD  (0 K)= -7.6400000D+01', 'W1BD (0 K)'],
      [' E(B2PLYP) = -3.9113226D+01', 'E(B2PLYP)'],
      [' E(B2PLYPD3) = -3.9113226D+01', 'E(B2PLYPD3)'],
      [' E(mPW2PLYP) = -3.9113226D+01', 'E(mPW2PLYP)'],
      [' E(DSDPBEP86) = -3.9113226D+01', 'E(DSDPBEP86)'],
    ];
    for (const [line, label] of cases) {
      const [section] = parseGaussianLogText(`${line}\nNormal termination of Gaussian 16\n`, 'labels.log').sections;
      expect(section.finalEnergy.label, line).toBe(label);
      expect(Number.isFinite(section.finalEnergy.valueHartree), line).toBe(true);
    }
  });

  it('does not mistake CBS increments, E(Corr), or E2(..) for a total energy', () => {
    const incrementsOnly = parseGaussianLogText([
      ' E(SCF)=  -38.936447 DE(MP2)=  -0.114761',
      ' DE(CBS)= -0.011936 DE(CCSD)= -0.002759',
      ' E2(B2PLYP) = -0.03262340664D-01',
      ' Wavefunction amplitudes converged. E(Corr)= -0.2135',
      ' Normal termination of Gaussian 16',
    ].join('\n'), 'increments.log').sections[0];

    expect(incrementsOnly.finalEnergy).toEqual({ valueHartree: null, label: null, line: null, evidence: null });
  });

  it('uses G3(0 K) rather than the E(QCISD(T)) component printed above it', () => {
    const [section] = parseGaussianLogText([
      ' E(QCISD(T))=        -76.276078   E(Empiric)=           -.024560',
      ' G3(0 K)=            -76.328339   G3 Energy=          -76.325503',
      ' Normal termination of Gaussian 16',
    ].join('\n'), 'g3.log').sections;

    expect(section.finalEnergy).toMatchObject({ label: 'G3(0 K)', valueHartree: -76.328339, line: 2 });
  });

  it('leaves finalEnergy null for a plain SCF log instead of promoting SCF Done', () => {
    const [section] = parseGaussianLogText(
      ' SCF Done:  E(RB3LYP) =  -76.4081234     A.U. after    8 cycles\nNormal termination of Gaussian 16\n',
      'dft.log',
    ).sections;

    expect(section.scf.energyHartree).toBeCloseTo(-76.4081234, 9);
    expect(section.finalEnergy).toEqual({ valueHartree: null, label: null, line: null, evidence: null });
  });

  it('keeps final energies separate for two sections in one log', () => {
    const result = parseGaussianLogText(`${MP2_LOG}\n${CCSD_T_LOG}`, 'two-sections.log');

    expect(result.sections).toHaveLength(2);
    expect(result.sections[0].finalEnergy).toMatchObject({ label: 'E(MP2)', line: 5 });
    expect(result.sections[0].finalEnergy.valueHartree).toBeCloseTo(-76.2631233345, 9);
    expect(result.sections[1].finalEnergy.label).toBe('CCSD(T)');
    // Line numbers are file-relative, so the CCSD(T) line in the second section is line 13.
    expect(result.sections[1].finalEnergy.line).toBe(13);
    expect(result.sections[0].finalEnergy.line).not.toBe(result.sections[1].finalEnergy.line);
  });
});

describe('requireFinalEnergy workflow gate', () => {
  it('defaults on for post-HF, double-hybrid, and composite methods only', () => {
    for (const method of ['MP2', 'MP3', 'MP4', 'CCSD', 'CCSD(T)', 'QCISD(T)', 'CBS-QB3', 'CBS-4M', 'G3', 'G4', 'W1BD', 'B2PLYP']) {
      expect(taskFor(method).gates.requireFinalEnergy, method).toBe(true);
      expect(methodRequiresFinalEnergy(method), method).toBe(true);
    }
    for (const method of ['HF', 'B3LYP', 'M062X', 'AM1', 'UFF']) {
      expect(taskFor(method).gates.requireFinalEnergy, method).toBe(false);
      expect(methodRequiresFinalEnergy(method), method).toBe(false);
    }
    expect(methodRequiresFinalEnergy('')).toBe(false);
    expect(methodRequiresFinalEnergy(undefined)).toBe(false);
    // An unrecognized route token is never assumed to carry a method energy.
    expect(methodRequiresFinalEnergy('SOME-CUSTOM-METHOD')).toBe(false);
  });

  it('passes an MP2 job only when the MP2 energy line is present', () => {
    const result = evaluateWorkflowOutput(taskFor('MP2'), sectionOf(MP2_LOG));

    expect(result.overall).toBe('pass');
    expect(result.gates.find(gate => gate.name === 'Method final energy'))
      .toMatchObject({ result: 'pass', required: true, line: 5 });
  });

  it('returns unknown, never pass, when the final-energy line is missing', () => {
    const scfOnly = sectionOf(' SCF Done:  E(RHF) =  -76.0266031     A.U. after 8 cycles\nNormal termination of Gaussian 16\n');
    const result = evaluateWorkflowOutput(taskFor('MP2'), scfOnly);

    expect(result.overall).toBe('unknown');
    expect(result.gates.find(gate => gate.name === 'Method final energy'))
      .toMatchObject({ result: 'unknown', required: true, line: null });
    expect(result.gates.find(gate => gate.name === 'SCF convergence').result).toBe('pass');
  });

  it('fails when the log explicitly reports the method step failing', () => {
    const [section] = parseGaussianLogText(
      ' SCF Done:  E(RHF) =  -76.0266031     A.U.\n CCSD(T) failed to converge in 100 cycles.\nError termination via Lnk1e in l913.exe\n',
      'ccsd-failure.log',
    ).sections;
    const result = evaluateWorkflowOutput(taskFor('CCSD(T)'), section);

    expect(result.overall).toBe('fail');
    expect(result.gates.find(gate => gate.name === 'Method final energy'))
      .toMatchObject({ result: 'fail', line: 2, required: true });
  });

  it('fails a mismatched method-energy label instead of passing it', () => {
    const result = evaluateWorkflowOutput(taskFor('MP2'), sectionOf(CCSD_T_LOG));

    expect(result.gates.find(gate => gate.name === 'Method final energy').result).toBe('fail');
  });

  it('honours an explicit per-task override in both directions', () => {
    const optional = createWorkflowTask({
      link0: { checkpoint: 'method.chk' },
      route: { method: 'MP2', basisSet: '6-31G(d)', jobType: 'SP' },
      title: 'Optional method energy',
      charge: 0,
      multiplicity: 2,
      atoms: [{ symbol: 'H', x: 0, y: 0, z: 0 }],
    }, { gates: { requireFinalEnergy: false } });
    expect(optional.gates.requireFinalEnergy).toBe(false);
    expect(evaluateWorkflowOutput(optional, sectionOf(' #p MP2/6-31G(d) SP\n\n SCF Done:  E(RHF) =  -1.0 A.U.\nNormal termination of Gaussian 16\n')).overall).toBe('pass');

    const forced = taskFor('B3LYP', { gates: { requireFinalEnergy: true } });
    expect(evaluateWorkflowOutput(forced, sectionOf(' #p B3LYP/6-31G(d) SP\n\n SCF Done:  E(RB3LYP) =  -1.0 A.U.\nNormal termination of Gaussian 16\n')).overall).toBe('unknown');
  });
});

describe('method energy in workflow project files', () => {
  function projectWithAttempt() {
    const project = createWorkflowProject('MP2 workflow');
    const task = taskFor('MP2');
    task.attempts.push({
      id: 'attempt-mp2-1',
      outputFilename: 'method.log',
      importedAt: '2026-11-06T00:00:00.000Z',
      overall: 'unknown',
      gates: [],
      summary: { status: 'completed', sectionIndex: 1 },
      parsedSection: sectionOf(MP2_LOG),
    });
    task.activeAttemptId = 'attempt-mp2-1';
    project.tasks.push(task);
    return project;
  }

  it('round-trips the method energy and its gate through save/load', () => {
    const project = projectWithAttempt();
    expect(validateWorkflowProject(project)).toEqual({ valid: true, errors: [] });

    const loaded = parseWorkflowProjectJson(serializeWorkflowProject(project));
    const task = loaded.tasks[0];

    expect(task.gates.requireFinalEnergy).toBe(true);
    expect(task.attempts[0].parsedSection.finalEnergy).toMatchObject({ label: 'E(MP2)', line: 5 });
    expect(task.attempts[0].parsedSection.finalEnergy.valueHartree).toBeCloseTo(-76.2631233345, 9);
    expect(task.attempts[0].parsedSection.finalEnergy.evidence).toContain('EUMP2');
    expect(task.attempts[0].overall).toBe('pass');
    expect(task.attempts[0].gates.find(gate => gate.name === 'Method final energy').result).toBe('pass');
  });

  it('derives the gate for older project files that predate it', () => {
    const project = projectWithAttempt();
    const serialized = JSON.parse(serializeWorkflowProject(project));
    delete serialized.tasks[0].gates.requireFinalEnergy;
    delete serialized.tasks[0].attempts[0].parsedSection.finalEnergy;

    const loaded = parseWorkflowProjectJson(JSON.stringify(serialized));
    expect(loaded.tasks[0].gates.requireFinalEnergy).toBe(true);
    // Without stored evidence the recomputed gate cannot pass; it stays unknown.
    expect(loaded.tasks[0].attempts[0].overall).toBe('unknown');
  });

  it('rejects malformed gate flags and unbounded method-energy evidence', () => {
    const badGate = projectWithAttempt();
    badGate.tasks[0].gates.requireFinalEnergy = 'yes';
    expect(validateWorkflowProject(badGate).valid).toBe(false);

    const tooLongLabel = projectWithAttempt();
    tooLongLabel.tasks[0].attempts[0].parsedSection.finalEnergy.label = 'E('.concat('x'.repeat(120));
    expect(() => serializeWorkflowProject(tooLongLabel)).toThrow(/malformed or unbounded/i);

    const tooLongEvidence = projectWithAttempt();
    tooLongEvidence.tasks[0].attempts[0].parsedSection.finalEnergy.evidence = 'x'.repeat(301);
    expect(() => serializeWorkflowProject(tooLongEvidence)).toThrow(/malformed or unbounded/i);

    const valueWithoutLabel = projectWithAttempt();
    valueWithoutLabel.tasks[0].attempts[0].parsedSection.finalEnergy.label = null;
    expect(() => serializeWorkflowProject(valueWithoutLabel)).toThrow(/malformed or unbounded/i);
  });
});

describe('inspector reporting of reference vs method energy', () => {
  it('labels the SCF reference and the method energy separately with Hartree units', () => {
    const inspector = Object.create(GaussianOutputInspector.prototype);
    const html = inspector.renderSection(sectionOf(MP2_LOG));

    expect(html).toContain('Reference energy (SCF):');
    expect(html).toContain('-76.0266031 Hartree');
    expect(html).toContain('Method energy (E(MP2)):');
    expect(html).toContain('-76.2631233345 Hartree');
    expect(html).toContain('Method energy source, line 5');
  });

  it('says the method energy is absent for an SCF-only section', () => {
    const inspector = Object.create(GaussianOutputInspector.prototype);
    const [section] = parseGaussianLogText(
      ' SCF Done:  E(RB3LYP) =  -76.4081234     A.U.\nNormal termination of Gaussian 16\n',
      'dft.log',
    ).sections;
    const html = inspector.renderSection(section);

    expect(html).toContain('Reference energy (SCF):');
    expect(html).toContain('Method energy:');
    expect(html).toContain('Not found');
    expect(html).not.toContain('Method energy (');
  });

  it('escapes untrusted method-energy evidence', () => {
    const inspector = Object.create(GaussianOutputInspector.prototype);
    const section = sectionOf(MP2_LOG);
    section.finalEnergy.evidence = '<svg/onload=bad()>';
    const html = inspector.renderSection(section);

    expect(html).toContain('&lt;svg/onload=bad()&gt;');
    expect(html).not.toContain('<svg/onload=bad()>');
  });

  it('exports separate reference and method energy CSV columns', () => {
    const results = [{
      filename: 'mp2.log',
      sections: [sectionOf(MP2_LOG), sectionOf(' SCF Done:  E(RHF) =  -1.0 A.U.\nNormal termination of Gaussian 16\n')],
    }];
    const [header, mp2Row, scfOnlyRow] = formatGaussianResultsCsv(results).split('\r\n');
    // Header cells are quoted like every other CSV cell; compare unquoted names.
    const columns = header.split(',').map(cell => cell.replace(/^"|"$/g, ''));

    expect(columns).toContain('reference_energy_hartree');
    expect(columns).toContain('method_energy_hartree');
    expect(columns).toContain('method_energy_label');
    expect(columns.indexOf('reference_energy_hartree')).toBe(columns.indexOf('scf_energy_hartree') + 1);

    const valueAt = (row, name) => row.split(',')[columns.indexOf(name)];
    expect(valueAt(mp2Row, 'reference_energy_hartree')).toBe('-76.0266031');
    expect(valueAt(mp2Row, 'method_energy_hartree')).toBe('-76.2631233345');
    expect(valueAt(mp2Row, 'method_energy_label')).toBe('"E(MP2)"');
    expect(valueAt(scfOnlyRow, 'reference_energy_hartree')).toBe('-1');
    // Absent method energy is an empty quoted cell, exactly like the other optional columns.
    expect(valueAt(scfOnlyRow, 'method_energy_hartree')).toBe('""');
    expect(valueAt(scfOnlyRow, 'method_energy_label')).toBe('""');
  });
});
