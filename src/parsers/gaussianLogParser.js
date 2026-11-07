const MAX_LOG_LINE_CHARS = 1024 * 1024;
const MAX_DIAGNOSTICS_PER_SECTION = 30;
const MAX_DIAGNOSTIC_CHARS = 300;
const MAX_STORED_IMAGINARY_FREQUENCIES = 100;
const NUMBER_PATTERN = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[EeDd][+-]?\\d+)?';
const SCF_DONE_RE = new RegExp(
  `\\bSCF Done:\\s*E\\(([^)]+)\\)\\s*=\\s*(${NUMBER_PATTERN})\\s*A\\.U\\b`,
  'i',
);
const NUMBER_RE = new RegExp(NUMBER_PATTERN, 'g');
const TEMPERATURE_RE = new RegExp(`\\bTemperature\\s+(${NUMBER_PATTERN})\\s*Kelvin`, 'i');
const PRESSURE_RE = new RegExp(`\\bPressure\\s+(${NUMBER_PATTERN})\\s*Atm`, 'i');
const THERMOCHEMISTRY_FAILURE_RE = new RegExp(
  '(?:\\bthermochem\\w*\\b[^\\r\\n]{0,120}?\\b(?:fail(?:ed|ure)?|not\\s+computed|not\\s+available|unable\\s+to|could\\s+not)\\b'
  + '|\\b(?:fail(?:ed|ure)?|unable\\s+to|could\\s+not)\\b[^\\r\\n]{0,120}?\\bthermochem\\w*\\b)',
  'i',
);
const THERMOCHEMISTRY_ENTRIES = [
  {
    pattern: new RegExp(`^\\s*Zero-point correction\\s*=\\s*(${NUMBER_PATTERN})`, 'i'),
    apply: (block, value) => { block.zeroPointHartree = value; },
  },
  {
    pattern: new RegExp(`^\\s*Thermal correction to Energy\\s*=\\s*(${NUMBER_PATTERN})`, 'i'),
    apply: (block, value) => { block.thermalCorrectionHartree.energy = value; },
  },
  {
    pattern: new RegExp(`^\\s*Thermal correction to Enthalpy\\s*=\\s*(${NUMBER_PATTERN})`, 'i'),
    apply: (block, value) => { block.thermalCorrectionHartree.enthalpy = value; },
  },
  {
    pattern: new RegExp(`^\\s*Thermal correction to Gibbs Free Energy\\s*=\\s*(${NUMBER_PATTERN})`, 'i'),
    apply: (block, value) => { block.thermalCorrectionHartree.gibbs = value; },
  },
  {
    pattern: new RegExp(`^\\s*Sum of electronic and zero-point Energies\\s*=\\s*(${NUMBER_PATTERN})`, 'i'),
    apply: (block, value) => { block.totalsHartree.zpe = value; },
  },
  {
    pattern: new RegExp(`^\\s*Sum of electronic and thermal Energies\\s*=\\s*(${NUMBER_PATTERN})`, 'i'),
    apply: (block, value) => { block.totalsHartree.energy = value; },
  },
  {
    pattern: new RegExp(`^\\s*Sum of electronic and thermal Enthalpies\\s*=\\s*(${NUMBER_PATTERN})`, 'i'),
    apply: (block, value) => { block.totalsHartree.enthalpy = value; },
  },
  {
    pattern: new RegExp(`^\\s*Sum of electronic and thermal Free Energies\\s*=\\s*(${NUMBER_PATTERN})`, 'i'),
    apply: (block, value) => { block.totalsHartree.gibbs = value; },
  },
];

function toNumber(token) {
  return Number(token.replace(/[dD]/g, 'E'));
}

function makeThermochemistry() {
  return {
    zeroPointHartree: null,
    thermalCorrectionHartree: { energy: null, enthalpy: null, gibbs: null },
    totalsHartree: { zpe: null, energy: null, enthalpy: null, gibbs: null },
    temperatureK: null,
    pressureAtm: null,
    line: null,
    evidence: null,
    failure: null,
  };
}

function clipLine(line) {
  const text = line.trim();
  if (text.length <= MAX_DIAGNOSTIC_CHARS) return text;
  return `${text.slice(0, MAX_DIAGNOSTIC_CHARS - 1)}…`;
}

function makeSection(index) {
  return {
    index,
    status: 'incomplete',
    termination: null,
    scf: {
      status: 'unknown',
      method: null,
      energyHartree: null,
      records: 0,
      line: null,
      evidence: null,
    },
    optimization: { status: 'unknown', line: null, evidence: null },
    frequencies: {
      count: 0,
      imaginaryCount: 0,
      imaginaryValues: [],
      omittedImaginaryValues: 0,
      minImaginary: null,
      line: null,
      evidence: null,
      hasRecord: false,
    },
    thermochemistry: makeThermochemistry(),
    diagnostics: [],
    omittedDiagnostics: 0,
    hasContent: false,
  };
}

