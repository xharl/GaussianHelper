import { describe, expect, it } from 'vitest';
import { parseGaussianLogText } from '../src/parsers/gaussianLogParser.js';
import {
  createWorkflowProject,
  createWorkflowTask,
  parseWorkflowProjectJson,
  serializeWorkflowProject,
  validateWorkflowProject,
} from '../src/utils/workflowModel.js';
import { evaluateWorkflowOutput, expectedRouteTokens } from '../src/utils/workflowGates.js';
import { GaussianOutputInspector } from '../src/components/GaussianOutputInspector.js';

// Synthetic Gaussian 16 header shaped like a real log: Link 1 marker, Link 0
// echo, then the route section and the route-parameter dump after a blank line.
const MP2_LOG = [
  ' Entering Link 1 = /opt/g16/l1.exe PID=  4242.',
  '',
  ' %Chk=mp2-water.chk',
  ' %OldChk=previous.chk',
  ' %mem=8GB',
  ' %nprocshared=4',
  ' ----------------------------------------------------------------------',
  ' #p MP2/6-31G(d) Opt Freq SCF=Tight',
  '',
  ' 1/18=20,19=15,20=60,',
  ' SCF Done:  E(RHF) =  -76.0266031     A.U. after    8 cycles',
  ' Normal termination of Gaussian 16 at Fri Nov  6 18:00:00 2026.',
].join('\n');

const B3LYP_LOG = [
  ' Entering Link 1 = /opt/g16/l1.exe PID=  4343.',
  ' %Chk=b3lyp.chk',
  ' #p B3LYP/6-31G(d) SP',
  '',
  ' SCF Done:  E(RB3LYP) =  -76.4081234     A.U. after    9 cycles',
  ' Normal termination of Gaussian 16 at Fri Nov  6 18:01:00 2026.',
].join('\n');

const MP2_ROUTE = { method: 'MP2', basisSet: '6-31G(d)', jobType: 'Opt Freq', scf: 'SCF=Tight' };

function makeTask(route, gates = {}) {
  return {
    id: 'task-route',
    gates: {
      requireNormalTermination: true,
      requireScfRecord: false,
      requireOptimizationComplete: false,
      requireFrequencyRecord: false,
      requireThermochemistry: false,
      requireFinalEnergy: false,
      expectedImaginaryModes: null,
      ...gates,
    },
    config: { route, link0: { checkpoint: 'expected.chk' } },
  };
}

function sectionOf(text) {
  return parseGaussianLogText(text, 'calc.log').sections[0];
}

function routeGate(result) {
  return result.gates.find(gate => gate.name === 'Route echo matches');
}

function logWithRoute(routeLine, { checkpoints = ['run.chk'], body } = {}) {
  return [
    ' Entering Link 1 = /opt/g16/l1.exe PID=  4242.',
    ...checkpoints.map(name => ` %Chk=${name}`),
    ` ${routeLine}`,
    '',
    ...(body || [' SCF Done:  E(RHF) =  -1.0 A.U. after 2 cycles']),
    ' Normal termination of Gaussian 16 at Fri Nov  6 18:00:00 2026.',
  ].join('\n');
}

function taskFor(method, extraRoute = {}) {
  return makeTask({ method, basisSet: '6-31G(d)', jobType: 'SP', ...extraRoute });
}

