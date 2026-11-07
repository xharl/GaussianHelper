/**
 * @fileoverview Machine-readable registry of the Gaussian 16 route-section
 * keywords this application emits.
 *
 * The registry exists so a route token can be checked against Gaussian's
 * documented vocabulary instead of a hand-maintained list of strings inside a
 * validator. It is the single place to add a keyword when a new method, basis
 * set or route option is offered by the UI.
 *
 * Entry shape:
 *   {
 *     token: string,                       // exact route-section spelling
 *     kind: 'method' | 'basis' | 'job' | 'option',
 *     metadata: { family, ... }            // documented metadata, see below
 *   }
 *
 * `metadata` always carries `family` (the method/basis category, `job-type`,
 * or the option family). Method entries add `needsBasis`, `isDft`, `rung` and
 * `requiresEcp`; basis entries add `requiresEcp`, `ecpIncluded`, `ecpName`,
 * `size` and `coverage`; option entries may add `values` (the documented
 * option values this app knows about) and `nested` (the option only appears
 * inside another keyword's parenthesised list).
 *
 * Sources (transcribed, never inferred):
 *   - Methods: https://gaussian.com/dft/ , https://gaussian.com/mp/ ,
 *     https://gaussian.com/cc/ , https://gaussian.com/cbs/ ,
 *     https://gaussian.com/semiempirical/ , https://gaussian.com/mm/ .
 *     The per-keyword metadata is the curated list in src/data/methods.js.
 *   - Basis sets: https://gaussian.com/basissets/ ,
 *     https://gaussian.com/pseudo/ , https://gaussian.com/gen/ .
 *     The per-keyword metadata is the curated list in src/data/basisSets.js.
 *   - Calculation types: https://gaussian.com/route/ and one page per job
 *     keyword (SP, Opt, Freq, IRC, Scan, TD, NMR, Stable, Polar, Force,
 *     Volume), cited on each job entry below.
 *   - Options: one Gaussian keyword page per entry, cited on the entry.
 *
 * The method and basis entries are seeded from the curated arrays rather than
 * copied, so there is exactly one source of truth for their metadata. The data
 * test in test/issue-18-keyword-registry.test.js enforces one-to-one coverage:
 * every list entry has exactly one registry entry and vice versa.
 */

import { methods } from './methods.js';
import { basisSets } from './basisSets.js';

/**
 * Documentation URLs for the keyword families covered by this registry.
 * @type {Readonly<Object<string, string>>}
 */
export const ROUTE_KEYWORD_SOURCES = Object.freeze({
  route: 'https://gaussian.com/route/',
  methods: 'https://gaussian.com/dft/',
  correlatedMethods: 'https://gaussian.com/mp/',
  coupledCluster: 'https://gaussian.com/cc/',
  composite: 'https://gaussian.com/cbs/',
  semiEmpirical: 'https://gaussian.com/semiempirical/',
  molecularMechanics: 'https://gaussian.com/mm/',
  basisSets: 'https://gaussian.com/basissets/',
  pseudo: 'https://gaussian.com/pseudo/',
  gen: 'https://gaussian.com/gen/',
  dispersion: 'https://gaussian.com/dft/',
  solvation: 'https://gaussian.com/scrf/',
  integrationGrid: 'https://gaussian.com/integral/',
  scf: 'https://gaussian.com/scf/',
  population: 'https://gaussian.com/population/',
  guess: 'https://gaussian.com/guess/',
  geom: 'https://gaussian.com/geom/',
  symmetry: 'https://gaussian.com/symmetry/',
  output: 'https://gaussian.com/gfinput/',
  maxDisk: 'https://gaussian.com/maxdisk/',
  counterpoise: 'https://gaussian.com/counterpoise/',
  overlay: 'https://gaussian.com/iop/',
});

/** Valid registry kinds. */
export const ROUTE_KEYWORD_KINDS = Object.freeze(['method', 'basis', 'job', 'option']);

/**
 * Calculation-type keywords the UI can put in the route section.
 *
 * `SP` is the default calculation type (https://gaussian.com/sp/); the others
 * are documented calculation-type keywords. Descriptions are transcribed
 * summaries of each keyword's own page.
 *
 * @type {ReadonlyArray<{token: string, kind: 'job', metadata: Object}>}
 */
