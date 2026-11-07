import { describe, expect, it } from 'vitest';
import { GaussianLogParser, parseGaussianLogStream, parseGaussianLogText } from '../src/parsers/gaussianLogParser.js';

const normalOutput = `
 Entering Gaussian System
 #p B3LYP/6-31G(d) Opt Freq
 SCF Done:  E(RB3LYP) =  -75.9839481995     A.U. after   8 cycles
 Optimization completed.
 -- Stationary point found.
 Frequencies --   -42.3  100.1  200.2
 Warning: example warning text
 Normal termination of Gaussian 16 at Fri Nov  6 18:00:00 2026.
`;

describe('Gaussian output parser', () => {
  it('summarizes normal termination, SCF energy, optimization, frequencies, and source lines', () => {
    const result = parseGaussianLogText(normalOutput, 'water.log');
    expect(result.filename).toBe('water.log');
    expect(result.summary).toEqual({ status: 'completed', completed: 1, errors: 0, incomplete: 0 });
    expect(result.sections).toHaveLength(1);

    const [section] = result.sections;
    expect(section.status).toBe('completed');
    expect(section.termination.line).toBe(9);
    expect(section.scf).toMatchObject({
      status: 'converged', method: 'RB3LYP', energyHartree: -75.9839481995, records: 1, line: 4,
    });
    expect(section.scf.evidence).toContain('SCF Done:');
    expect(section.optimization).toMatchObject({ status: 'converged', line: 5 });
    expect(section.optimization.evidence).toContain('Optimization completed.');
    expect(section.frequencies).toMatchObject({
      count: 3, imaginaryCount: 1, imaginaryValues: [-42.3], minImaginary: -42.3, line: 7,
    });
    expect(section.diagnostics).toContainEqual({ kind: 'warning', line: 8, text: 'Warning: example warning text' });
  });

  it('makes finalization idempotent and rejects new lines afterward', () => {
    const parser = new GaussianLogParser('closed.log');
    parser.pushLine('Entering Gaussian System');
    const result = parser.finish();
    expect(parser.finish()).toBe(result);
    expect(() => parser.pushLine('extra line')).toThrow(/parser is finished/i);
  });

  it('reports explicit errors and missing evidence without treating either as success', () => {
    const error = parseGaussianLogText(
      'SCF convergence failure\nError termination via Lnk1e in l502.exe\n',
      'failed.out',
    );
    expect(error.summary).toEqual({ status: 'error', completed: 0, errors: 1, incomplete: 0 });
    expect(error.sections[0].status).toBe('error');
    expect(error.sections[0].scf.status).toBe('failed');
    expect(error.sections[0].termination.line).toBe(2);
    expect(error.sections[0].diagnostics[0].line).toBe(1);

    const unknown = parseGaussianLogText('Entering Gaussian System\n', 'empty.log');
    expect(unknown.summary.status).toBe('incomplete');
    expect(unknown.sections[0].status).toBe('incomplete');
    expect(unknown.sections[0].scf.status).toBe('unknown');
    expect(unknown.sections[0].optimization.status).toBe('unknown');
    expect(unknown.sections[0].frequencies.count).toBeNull();
  });

  it('keeps termination-delimited calculations separate and accepts D exponents', () => {
    const text = [
      'SCF Done: E(RHF) = -1.0D+02 A.U. after 4 cycles',
      'Normal termination of Gaussian 16',
      'SCF Done: E(UB3LYP) = -2.5E+01 A.U. after 7 cycles',
      'Error termination via Lnk1e in l9999.exe',
    ].join('\n');
    const result = parseGaussianLogText(text, 'link1.log');

    expect(result.sections).toHaveLength(2);
    expect(result.sections.map(section => section.status)).toEqual(['completed', 'error']);
    expect(result.sections.map(section => section.scf.energyHartree)).toEqual([-100, -25]);
    expect(result.sections[0].scf.method).toBe('RHF');
    expect(result.sections[1].scf.method).toBe('UB3LYP');
    expect(result.summary).toEqual({ status: 'error', completed: 1, errors: 1, incomplete: 0 });
  });

  it('bounds diagnostics and truncates pathological source lines', () => {
    const text = Array.from({ length: 40 }, (_, i) => ` Warning: ${i} ${'x'.repeat(400)}`).join('\n');
    const result = parseGaussianLogText(text, 'noisy.log');
    expect(result.sections[0].diagnostics).toHaveLength(30);
    expect(result.sections[0].diagnostics.every(item => item.text.length <= 300)).toBe(true);
  });

  it('does not report the Gaussian license notice as a calculation warning', () => {
    const result = parseGaussianLogText(
      'Warning -- This program may not be used in any manner that competes with the business of Gaussian, Inc.\nNormal termination of Gaussian 16',
      'licensed.log',
    );
    expect(result.sections[0].status).toBe('completed');
    expect(result.sections[0].diagnostics).toEqual([]);
  });

  it('counts every negative mode while bounding the stored values', () => {
    const frequencies = Array.from({ length: 105 }, (_, i) => -(i + 1)).join(' ');
    const result = parseGaussianLogText(`Frequencies -- ${frequencies}`, 'large-molecule.log');
    expect(result.sections[0].frequencies.imaginaryCount).toBe(105);
    expect(result.sections[0].frequencies.imaginaryValues).toHaveLength(100);
    expect(result.sections[0].frequencies.omittedImaginaryValues).toBe(5);
    expect(result.sections[0].frequencies.minImaginary).toBe(-105);
  });

  it('parses streams when UTF-8 chunks split CRLF and log records', async () => {
    const encoder = new TextEncoder();
    const chunks = [
      'SCF Done: E(RHF) = -1.25D+00 A.U. after 2 cycles\r',
      '\nNormal termination of Gaussian 16\r\n',
    ];
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });

    const result = await parseGaussianLogStream(stream, 'streamed.log');
    expect(result.summary.status).toBe('completed');
    expect(result.sections[0].scf.energyHartree).toBe(-1.25);
    expect(result.sections[0].termination.line).toBe(2);
  });

  it('rejects pathological unterminated lines instead of buffering indefinitely', async () => {
    const stream = new Blob(['x'.repeat(1024 * 1024 + 1)]).stream();
    await expect(parseGaussianLogStream(stream, 'oversized-line.log'))
      .rejects.toThrow(/exceeds the 1 MiB safety limit/i);
  });
});