describe('route echo parsing', () => {
  it('captures the normalised token set, first route line, and Link 0 checkpoints', () => {
    const [section] = parseGaussianLogText(MP2_LOG, 'mp2.log').sections;

    expect(section.routeEcho.tokens).toEqual(['MP2', '6-31G(D)', 'OPT', 'FREQ', 'SCF=TIGHT']);
    expect(section.routeEcho.checkpoints).toEqual(['mp2-water.chk', 'previous.chk']);
    expect(section.routeEcho.line).toBe(8);
    expect(section.routeEcho.evidence).toBe('#p MP2/6-31G(d) Opt Freq SCF=Tight');
  });

  it('accepts a wrapped route and an echo without a Link 1 marker', () => {
    const text = [
      ' Entering Gaussian System',
      ' # mp2/6-31g(d) opt',
      ' freq scf=tight',
      '',
      ' SCF Done:  E(RHF) =  -1.0 A.U.',
      ' Normal termination of Gaussian 16',
    ].join('\n');
    const [section] = parseGaussianLogText(text, 'wrapped.log').sections;

    expect(section.routeEcho.tokens).toEqual(['MP2', '6-31G(D)', 'OPT', 'FREQ', 'SCF=TIGHT']);
    expect(section.routeEcho.line).toBe(2);
    expect(section.routeEcho.evidence).toBe('# mp2/6-31g(d) opt freq scf=tight');
  });

  it('keeps route and checkpoint evidence separate for two sections', () => {
    const result = parseGaussianLogText(`${MP2_LOG}\n${B3LYP_LOG}`, 'two-sections.log');

    expect(result.sections).toHaveLength(2);
    expect(result.sections[0].routeEcho.tokens).toContain('MP2');
    expect(result.sections[0].routeEcho.checkpoints).toEqual(['mp2-water.chk', 'previous.chk']);
    expect(result.sections[1].routeEcho.tokens).toEqual(['B3LYP', '6-31G(D)', 'SP']);
    expect(result.sections[1].routeEcho.tokens).not.toContain('MP2');
    expect(result.sections[1].routeEcho.checkpoints).toEqual(['b3lyp.chk']);
    expect(result.sections[1].routeEcho.checkpoints).not.toContain('mp2-water.chk');
  });

  it('does not invent a route when the log has no echo', () => {
    const [section] = parseGaussianLogText(
      ' SCF Done:  E(RHF) =  -1.0 A.U.\n Normal termination of Gaussian 16\n',
      'no-route.log',
    ).sections;

    expect(section.routeEcho).toEqual({ tokens: [], checkpoints: [], line: null, evidence: null });
  });
});