export const routeJobKeywords = Object.freeze([
  {
    token: 'SP',
    kind: 'job',
    metadata: {
      family: 'job-type',
      description: 'Single-point energy calculation; the default when no calculation type keyword is given.',
      url: 'https://gaussian.com/sp/',
    },
  },
  {
    token: 'Opt',
    kind: 'job',
    metadata: {
      family: 'job-type',
      description: 'Geometry optimization to a stationary point on the potential energy surface.',
      url: 'https://gaussian.com/opt/',
    },
  },
  {
    token: 'Freq',
    kind: 'job',
    metadata: {
      family: 'job-type',
      description: 'Force constants, vibrational frequencies and thermochemistry.',
      url: 'https://gaussian.com/freq/',
    },
  },
  {
    token: 'IRC',
    kind: 'job',
    metadata: {
      family: 'job-type',
      description: 'Follow the intrinsic reaction coordinate from a transition state.',
      url: 'https://gaussian.com/irc/',
    },
  },
  {
    token: 'Scan',
    kind: 'job',
    metadata: {
      family: 'job-type',
      description: 'Rigid potential energy surface scan over selected internal coordinates.',
      url: 'https://gaussian.com/scan/',
    },
  },
  {
    token: 'TD',
    kind: 'job',
    metadata: {
      family: 'job-type',
      description: 'Time-dependent Hartree-Fock or DFT excited-state calculation.',
      url: 'https://gaussian.com/td/',
    },
  },
  {
    token: 'NMR',
    kind: 'job',
    metadata: {
      family: 'job-type',
      description: 'NMR shielding tensors and magnetic susceptibilities.',
      url: 'https://gaussian.com/nmr/',
    },
  },
  {
    token: 'Stable',
    kind: 'job',
    metadata: {
      family: 'job-type',
      description: 'Test the stability of a Hartree-Fock or DFT wavefunction.',
      url: 'https://gaussian.com/stable/',
    },
  },
  {
    token: 'Polar',
    kind: 'job',
    metadata: {
      family: 'job-type',
      description: 'Dipole polarizabilities and hyperpolarizabilities.',
      url: 'https://gaussian.com/polar/',
    },
  },
  {
    token: 'Force',
    kind: 'job',
    metadata: {
      family: 'job-type',
      description: 'Single calculation of the forces (energy gradient) on the nuclei.',
      url: 'https://gaussian.com/force/',
    },
  },
  {
    token: 'Volume',
    kind: 'job',
    metadata: {
      family: 'job-type',
      description: 'Molecular volume inside a 0.001 electrons/Bohr^3 density contour.',
      url: 'https://gaussian.com/volume/',
    },
  },
]);

/**
 * Option keywords the app writes, plus the documented families they belong to.
 *
 * Only the keyword that owns a parenthesised list is a top-level route token;
 * `nested` marks documented sub-options (`SMD`, `Solvent=`, `Grid=`) that this
 * registry records for documentation but that are not validated separately.
 *
 * @type {ReadonlyArray<{token: string, kind: 'option', metadata: Object}>}
 */