function publicSection(section) {
  return {
    index: section.index,
    status: section.status,
    termination: section.termination ? { ...section.termination } : null,
    scf: { ...section.scf },
    optimization: { ...section.optimization },
    frequencies: {
      count: section.frequencies.hasRecord ? section.frequencies.count : null,
      imaginaryCount: section.frequencies.imaginaryCount,
      imaginaryValues: [...section.frequencies.imaginaryValues],
      omittedImaginaryValues: section.frequencies.omittedImaginaryValues,
      minImaginary: section.frequencies.minImaginary,
      line: section.frequencies.line,
      evidence: section.frequencies.evidence,
    },
    thermochemistry: {
      zeroPointHartree: section.thermochemistry.zeroPointHartree,
      thermalCorrectionHartree: { ...section.thermochemistry.thermalCorrectionHartree },
      totalsHartree: { ...section.thermochemistry.totalsHartree },
      temperatureK: section.thermochemistry.temperatureK,
      pressureAtm: section.thermochemistry.pressureAtm,
      line: section.thermochemistry.line,
      evidence: section.thermochemistry.evidence,
      failure: section.thermochemistry.failure ? { ...section.thermochemistry.failure } : null,
    },
    diagnostics: section.diagnostics.map(item => ({ ...item })),
    omittedDiagnostics: section.omittedDiagnostics,
  };
}

/** Incrementally summarizes Gaussian output without retaining the source log. */
export class GaussianLogParser {
  constructor(filename = 'output.log') {
    this.filename = filename;
    this.sections = [];
    this.lineNumber = 0;
    this.current = makeSection(1);
    this.finishedResult = null;
  }

  pushLine(rawLine) {
    if (this.finishedResult) {
      throw new Error('Cannot add lines after the Gaussian log parser is finished.');
    }
    if (typeof rawLine !== 'string') {
      throw new TypeError('Gaussian log lines must be strings.');
    }
    if (rawLine.length > MAX_LOG_LINE_CHARS) {
      throw new Error(`Log line ${this.lineNumber + 1} exceeds the 1 MiB safety limit.`);
    }

    this.lineNumber++;
    const line = rawLine.replace(/\0/g, '');
    if (line.trim()) this.current.hasContent = true;

    const scfMatch = line.match(SCF_DONE_RE);
    if (scfMatch) {
      const energy = toNumber(scfMatch[2]);
      if (Number.isFinite(energy)) {
        this.current.scf.status = 'converged';
        this.current.scf.method = scfMatch[1].trim();
        this.current.scf.energyHartree = energy;
        this.current.scf.records++;
        this.current.scf.line = this.lineNumber;
        this.current.scf.evidence = clipLine(line);
      }
    } else if (/\bSCF\s+(?:convergence\s+)?failure\b|\bSCF\s+has\s+not\s+converged\b/i.test(line)) {
      this.current.scf.status = 'failed';
      this.current.scf.line = this.lineNumber;
      this.current.scf.evidence = clipLine(line);
      this.addDiagnostic('error', line);
    }

    if (/\b(?:Optimization completed|Stationary point found)\b/i.test(line)) {
      if (this.current.optimization.status !== 'converged') {
        this.current.optimization = { status: 'converged', line: this.lineNumber, evidence: clipLine(line) };
      }
    } else if (/\bOptimization (?:stopped|failed)\b|\bNumber of steps exceeded\b/i.test(line)) {
      this.current.optimization = { status: 'not converged', line: this.lineNumber, evidence: clipLine(line) };
    }

    const frequencyMarker = line.match(/\bFrequencies\s*--\s*(.*)$/i);
    if (frequencyMarker) {
      const values = Array.from(frequencyMarker[1].matchAll(NUMBER_RE), match => toNumber(match[0]))
        .filter(Number.isFinite);
      this.current.frequencies.hasRecord = true;
      this.current.frequencies.line = this.lineNumber;
      this.current.frequencies.evidence = clipLine(line);
      this.current.frequencies.count += values.length;
      for (const value of values) {
        if (value < 0) {
          this.current.frequencies.imaginaryCount++;
          if (this.current.frequencies.imaginaryValues.length < MAX_STORED_IMAGINARY_FREQUENCIES) {
            this.current.frequencies.imaginaryValues.push(value);
          } else {
            this.current.frequencies.omittedImaginaryValues++;
          }
          if (this.current.frequencies.minImaginary === null || value < this.current.frequencies.minImaginary) {
            this.current.frequencies.minImaginary = value;
          }
        }
      }
    }

    if (/^\s*--Link1--\s*$/i.test(line)) {
      // A new Gaussian link starts a new job; thermochemistry from the prior link must not bleed into it.
      this.current.thermochemistry = makeThermochemistry();
    }

    this.recordThermochemistry(line);

    const isGaussianLicenseNotice = /\bWarning\s+--\s+This program may not be used in any manner\b/i.test(line);
    if (!isGaussianLicenseNotice
      && /\b(?:Warning|Error|failed|failure|no convergence|not converged)\b/i.test(line)
      && !scfMatch
      && !/\bSCF\s+(?:convergence\s+)?failure\b|\bSCF\s+has\s+not\s+converged\b/i.test(line)) {
      this.addDiagnostic(/\b(?:Error|failed|failure)\b/i.test(line) ? 'error' : 'warning', line);
    }

    if (/\bError termination\b/i.test(line)) {
      this.closeSection('error', line);
    } else if (/\bNormal termination of Gaussian\b/i.test(line)) {
      this.closeSection('completed', line);
    }
  }