describe('Route echo matches gate', () => {
  it('passes when every configured token is echoed and reports the checkpoint', () => {
    const result = evaluateWorkflowOutput(makeTask(MP2_ROUTE), sectionOf(MP2_LOG));

    expect(result.overall).toBe('pass');
    expect(routeGate(result)).toMatchObject({ result: 'pass', required: true, line: 8 });
    expect(routeGate(result).evidence).toContain('#p MP2/6-31G(d) Opt Freq SCF=Tight');
    expect(routeGate(result).evidence).toContain('mp2-water.chk');
  });

  it('fails a log run with a different functional and names the missing and unexpected tokens', () => {
    const section = sectionOf(logWithRoute('#p B3LYP/6-31G(d) Opt Freq SCF=Tight'));
    const result = evaluateWorkflowOutput(makeTask(MP2_ROUTE), section);

    expect(result.overall).toBe('fail');
    expect(routeGate(result)).toMatchObject({ result: 'fail', required: true });
    expect(routeGate(result).evidence).toMatch(/Missing route tokens: MP2/i);
    expect(routeGate(result).evidence).toMatch(/method keyword B3LYP/i);
  });

  it('matches reordered, case-changed, reformatted, and old-format echoes', () => {
    const reordered = evaluateWorkflowOutput(
      makeTask(MP2_ROUTE),
      sectionOf(logWithRoute('#P freq opt 6-31g(d) mp2 scf=tight')),
    );
    expect(reordered.overall).toBe('pass');

    const reformatted = evaluateWorkflowOutput(
      makeTask({ ...MP2_ROUTE, solvation: 'SCRF=(SMD,Solvent=Water)' }),
      sectionOf(logWithRoute('#p MP2/6-31G(d) Opt Freq SCF = Tight SCRF = ( SMD , Solvent = Water )')),
    );
    expect(reformatted.overall).toBe('pass');

    const oldFormat = evaluateWorkflowOutput(
      makeTask(MP2_ROUTE),
      sectionOf([
        ' Entering Gaussian System',
        ' # mp2/6-31g(d) opt',
        ' freq scf=tight',
        '',
        ' SCF Done:  E(RHF) =  -1.0 A.U.',
        ' Normal termination of Gaussian 16',
      ].join('\n')),
    );
    expect(oldFormat.overall).toBe('pass');
  });

  it('returns unknown, never pass, when no route echo is found', () => {
    const section = sectionOf(' SCF Done:  E(RHF) =  -1.0 A.U.\n Normal termination of Gaussian 16\n');
    const result = evaluateWorkflowOutput(taskFor('MP2'), section);

    expect(result.overall).toBe('unknown');
    expect(routeGate(result)).toMatchObject({ result: 'unknown', required: true, line: null, evidence: null });
  });

  it('matches a GenECP multi-token route', () => {
    const route = {
      method: 'B3LYP',
      basisMode: 'GenECP',
      elementBasis: [{ elements: ['Pd'], basis: 'LanL2DZ' }],
      jobType: 'Opt',
    };
    const result = evaluateWorkflowOutput(makeTask(route), sectionOf(logWithRoute('#p B3LYP/GenECP Opt')));

    expect(expectedRouteTokens(route)).toEqual(['B3LYP', 'GENECP', 'OPT']);
    expect(routeGate(result)).toMatchObject({ result: 'pass', required: true });

    const singleBasis = evaluateWorkflowOutput(
      makeTask({ method: 'B3LYP', basisSet: '6-31G(d)', jobType: 'Opt' }),
      sectionOf(logWithRoute('#p B3LYP/GenECP Opt')),
    );
    expect(routeGate(singleBasis).evidence).toMatch(/basis keyword GENECP/i);
  });

  it('ignores harmless extra tokens but flags a conflicting functional', () => {
    const harmless = evaluateWorkflowOutput(
      makeTask(MP2_ROUTE),
      sectionOf(logWithRoute('#p MP2/6-31G(d) Opt Freq SCF=Tight Test MaxDisk=50GB')),
    );
    expect(harmless.overall).toBe('pass');

    const conflict = evaluateWorkflowOutput(
      makeTask(MP2_ROUTE),
      sectionOf(logWithRoute('#p MP2/6-31G(d) B3LYP Opt Freq SCF=Tight')),
    );
    expect(conflict.overall).toBe('fail');
    expect(routeGate(conflict).evidence).toMatch(/Unexpected method keyword B3LYP/i);
  });

  it('flags a conflicting basis set keyword', () => {
    const result = evaluateWorkflowOutput(
      makeTask({ method: 'MP2', basisSet: '6-311G(d,p)', jobType: 'SP' }),
      sectionOf(logWithRoute('#p MP2/6-31G(d) SP')),
    );

    expect(result.overall).toBe('fail');
    expect(routeGate(result).evidence).toMatch(/missing route tokens: 6-311G\(D,P\)/i);
    expect(routeGate(result).evidence).toMatch(/basis keyword 6-31G\(D\)/i);
  });

  it('compares each section against the same task independently', () => {
    const result = parseGaussianLogText(`${MP2_LOG}\n${B3LYP_LOG}`, 'two-sections.log');

    expect(routeGate(evaluateWorkflowOutput(makeTask(MP2_ROUTE), result.sections[0])).result).toBe('pass');
    expect(routeGate(evaluateWorkflowOutput(taskFor('B3LYP'), result.sections[1])).result).toBe('pass');
    expect(routeGate(evaluateWorkflowOutput(makeTask(MP2_ROUTE), result.sections[1])).result).toBe('fail');
  });
});