export const routeOptionKeywords = Object.freeze([
  {
    token: 'EmpiricalDispersion',
    kind: 'option',
    metadata: {
      family: 'dispersion',
      description: "Adds Grimme's empirical dispersion correction (D2, D3, or D3 with Becke-Johnson damping).",
      values: ['GD2', 'GD3', 'GD3BJ'],
      url: 'https://gaussian.com/dft/',
    },
  },
  {
    token: 'SCRF',
    kind: 'option',
    metadata: {
      family: 'solvation',
      description: 'Solvation by a polarizable continuum model; IEFPCM is the default, SMD is selected inside the list.',
      values: ['PCM', 'IEFPCM', 'SMD', 'IPCM', 'SCIPCM', 'Dipole'],
      url: 'https://gaussian.com/scrf/',
    },
  },
  {
    token: 'SMD',
    kind: 'option',
    metadata: {
      family: 'solvation',
      description: 'SMD variation of IEFPCM, requested inside SCRF=(SMD,...).',
      nested: true,
      url: 'https://gaussian.com/scrf/',
    },
  },
  {
    token: 'Solvent',
    kind: 'option',
    metadata: {
      family: 'solvation',
      description: 'Selects the solvent by name inside SCRF=(...,Solvent=<name>).',
      valueForm: 'Solvent=<name>',
      nested: true,
      url: 'https://gaussian.com/scrf/',
    },
  },
  {
    token: 'Integral',
    kind: 'option',
    metadata: {
      family: 'integration-grid',
      description: 'Controls two-electron integral evaluation; Integral=Grid selects the numerical integration grid.',
      aliases: ['Int'],
      values: ['UltraFine', 'SuperFine', 'FineGrid', 'CoarseGrid', 'SG1Grid', 'Pass0Grid'],
      url: 'https://gaussian.com/integral/',
    },
  },
  {
    token: 'Grid',
    kind: 'option',
    metadata: {
      family: 'integration-grid',
      description: 'Integration-grid sub-option of Integral (Integral(Grid=<name>)).',
      nested: true,
      url: 'https://gaussian.com/integral/',
    },
  },
  {
    token: 'SCF',
    kind: 'option',
    metadata: {
      family: 'scf',
      description: 'Controls the self-consistent field procedure (convergence, algorithm and restart options).',
      values: ['Tight', 'QC', 'XQC', 'YQC', 'DIIS', 'CDIIS', 'MaxCycle'],
      url: 'https://gaussian.com/scf/',
    },
  },
  {
    token: 'Pop',
    kind: 'option',
    metadata: {
      family: 'population',
      description: 'Controls population analysis and orbital printing; the keyword requires an option.',
      aliases: ['Population'],
      values: ['Full', 'Minimal', 'Regular', 'NPA', 'NBO', 'MK', 'CHELPG'],
      url: 'https://gaussian.com/population/',
    },
  },
  {
    token: 'Guess',
    kind: 'option',
    metadata: {
      family: 'guess',
      description: 'Controls the initial wavefunction guess.',
      values: ['Harris', 'Huckel', 'Core', 'Mix', 'Read', 'Fragment'],
      url: 'https://gaussian.com/guess/',
    },
  },
  {
    token: 'Geom',
    kind: 'option',
    metadata: {
      family: 'geometry',
      description: 'Specifies the source of the molecule specification and geometry-related output.',
      values: ['Checkpoint', 'AllCheck', 'ModRedundant', 'Connectivity'],
      url: 'https://gaussian.com/geom/',
    },
  },
  {
    token: 'Pseudo',
    kind: 'option',
    metadata: {
      family: 'ecp',
      description: 'Substitutes a model potential for core electrons; Pseudo=Read reads ECP data from the input.',
      values: ['Read', 'Cards', 'CHF', 'SHC', 'LANL1', 'LANL2', 'Old'],
      url: 'https://gaussian.com/pseudo/',
    },
  },
  {
    token: 'Gen',
    kind: 'option',
    metadata: {
      family: 'basis-mode',
      description: 'Requests a user-specified general basis set read from the input stream.',
      url: 'https://gaussian.com/gen/',
    },
  },
  {
    token: 'GenECP',
    kind: 'option',
    metadata: {
      family: 'basis-mode',
      description: 'Requests general basis functions and ECPs; equivalent to Gen Pseudo=Read.',
      url: 'https://gaussian.com/gen/',
    },
  },
  {
    token: 'Counterpoise',
    kind: 'option',
    metadata: {
      family: 'bssE',
      description: 'Counterpoise (BSSE) correction; requires an integer fragment count, e.g. Counterpoise=2.',
      url: 'https://gaussian.com/counterpoise/',
    },
  },
  {
    token: 'NoSymm',
    kind: 'option',
    metadata: {
      family: 'symmetry',
      description: 'Prevents molecule reorientation and runs in the input orientation.',
      aliases: ['NoSymmetry'],
      url: 'https://gaussian.com/symmetry/',
    },
  },
  {
    token: 'Symmetry',
    kind: 'option',
    metadata: {
      family: 'symmetry',
      description: 'Controls use of molecular symmetry; Symmetry=None disables it completely.',
      values: ['None', 'Int', 'Grad', 'SCF', 'Loose', 'Tight', 'Follow', 'PG', 'Axis', 'On'],
      url: 'https://gaussian.com/symmetry/',
    },
  },
  {
    token: 'GFInput',
    kind: 'option',
    metadata: {
      family: 'output',
      description: 'Prints the current basis set in a form suitable for general basis-set input.',
      url: 'https://gaussian.com/gfinput/',
    },
  },
  {
    token: 'GFPrint',
    kind: 'option',
    metadata: {
      family: 'output',
      description: 'Prints the current basis set and density fitting basis set in tabular form.',
      url: 'https://gaussian.com/gfprint/',
    },
  },
  {
    token: 'MaxDisk',
    kind: 'option',
    metadata: {
      family: 'resources',
      description: 'Sets scratch disk space in 8-byte words, optionally followed by KB/MB/GB/TB or KW/MW/GW/TW.',
      url: 'https://gaussian.com/maxdisk/',
    },
  },
  {
    token: 'IOp',
    kind: 'option',
    metadata: {
      family: 'overlay',
      description: 'Overlay option IOp(i/j=k) for settings without a route keyword; an advanced escape hatch.',
      url: 'https://gaussian.com/iop/',
    },
  },
]);