  recordThermochemistry(line) {
    const block = this.current.thermochemistry;
    for (const entry of THERMOCHEMISTRY_ENTRIES) {
      const match = line.match(entry.pattern);
      if (!match) continue;
      const value = toNumber(match[1]);
      if (!Number.isFinite(value)) return;
      entry.apply(block, value);
      // Keep the last recognized line: the free-energy total is printed last in a complete block.
      block.line = this.lineNumber;
      block.evidence = clipLine(line);
      return;
    }

    const temperature = line.match(TEMPERATURE_RE);
    const pressure = line.match(PRESSURE_RE);
    if (temperature || pressure) {
      const temperatureK = temperature ? toNumber(temperature[1]) : null;
      const pressureAtm = pressure ? toNumber(pressure[1]) : null;
      if (Number.isFinite(temperatureK)) block.temperatureK = temperatureK;
      if (Number.isFinite(pressureAtm)) block.pressureAtm = pressureAtm;
      if (Number.isFinite(temperatureK) || Number.isFinite(pressureAtm)) {
        block.line = this.lineNumber;
        block.evidence = clipLine(line);
      }
    }

    if (!block.failure && THERMOCHEMISTRY_FAILURE_RE.test(line)) {
      block.failure = { line: this.lineNumber, evidence: clipLine(line) };
    }
  }

  addDiagnostic(kind, line) {
    if (this.current.diagnostics.length >= MAX_DIAGNOSTICS_PER_SECTION) {
      this.current.omittedDiagnostics++;
      return;
    }
    this.current.diagnostics.push({ kind, line: this.lineNumber, text: clipLine(line) });
  }

  closeSection(status, line) {
    this.current.status = status;
    this.current.termination = { line: this.lineNumber, text: clipLine(line) };
    this.sections.push(publicSection(this.current));
    this.current = makeSection(this.sections.length + 1);
  }

  finish() {
    if (this.finishedResult) return this.finishedResult;
    if (this.current.hasContent || this.sections.length === 0) {
      this.sections.push(publicSection(this.current));
    }

    const completed = this.sections.filter(section => section.status === 'completed').length;
    const errors = this.sections.filter(section => section.status === 'error').length;
    const incomplete = this.sections.filter(section => section.status === 'incomplete').length;
    const status = errors > 0 ? 'error' : incomplete > 0 ? 'incomplete' : 'completed';

    this.finishedResult = {
      filename: this.filename,
      sections: this.sections,
      summary: { status, completed, errors, incomplete },
    };
    return this.finishedResult;
  }
}

/** Parse an in-memory text value; useful for tests and small snippets. */
export function parseGaussianLogText(text, filename = 'output.log') {
  if (typeof text !== 'string') {
    throw new TypeError('Gaussian log content must be text.');
  }
  const parser = new GaussianLogParser(filename);
  for (const line of text.split(/\r\n|\n|\r/)) parser.pushLine(line);
  return parser.finish();
}

/** Stream and parse a Gaussian log without holding the full file in memory. */
export async function parseGaussianLogStream(stream, filename = 'output.log') {
  if (!stream || typeof stream.getReader !== 'function') {
    throw new TypeError('A readable byte stream is required.');
  }

  const parser = new GaussianLogParser(filename);
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = '';

  const consume = (text, flush = false) => {
    pending += text;
    let start = 0;
    let i = 0;
    while (i < pending.length) {
      const char = pending[i];
      if (char === '\n') {
        parser.pushLine(pending.slice(start, i));
        i++;
        start = i;
      } else if (char === '\r') {
        if (i === pending.length - 1 && !flush) break;
        parser.pushLine(pending.slice(start, i));
        i += pending[i + 1] === '\n' ? 2 : 1;
        start = i;
      } else {
        i++;
      }
      if (i - start > MAX_LOG_LINE_CHARS) {
        throw new Error(`Log line ${parser.lineNumber + 1} exceeds the 1 MiB safety limit.`);
      }
    }
    pending = pending.slice(start);
    if (flush && pending.length > 0) {
      parser.pushLine(pending);
      pending = '';
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      consume(decoder.decode(value, { stream: true }));
    }
    consume(decoder.decode(), true);
    return parser.finish();
  } finally {
    reader.releaseLock();
  }
}
