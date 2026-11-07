/**
 * Issue #18 — documented Gaussian 16 route-keyword registry and validation.
 *
 * The data tests keep the registry and the curated lists in lockstep. The
 * behaviour tests pin the severity model: unknown keywords are warnings that
 * quote the offending token, route-unsafe characters are hard errors, and the
 * documented `allowUnknownRouteTokens` escape hatch suppresses warnings only.
 */
import { describe, it, expect } from 'vitest';
import { methods } from '../src/data/methods.js';
import { basisSets } from '../src/data/basisSets.js';
import { jobTypes } from '../src/data/keywords.js';
import {
  ROUTE_KEYWORD_REGISTRY,
  ROUTE_KEYWORD_KINDS,
  getRouteKeyword,
  isRegisteredRouteToken,
} from '../src/data/keywordRegistry.js';
import {
  validateRouteTokens,
  splitRouteKeywords,
  findUnsafeRouteCharacter,
  lintTheoryLevel,
} from '../src/utils/validation.js';
import { GJFPreview } from '../src/components/GJFPreview.js';

const byKind = (kind) => ROUTE_KEYWORD_REGISTRY.filter((entry) => entry.kind === kind);

/** The keyword that owns a route segment (text before `=` or `(`). */
const keywordOf = (segment) => {
  const end = segment.search(/[=(]/);
  return end === -1 ? segment : segment.slice(0, end);
};

const route = (overrides = {}) => ({
  method: 'B3LYP',
  basisSet: '6-31G(d)',
  jobType: 'SP',
  scf: '',
  grid: '',
  dispersion: '',
  solvation: '',
  pop: '',
  custom: '',
  ...overrides,
});

const waterConfig = (routeOverrides = {}) => ({
  link0: {},
  route: route(routeOverrides),
  title: 'issue-18 test',
  charge: 0,
  multiplicity: 1,
  atoms: [
    { symbol: 'O', x: 0, y: 0, z: 0 },
    { symbol: 'H', x: 0, y: 0, z: 1 },
    { symbol: 'H', x: 1, y: 0, z: 0 },
  ],
});

describe('issue #18 — registry data integrity', () => {
  it('registers every method keyword exactly once and matches its curated metadata', () => {
    const entries = byKind('method');

    expect(entries).toHaveLength(methods.length);

    for (const method of methods) {
      const matches = entries.filter((entry) => entry.token.toUpperCase() === method.keyword.toUpperCase());
      expect(matches, `method ${method.keyword}`).toHaveLength(1);

      const [entry] = matches;
      expect(entry.metadata.family).toBe(method.category);
      expect(entry.metadata.needsBasis).toBe(method.needsBasis);
      expect(entry.metadata.isDft).toBe(method.isDft);
      expect(entry.metadata.rung).toBe(method.rung);
      expect(typeof entry.metadata.requiresEcp).toBe('boolean');
    }

    const curated = new Set(methods.map((method) => method.keyword.toUpperCase()));
    for (const entry of entries) {
      expect(curated.has(entry.token.toUpperCase()), `registry method ${entry.token}`).toBe(true);
    }
  });

  it('registers every basis keyword exactly once and matches its ECP metadata', () => {
    const entries = byKind('basis');

    expect(entries).toHaveLength(basisSets.length);

    for (const basis of basisSets) {
      const matches = entries.filter((entry) => entry.token.toUpperCase() === basis.keyword.toUpperCase());
      expect(matches, `basis ${basis.keyword}`).toHaveLength(1);

      const [entry] = matches;
      expect(entry.metadata.family).toBe(basis.category);
      expect(entry.metadata.needsBasis).toBe(true);
      expect(entry.metadata.isDft).toBe(false);
      expect(entry.metadata.rung).toBeNull();
      expect(entry.metadata.requiresEcp).toBe(basis.ecpIncluded === true);
      expect(entry.metadata.ecpIncluded).toBe(basis.ecpIncluded === true);
      expect(entry.metadata.ecpName).toBe(basis.ecpName ?? null);
    }

    const curated = new Set(basisSets.map((basis) => basis.keyword.toUpperCase()));
    for (const entry of entries) {
      expect(curated.has(entry.token.toUpperCase()), `registry basis ${entry.token}`).toBe(true);
    }
  });

  it('has unique non-empty tokens and valid kinds for every entry', () => {
    const lowerTokens = ROUTE_KEYWORD_REGISTRY.map((entry) => entry.token.toLowerCase());

    expect(new Set(lowerTokens).size).toBe(lowerTokens.length);

    for (const entry of ROUTE_KEYWORD_REGISTRY) {
      expect(ROUTE_KEYWORD_KINDS).toContain(entry.kind);
      expect(typeof entry.token).toBe('string');
      expect(entry.token.trim()).not.toBe('');
      expect(entry.metadata).toBeTypeOf('object');
      expect(entry.metadata.family).toBeTruthy();
    }
  });

  it('registers every calculation type the UI can emit', () => {
    const emitted = new Set();
    for (const job of jobTypes) {
      for (const segment of splitRouteKeywords(job.keyword)) {
        emitted.add(keywordOf(segment));
      }
    }

    expect([...emitted].sort()).toEqual(
      ['SP', 'Opt', 'Freq', 'IRC', 'Scan', 'TD', 'NMR', 'Stable', 'Polar', 'Force', 'Volume'].sort()
    );

    for (const token of emitted) {
      const entry = getRouteKeyword(token);
      expect(entry, `job keyword ${token}`).toBeDefined();
      expect(entry.kind).toBe('job');
    }
  });

  it('registers the option families the generator writes', () => {
    const required = [
      'EmpiricalDispersion',
      'SCRF', 'SMD', 'Solvent',
      'Integral', 'Grid',
      'SCF',
      'Pop',
      'Guess',
      'Geom',
      'Pseudo',
      'GenECP', 'Gen',
      'Counterpoise',
      'NoSymm', 'Symmetry',
      'GFInput', 'GFPrint',
      'MaxDisk',
    ];

    for (const token of required) {
      const entry = getRouteKeyword(token);
      expect(entry, `option keyword ${token}`).toBeDefined();
      expect(entry.kind).toBe('option');
      expect(entry.metadata.family).toBeTruthy();
    }

    expect(getRouteKeyword('EmpiricalDispersion').metadata.values).toEqual(['GD2', 'GD3', 'GD3BJ']);
  });

  it('resolves documented aliases but not hyphenated display names', () => {
    expect(getRouteKeyword('Int')).toBe(getRouteKeyword('Integral'));
    expect(getRouteKeyword('Population')).toBe(getRouteKeyword('Pop'));
    expect(getRouteKeyword('NoSymmetry')).toBe(getRouteKeyword('NoSymm'));

    expect(isRegisteredRouteToken('b3lyp')).toBe(true);
    // def2-TZVP is the published name; only def2TZVP is a Gaussian route token
    // (issue #1). Validation must not paper over the difference.
    expect(isRegisteredRouteToken('def2-TZVP')).toBe(false);
    expect(isRegisteredRouteToken('def2TZVP')).toBe(true);
  });
});

describe('issue #18 — validateRouteTokens', () => {
  it('accepts a fully populated documented route', () => {
    const result = validateRouteTokens(route({
      jobType: 'Opt Freq',
      scf: 'SCF=(Tight,MaxCycle=200)',
      grid: 'Int=UltraFine',
      dispersion: 'EmpiricalDispersion=GD3BJ',
      solvation: 'SCRF=(SMD,Solvent=Water)',
      pop: 'Pop=NBO',
      custom: 'NoSymm GFPrint MaxDisk=10GB',
      strictRouteTokens: true,
    }));

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('accepts the GenECP basis slot', () => {
    const result = validateRouteTokens({ method: 'B3LYP', basisMode: 'GenECP', jobType: 'SP' });

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('warns for an unregistered method and quotes the offending token', () => {
    const result = validateRouteTokens(route({ method: 'FOO-2X' }));

    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].token).toBe('FOO-2X');
    expect(result.warnings[0].field).toBe('method');
    expect(result.warnings[0].message).toContain('"FOO-2X"');
  });

  it('warns for an unregistered basis token', () => {
    const result = validateRouteTokens(route({ basisSet: 'def2-TZVP' }));

    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].token).toBe('def2-TZVP');
    expect(result.warnings[0].field).toBe('basisSet');
  });

  it('rejects route-unsafe characters as hard errors', () => {
    const cases = [
      ['method', 'B3LYP/def2'],
      ['method', 'B3 LYP'],
      ['method', 'B3LYP\tX'],
      ['basisSet', '6-31 G(d)'],
      ['basisSet', 'B3%LYP'],
      ['jobType', 'Opt#Freq'],
    ];

    for (const [field, token] of cases) {
      const result = validateRouteTokens(route({ [field]: token }));

      expect(result.errors.length, `${field}=${token}`).toBeGreaterThan(0);
      expect(result.errors[0].token).toBe(token);
      expect(result.errors[0].message).toContain(token);
      expect(result.warnings).toHaveLength(0);
    }

    expect(findUnsafeRouteCharacter('B3LYP')).toBeNull();
    expect(findUnsafeRouteCharacter('B3LYP/def2').char).toBe('/');
  });

  it('never suppresses an unsafe-character error with allowUnknownRouteTokens', () => {
    const result = validateRouteTokens(route({
      method: 'B3LYP/def2',
      allowUnknownRouteTokens: true,
    }));

    expect(result.warnings).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('B3LYP/def2');
  });

  it('suppresses unknown-keyword warnings with allowUnknownRouteTokens', () => {
    const result = validateRouteTokens(route({
      method: 'FOO-2X',
      custom: 'BAR-3',
      strictRouteTokens: true,
      allowUnknownRouteTokens: true,
    }));

    expect(result.warnings).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('skips the free-text custom field unless strict mode is enabled', () => {
    const relaxed = validateRouteTokens(route({ custom: 'FOO-2X BAR=1' }));
    expect(relaxed.warnings).toEqual([]);
    expect(relaxed.errors).toEqual([]);

    const strict = validateRouteTokens(route({ custom: 'FOO-2X BAR=1', strictRouteTokens: true }));
    expect(strict.warnings.map((warning) => warning.token)).toEqual(['FOO-2X', 'BAR=1']);
  });

  it('checks only the keyword that owns a parenthesised option list', () => {
    const result = validateRouteTokens(route({
      scf: 'SCF=(Tight,MaxCycle=200,SomeFutureOption=3)',
      solvation: 'SCRF=(SMD,Solvent=Water)',
    }));

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('splits route text without breaking parenthesised options', () => {
    expect(splitRouteKeywords('Opt=(TS, CalcFC) Freq')).toEqual(['Opt=(TS, CalcFC)', 'Freq']);
    expect(splitRouteKeywords('   ')).toEqual([]);
  });
});

describe('issue #18 — pre-flight lint and preview surfacing', () => {
  it('surfaces an unknown token as a warning issue quoting the token', () => {
    const issue = lintTheoryLevel(waterConfig({ method: 'FOO-2X' })).issues
      .find((candidate) => candidate.id === 'route-token-unknown');

    expect(issue).toBeDefined();
    expect(issue.severity).toBe('warning');
    expect(issue.message).toContain('"FOO-2X"');
  });

  it('surfaces a route-unsafe token as an error issue', () => {
    const issue = lintTheoryLevel(waterConfig({ method: 'B3LYP/def2' })).issues
      .find((candidate) => candidate.id === 'route-token-unsafe');

    expect(issue).toBeDefined();
    expect(issue.severity).toBe('error');
    expect(issue.message).toContain('B3LYP/def2');
  });

  it('honours allowUnknownRouteTokens through lintTheoryLevel', () => {
    const ids = lintTheoryLevel(waterConfig({
      method: 'FOO-2X',
      allowUnknownRouteTokens: true,
    })).issues.map((issue) => issue.id);

    expect(ids).not.toContain('route-token-unknown');
  });

  it('renders the token-escaped warning and the escape-hatch hint in the lint panel', () => {
    const view = Object.create(GJFPreview.prototype);
    const html = view.renderLintPanel([
      {
        id: 'route-token-unknown',
        severity: 'warning',
        message: 'Unknown route keyword "FOO-2X" in the method field.',
      },
    ]);

    expect(html).toContain('Pre-flight Chemistry Lint');
    expect(html).toContain('&quot;FOO-2X&quot;');
    expect(html).toContain('Allow unknown route keywords');
    expect(html).toContain('1 warning');
  });

  it('renders errors with error styling and counts', () => {
    const view = Object.create(GJFPreview.prototype);
    const html = view.renderLintPanel([
      {
        id: 'route-token-unsafe',
        severity: 'error',
        message: 'Route token "B3LYP/def2" in the method field contains the \'/\' separator.',
      },
    ]);

    expect(html).toContain('Error:');
    expect(html).toContain('1 error');
    expect(html).toContain('var(--error)');
  });

  it('passes both advanced flags from the preview into the route config', () => {
    const view = Object.create(GJFPreview.prototype);
    view.allowUnknownRouteTokens = true;
    view.strictRouteTokens = true;

    const config = view.buildConfig({ method: 'B3LYP', basisSet: '6-31G(d)', jobType: 'SP' }, null);

    expect(config.route.allowUnknownRouteTokens).toBe(true);
    expect(config.route.strictRouteTokens).toBe(true);

    const defaults = Object.create(GJFPreview.prototype);
    const defaultConfig = defaults.buildConfig({ method: 'B3LYP', basisSet: '6-31G(d)', jobType: 'SP' }, null);
    expect(defaultConfig.route.allowUnknownRouteTokens).toBe(false);
    expect(defaultConfig.route.strictRouteTokens).toBe(false);
  });
});