/**
 * Seed method entries from the curated list. `requiresEcp` is false for every
 * method: an ECP belongs to the basis set, not the method.
 */
const methodEntries = methods.map((method) => ({
  token: method.keyword,
  kind: 'method',
  metadata: {
    family: method.category,
    subcategory: method.subcategory,
    needsBasis: method.needsBasis === true,
    isDft: method.isDft === true,
    rung: method.rung ?? null,
    requiresEcp: false,
    isRangeSeparated: method.isRangeSeparated === true,
    alreadyIncludesDispersion: method.alreadyIncludesDispersion === true,
  },
}));

/**
 * Seed basis entries from the curated list. `requiresEcp` mirrors
 * `ecpIncluded`: a basis that covers heavy elements with an ECP requires (and
 * supplies) that potential, while an all-electron basis requires none.
 */
const basisEntries = basisSets.map((basis) => ({
  token: basis.keyword,
  kind: 'basis',
  metadata: {
    family: basis.category,
    needsBasis: true,
    isDft: false,
    rung: null,
    requiresEcp: basis.ecpIncluded === true,
    ecpIncluded: basis.ecpIncluded === true,
    ecpName: basis.ecpName ?? null,
    size: basis.size,
    coverage: basis.coverage ?? null,
  },
}));

/**
 * Every route keyword this application can emit, in one machine-readable list.
 * Method and basis entries come first, then calculation types and options.
 *
 * @type {ReadonlyArray<{token: string, kind: string, metadata: Object}>}
 */
export const ROUTE_KEYWORD_REGISTRY = Object.freeze([
  ...methodEntries,
  ...basisEntries,
  ...routeJobKeywords,
  ...routeOptionKeywords,
]);

/** @type {Map<string, {token: string, kind: string, metadata: Object}>} */
const REGISTRY_BY_TOKEN = new Map();
for (const entry of ROUTE_KEYWORD_REGISTRY) {
  REGISTRY_BY_TOKEN.set(entry.token.toLowerCase(), entry);
  for (const alias of entry.metadata.aliases ?? []) {
    REGISTRY_BY_TOKEN.set(alias.toLowerCase(), entry);
  }
}

/**
 * Look up a route keyword by token or documented alias (case-insensitive).
 *
 * The lookup is deliberately exact apart from case: Gaussian route keywords are
 * case-insensitive, but a hyphenated display name such as `def2-TZVP` is not a
 * route token and must not silently resolve to `def2TZVP` (issue #1).
 *
 * @param {string} token - Candidate route keyword, e.g. 'B3LYP' or 'Int'.
 * @returns {Object|undefined} The registry entry, if the token is documented.
 */
export function getRouteKeyword(token) {
  if (typeof token !== 'string') return undefined;
  const needle = token.trim().toLowerCase();
  if (!needle) return undefined;
  return REGISTRY_BY_TOKEN.get(needle);
}

/**
 * Whether a token is a documented route keyword (or alias).
 * @param {string} token
 * @returns {boolean}
 */
export function isRegisteredRouteToken(token) {
  return getRouteKeyword(token) !== undefined;
}

/**
 * All registry entries of a given kind.
 * @param {'method'|'basis'|'job'|'option'} kind
 * @returns {Array<Object>}
 */
export function getRouteKeywordsByKind(kind) {
  return ROUTE_KEYWORD_REGISTRY.filter((entry) => entry.kind === kind);
}

export default ROUTE_KEYWORD_REGISTRY;