describe('route echo in reports and project files', () => {
  it('shows the echoed checkpoint and route diff in the inspector', () => {
    const inspector = Object.create(GaussianOutputInspector.prototype);
    const matching = inspector.renderSection(sectionOf(MP2_LOG));

    expect(matching).toContain('Route echo:');
    expect(matching).toContain('mp2-water.chk');
    expect(matching).toContain('previous.chk');

    const diff = inspector.renderSection(
      sectionOf(logWithRoute('#p B3LYP/6-31G(d) Opt Freq SCF=Tight')),
      { expectedRouteTokens: expectedRouteTokens(MP2_ROUTE) },
    );
    expect(diff).toContain('Route echo comparison:');
    expect(diff).toContain('missing MP2');
    expect(diff).toContain('unexpected B3LYP');
  });

  it('shows "Not found" in the inspector when a section has no echo', () => {
    const inspector = Object.create(GaussianOutputInspector.prototype);
    const html = inspector.renderSection(sectionOf(
      ' SCF Done:  E(RHF) =  -1.0 A.U.\n Normal termination of Gaussian 16\n',
    ));

    expect(html).toContain('Route echo:');
    expect(html).toContain('Not found in this section');
  });

  it('round-trips route tokens, checkpoints, and the gate verdict through save/load', () => {
    const log = [
      ' Entering Link 1 = /opt/g16/l1.exe PID=  4242.',
      ' %Chk=roundtrip.chk',
      ' #p MP2/6-31G(d)',
      '',
      ' SCF Done:  E(RHF) =  -76.0266031     A.U. after    8 cycles',
      ' EUMP2=       -0.76263123334500D+02',
      ' Normal termination of Gaussian 16 at Fri Nov  6 18:00:00 2026.',
    ].join('\n');
    const section = sectionOf(log);
    const project = createWorkflowProject('Route echo round-trip');
    const task = createWorkflowTask({
      link0: { checkpoint: 'roundtrip.chk' },
      route: { method: 'MP2', basisSet: '6-31G(d)', jobType: 'SP' },
      title: 'MP2 single point',
      charge: 0,
      multiplicity: 2,
      atoms: [{ symbol: 'H', x: 0, y: 0, z: 0 }],
    }, { id: 'task-roundtrip', inputName: 'roundtrip.gjf', outputName: 'roundtrip.log' });
    task.attempts.push({
      id: 'attempt-roundtrip',
      outputFilename: 'roundtrip.log',
      importedAt: '2026-11-06T00:00:00.000Z',
      overall: 'unknown',
      gates: [],
      summary: { status: 'completed', sectionIndex: 1 },
      parsedSection: section,
    });
    task.activeAttemptId = 'attempt-roundtrip';
    project.tasks.push(task);

    expect(validateWorkflowProject(project)).toEqual({ valid: true, errors: [] });
    const loaded = parseWorkflowProjectJson(serializeWorkflowProject(project));
    const attempt = loaded.tasks[0].attempts[0];

    expect(attempt.parsedSection.routeEcho).toEqual({
      tokens: ['MP2', '6-31G(D)'],
      checkpoints: ['roundtrip.chk'],
      line: 3,
      evidence: '#p MP2/6-31G(d)',
    });
    expect(attempt.gates.find(gate => gate.name === 'Route echo matches'))
      .toMatchObject({ result: 'pass', required: true, line: 3 });
    expect(attempt.overall).toBe('pass');
  });

  it('rejects malformed or unbounded route evidence on load', () => {
    const project = createWorkflowProject('Route echo validation');
    const task = createWorkflowTask({
      link0: { checkpoint: 'bad.chk' },
      route: { method: 'HF', basisSet: '3-21G', jobType: 'SP' },
      title: 'Validation fixture',
      charge: 0,
      multiplicity: 1,
      atoms: [{ symbol: 'O', x: 0, y: 0, z: 0 }, { symbol: 'H', x: 0, y: 1, z: 0 }],
    }, { id: 'task-bad', inputName: 'bad.gjf', outputName: 'bad.log' });
    task.attempts.push({
      id: 'attempt-bad',
      outputFilename: 'bad.log',
      importedAt: '2026-11-06T00:00:00.000Z',
      overall: 'unknown',
      gates: [],
      summary: { status: 'completed', sectionIndex: 1 },
      parsedSection: sectionOf(MP2_LOG),
    });
    task.activeAttemptId = 'attempt-bad';
    project.tasks.push(task);

    project.tasks[0].attempts[0].parsedSection.routeEcho.tokens = ['mp2'];
    expect(() => serializeWorkflowProject(project)).toThrow(/malformed or unbounded/i);

    project.tasks[0].attempts[0].parsedSection.routeEcho.tokens = ['MP2'];
    project.tasks[0].attempts[0].parsedSection.routeEcho.checkpoints = ['x'.repeat(200)];
    expect(() => serializeWorkflowProject(project)).toThrow(/malformed or unbounded/i);
  });
});
