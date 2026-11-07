import { describe, it, expect } from 'vitest';
import { BatchGenerator } from '../src/components/BatchGenerator.js';

function makeBcfBatch({ startIndex, comment = 'Benzene batch file', queue }) {
  const batch = Object.create(BatchGenerator.prototype);
  batch.format = 'bcf';
  batch.startIndex = startIndex;
  batch.bcfComment = comment;
  batch.queue = queue;
  return batch;
}

const queue = [
  { id: '1', inputName: 'benzene.gjf', outputName: 'benzene.log', gjfText: 'benzene input' },
  { id: '2', inputName: 'water.gjf', outputName: 'water.log', gjfText: 'water input' },
];

describe('BCF export Start line', () => {
  it('writes the start index as a "!" comment line for startIndex 1', () => {
    const batch = makeBcfBatch({ startIndex: 1, queue });

    expect(batch.generateScriptContent()).toBe(
      '! Benzene batch file\r\n' +
      '! Start=1\r\n' +
      'benzene.gjf, benzene.log\r\n' +
      'water.gjf, water.log'
    );
  });

  it('writes the start index as a "!" comment line for startIndex > 1', () => {
    const batch = makeBcfBatch({ startIndex: 3, queue });

    expect(batch.generateScriptContent()).toBe(
      '! Benzene batch file\r\n' +
      '! Start=3\r\n' +
      'benzene.gjf, benzene.log\r\n' +
      'water.gjf, water.log'
    );
  });

  it('never emits a bare Start= line and keeps CRLF line endings only', () => {
    for (const startIndex of [1, 3]) {
      const text = makeBcfBatch({ startIndex, queue }).generateScriptContent();

      expect(text).toContain(`! Start=${startIndex}`);
      expect(text.split('\r\n').some(line => /^\s*Start=/.test(line))).toBe(false);
      // Strip CRLF pairs: any surviving "\n" would be a bare LF line ending.
      expect(text.replace(/\r\n/g, '')).not.toContain('\n');
    }
  });

  it('still writes the Start line when the title comment is empty', () => {
    const batch = makeBcfBatch({ startIndex: 2, comment: '', queue });

    expect(batch.generateScriptContent()).toBe(
      '! Start=2\r\n' +
      'benzene.gjf, benzene.log\r\n' +
      'water.gjf, water.log'
    );
  });
});
