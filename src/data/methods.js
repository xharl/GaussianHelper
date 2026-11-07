/**
 * Gaussian calculation methods organized by category.
 * Each method: { keyword, name, description, category, subcategory, popular, needsBasis }
 *
 * Chemistry-lint metadata (consumed by src/utils/validation.js):
 *   - isDft: true for Kohn-Sham DFT functionals (false for HF, post-HF,
 *     composite, semi-empirical and molecular-mechanics methods).
 *   - rung: Jacob's-ladder / method class. One of 'HF' | 'LDA' | 'GGA' |
 *     'meta-GGA' | 'hybrid' | 'meta-hybrid' | 'double-hybrid' | 'post-HF' |
 *     'composite' | 'semi-empirical' | 'MM'. Drives the dispersion, basis-size
 *     and cost-estimate heuristics.
 *   - isRangeSeparated: true only for long-range-corrected functionals
 *     (CAM-B3LYP, wB97 family, LC-wPBE, M11). Absent means false.
 *   - costExponent: optional N-scaling override for the order-of-magnitude
 *     cost panel, where the rung alone is too coarse (e.g. MP2 N^5 vs
 *     CCSD(T) N^7). This is a textbook scaling law, not a measured runtime.
 *
 * `keyword` is the exact route-section token and must be a standalone Gaussian
 * method keyword. `name` is display-only and may use literature notation
 * (e.g. "M06-2X", "ωB97X-D") that is not itself a route token.
 *
 * Methods whose `keyword` already implies an empirical dispersion model
 * (e.g. B2PLYPD3 = B2PLYP + D3(BJ), see https://gaussian.com/dft/) carry
 * `alreadyIncludesDispersion: true`, so the UI and generator can block a
 * second, double-counting EmpiricalDispersion request. Verified against
 * gaussian.com: B2PLYPD3 (D3BJ), wB97XD (D2), APFD (PFD), B97D (D2) and
 * DSDPBEP86 (D3BJ, https://gaussian.com/mp/).
 */

export const methods = [
  // ─── DFT - GGA ───────────────────────────────────────────────────────
  {
    keyword: 'BLYP',
    name: 'BLYP',
    description: 'Becke exchange + Lee-Yang-Parr correlation (pure GGA)',
    category: 'DFT',
    subcategory: 'GGA',
    popular: false,
    needsBasis: true,
    isDft: true,
    rung: 'GGA',
  },
  {
    keyword: 'BP86',
    name: 'BP86',
    description: 'Becke exchange + Perdew 86 correlation',
    category: 'DFT',
    subcategory: 'GGA',
    popular: false,
    needsBasis: true,
    isDft: true,
    rung: 'GGA',
  },
  {
    keyword: 'PBEPBE',
    name: 'PBE',
    description: 'Perdew-Burke-Ernzerhof exchange-correlation functional',
    category: 'DFT',
    subcategory: 'GGA',
    popular: false,
    needsBasis: true,
    isDft: true,
    rung: 'GGA',
  },
  {
    keyword: 'PW91PW91',
    name: 'PW91',
    description: 'Perdew-Wang 91 exchange-correlation functional',
    category: 'DFT',
    subcategory: 'GGA',
    popular: false,
    needsBasis: true,
    isDft: true,
    rung: 'GGA',
  },

  // ─── DFT - Meta-GGA ─────────────────────────────────────────────────
  {
    keyword: 'TPSSTPSS',
    name: 'TPSS',
    description: 'Tao-Perdew-Staroverov-Scuseria meta-GGA functional',
    category: 'DFT',
    subcategory: 'Meta-GGA',
    popular: false,
    needsBasis: true,
    isDft: true,
    rung: 'meta-GGA',
  },
  {
    keyword: 'M06L',
    name: 'M06-L',
    description: 'Minnesota 06 local functional (no HF exchange)',
    category: 'DFT',
    subcategory: 'Meta-GGA',
    popular: false,
    needsBasis: true,
    isDft: true,
    rung: 'meta-GGA',
  },

  // ─── DFT - Hybrid ───────────────────────────────────────────────────
  {
    keyword: 'B3LYP',
    name: 'B3LYP',
    description: 'Becke 3-parameter hybrid with LYP correlation — the most widely used DFT functional',
    category: 'DFT',
    subcategory: 'Hybrid',
    popular: true,
    needsBasis: true,
    isDft: true,
    rung: 'hybrid',
  },
  {
    keyword: 'B3PW91',
    name: 'B3PW91',
    description: 'Becke 3-parameter hybrid with PW91 correlation',
    category: 'DFT',
    subcategory: 'Hybrid',
    popular: false,
    needsBasis: true,
    isDft: true,
    rung: 'hybrid',
  },
  {
    keyword: 'PBE1PBE',
    name: 'PBE0',
    description: 'Hybrid PBE functional with 25% HF exchange',
    category: 'DFT',
    subcategory: 'Hybrid',
    popular: false,
    needsBasis: true,
    isDft: true,
    rung: 'hybrid',
  },
  {
    keyword: 'BHandHLYP',
    name: 'BHandHLYP',
    description: 'Becke half-and-half hybrid with LYP correlation (50% HF exchange)',
    category: 'DFT',
    subcategory: 'Hybrid',
    popular: false,
    needsBasis: true,
    isDft: true,
    rung: 'hybrid',
  },
  {
    keyword: 'O3LYP',
    name: 'O3LYP',
    description: 'OPTX exchange + LYP correlation hybrid functional',
    category: 'DFT',
    subcategory: 'Hybrid',
    popular: false,
    needsBasis: true,
    isDft: true,
    rung: 'hybrid',
  },
  {
    keyword: 'X3LYP',
    name: 'X3LYP',
    description: 'Extended hybrid functional combining Becke and PW exchange with LYP correlation',
    category: 'DFT',
    subcategory: 'Hybrid',
    popular: false,
    needsBasis: true,
    isDft: true,
    rung: 'hybrid',
  },

  // ─── DFT - Meta-Hybrid ──────────────────────────────────────────────
  {
    keyword: 'M05',
    name: 'M05',
    description: 'Minnesota 05 meta-hybrid functional',
    category: 'DFT',
    subcategory: 'Meta-Hybrid',
    popular: false,
    needsBasis: true,
    isDft: true,
    rung: 'meta-hybrid',
  },
  {
    keyword: 'M052X',
    name: 'M05-2X',
    description: 'Minnesota 05-2X with double HF exchange (56%)',
    category: 'DFT',
    subcategory: 'Meta-Hybrid',
    popular: false,
    needsBasis: true,
    isDft: true,
    rung: 'meta-hybrid',
  },
  {
    keyword: 'M06',
    name: 'M06',
    description: 'Minnesota 06 meta-hybrid — good for organometallics and thermochemistry',
    category: 'DFT',
    subcategory: 'Meta-Hybrid',
    popular: true,
    needsBasis: true,
    isDft: true,
    rung: 'meta-hybrid',
  },
  {
    keyword: 'M062X',
    name: 'M06-2X',
    description: 'Minnesota 06-2X with double HF exchange — excellent for main-group thermochemistry and kinetics',
    category: 'DFT',
    subcategory: 'Meta-Hybrid',
    popular: true,
    needsBasis: true,
    isDft: true,
    rung: 'meta-hybrid',
  },
  {
    keyword: 'M11',
    name: 'M11',
    description: 'Minnesota 11 range-separated meta-hybrid functional',
    category: 'DFT',
    subcategory: 'Meta-Hybrid',
    popular: false,
    needsBasis: true,
    isDft: true,
    rung: 'meta-hybrid',
    isRangeSeparated: true,
  },
  {
    keyword: 'MN15',
    name: 'MN15',
    description: 'Minnesota 15 meta-hybrid — broad applicability across chemistry',
    category: 'DFT',
    subcategory: 'Meta-Hybrid',
    popular: false,
    needsBasis: true,
    isDft: true,
    rung: 'meta-hybrid',
  },
  {
    keyword: 'BMK',
    name: 'BMK',
    description: 'Boese-Martin kinetics functional — designed for barrier heights',
    category: 'DFT',
    subcategory: 'Meta-Hybrid',
    popular: false,
    needsBasis: true,
    isDft: true,
    rung: 'meta-hybrid',
  },

  // ─── DFT - Range-Separated ──────────────────────────────────────────
  {
    keyword: 'CAM-B3LYP',
    name: 'CAM-B3LYP',
    description: 'Coulomb-attenuating B3LYP — improved charge-transfer and excited states',
    category: 'DFT',
    subcategory: 'Range-Separated',
    popular: true,
    needsBasis: true,
    isDft: true,
    rung: 'hybrid',
    isRangeSeparated: true,
  },
  {
    keyword: 'wB97',
    name: 'ωB97',
    description: 'Long-range corrected functional by Head-Gordon',
    category: 'DFT',
    subcategory: 'Range-Separated',
    popular: false,
    needsBasis: true,
    isDft: true,
    rung: 'hybrid',
    isRangeSeparated: true,
  },
  {
    keyword: 'wB97X',
    name: 'ωB97X',
    description: 'ωB97 with short-range exact exchange',
    category: 'DFT',
    subcategory: 'Range-Separated',
    popular: false,
    needsBasis: true,
    isDft: true,
    rung: 'hybrid',
    isRangeSeparated: true,
  },
  {
    keyword: 'wB97XD',
    name: 'ωB97X-D',
    description: 'ωB97X with empirical dispersion — excellent general-purpose functional',
    category: 'DFT',
    subcategory: 'Range-Separated',
    popular: true,
    needsBasis: true,
    isDft: true,
    rung: 'hybrid',
    isRangeSeparated: true,
    alreadyIncludesDispersion: true,
  },
  {
    keyword: 'LC-wPBE',
    name: 'LC-ωPBE',
    description: 'Long-range corrected PBE functional',
    category: 'DFT',
    subcategory: 'Range-Separated',
    popular: false,
    needsBasis: true,
    isDft: true,
    rung: 'hybrid',
    isRangeSeparated: true,
  },

  // ─── DFT - Double Hybrid ────────────────────────────────────────────
  {
    keyword: 'B2PLYP',
    name: 'B2PLYP',
    description: 'Grimme double-hybrid with MP2 correlation',
    category: 'DFT',
    subcategory: 'Double Hybrid',
    popular: false,
    needsBasis: true,
    isDft: true,
    rung: 'double-hybrid',
  },
  {
    keyword: 'B2PLYPD3',
    name: 'B2PLYPD3 (D3BJ included)',
    description: 'B2PLYP double hybrid with Grimme D3(BJ) dispersion built into the keyword — do not add EmpiricalDispersion',
    category: 'DFT',
    subcategory: 'Double Hybrid',
    popular: false,
    needsBasis: true,
    alreadyIncludesDispersion: true,
    isDft: true,
    rung: 'double-hybrid',
  },
  {
    keyword: 'mPW2PLYP',
    name: 'mPW2PLYP',
    description: 'Modified Perdew-Wang double-hybrid functional',
    category: 'DFT',
    subcategory: 'Double Hybrid',
    popular: false,
    needsBasis: true,
    isDft: true,
    rung: 'double-hybrid',
  },
  {
    keyword: 'DSDPBEP86',
    name: 'DSD-PBEP86',
    description: 'Dispersion-corrected, spin-component-scaled double hybrid',
    category: 'DFT',
    subcategory: 'Double Hybrid',
    popular: false,
    needsBasis: true,
    isDft: true,
    rung: 'double-hybrid',
    alreadyIncludesDispersion: true,
  },

  // ─── DFT - Dispersion-Included ──────────────────────────────────────
  {
    keyword: 'APFD',
    name: 'APFD',
    description: 'Austin-Petersson-Frisch functional with built-in dispersion',
    category: 'DFT',
    subcategory: 'Dispersion-Included',
    popular: false,
    needsBasis: true,
    isDft: true,
    rung: 'GGA',
    alreadyIncludesDispersion: true,
  },
  {
    keyword: 'B97D',
    name: 'B97-D',
    description: 'Grimme B97 with built-in dispersion correction',
    category: 'DFT',
    subcategory: 'Dispersion-Included',
    popular: false,
    needsBasis: true,
    isDft: true,
    rung: 'GGA',
    alreadyIncludesDispersion: true,
  },

  // ─── Ab Initio - Hartree-Fock ────────────────────────────────────────
  {
    keyword: 'HF',
    name: 'Hartree-Fock',
    description: 'Hartree-Fock self-consistent field method — no electron correlation',
    category: 'Ab Initio',
    subcategory: 'Hartree-Fock',
    popular: true,
    needsBasis: true,
    isDft: false,
    rung: 'HF',
  },

  // ─── Ab Initio - Post-HF ────────────────────────────────────────────
  {
    keyword: 'MP2',
    name: 'MP2',
    description: 'Second-order Møller-Plesset perturbation theory',
    category: 'Ab Initio',
    subcategory: 'Post-HF',
    popular: true,
    needsBasis: true,
    isDft: false,
    rung: 'post-HF',
    costExponent: 5, // N-scaling for the heuristic cost panel
  },
  {
    keyword: 'MP3',
    name: 'MP3',
    description: 'Third-order Møller-Plesset perturbation theory',
    category: 'Ab Initio',
    subcategory: 'Post-HF',
    popular: false,
    needsBasis: true,
    isDft: false,
    rung: 'post-HF',
    costExponent: 6, // N-scaling for the heuristic cost panel
  },
  {
    keyword: 'MP4',
    name: 'MP4',
    description: 'Fourth-order Møller-Plesset perturbation theory',
    category: 'Ab Initio',
    subcategory: 'Post-HF',
    popular: false,
    needsBasis: true,
    isDft: false,
    rung: 'post-HF',
    costExponent: 7, // N-scaling for the heuristic cost panel
  },
  {
    keyword: 'CCSD',
    name: 'CCSD',
    description: 'Coupled-cluster singles and doubles',
    category: 'Ab Initio',
    subcategory: 'Post-HF',
    popular: false,
    needsBasis: true,
    isDft: false,
    rung: 'post-HF',
    costExponent: 6, // N-scaling for the heuristic cost panel
  },
  {
    keyword: 'CCSD(T)',
    name: 'CCSD(T)',
    description: 'Coupled-cluster with perturbative triples — the "gold standard" of quantum chemistry',
    category: 'Ab Initio',
    subcategory: 'Post-HF',
    popular: true,
    needsBasis: true,
    isDft: false,
    rung: 'post-HF',
    costExponent: 7, // N-scaling for the heuristic cost panel
  },
  {
    keyword: 'CISD',
    name: 'CISD',
    description: 'Configuration interaction singles and doubles',
    category: 'Ab Initio',
    subcategory: 'Post-HF',
    popular: false,
    needsBasis: true,
    isDft: false,
    rung: 'post-HF',
    costExponent: 6, // N-scaling for the heuristic cost panel
  },
  {
    keyword: 'QCISD',
    name: 'QCISD',
    description: 'Quadratic configuration interaction singles and doubles',
    category: 'Ab Initio',
    subcategory: 'Post-HF',
    popular: false,
    needsBasis: true,
    isDft: false,
    rung: 'post-HF',
    costExponent: 6, // N-scaling for the heuristic cost panel
  },
  {
    keyword: 'QCISD(T)',
    name: 'QCISD(T)',
    description: 'QCISD with perturbative triples correction',
    category: 'Ab Initio',
    subcategory: 'Post-HF',
    popular: false,
    needsBasis: true,
    isDft: false,
    rung: 'post-HF',
    costExponent: 7, // N-scaling for the heuristic cost panel
  },

  // ─── Ab Initio - Multi-Reference ────────────────────────────────────
  {
    keyword: 'CASSCF',
    name: 'CASSCF',
    description: 'Complete active space self-consistent field — for multi-reference problems',
    category: 'Ab Initio',
    subcategory: 'Multi-Reference',
    popular: false,
    needsBasis: true,
    isDft: false,
    rung: 'post-HF',
  },
  {
    keyword: 'CIS',
    name: 'CIS',
    description: 'Configuration interaction singles — simple excited-state method',
    category: 'Ab Initio',
    subcategory: 'Multi-Reference',
    popular: false,
    needsBasis: true,
    isDft: false,
    rung: 'post-HF',
    costExponent: 4, // N-scaling for the heuristic cost panel
  },
  {
    keyword: 'SAC-CI',
    name: 'SAC-CI',
    description: 'Symmetry-adapted cluster configuration interaction for excited states',
    category: 'Ab Initio',
    subcategory: 'Multi-Reference',
    popular: false,
    needsBasis: true,
    isDft: false,
    rung: 'post-HF',
    costExponent: 6, // N-scaling for the heuristic cost panel
  },

  // ─── Composite ──────────────────────────────────────────────────────
  {
    keyword: 'CBS-QB3',
    name: 'CBS-QB3',
    description: 'Complete basis set method — accurate thermochemistry at moderate cost',
    category: 'Composite',
    subcategory: 'CBS',
    popular: true,
    needsBasis: false,
    isDft: false,
    rung: 'composite',
  },
  {
    keyword: 'CBS-4M',
    name: 'CBS-4M',
    description: 'CBS minimal basis set extrapolation — faster, less accurate than CBS-QB3',
    category: 'Composite',
    subcategory: 'CBS',
    popular: false,
    needsBasis: false,
    isDft: false,
    rung: 'composite',
  },
  {
    keyword: 'CBS-APNO',
    name: 'CBS-APNO',
    description: 'CBS with atomic pair natural orbitals — highest accuracy CBS variant',
    category: 'Composite',
    subcategory: 'CBS',
    popular: false,
    needsBasis: false,
    isDft: false,
    rung: 'composite',
  },
  {
    keyword: 'G3',
    name: 'G3',
    description: 'Gaussian-3 composite method for thermochemical predictions',
    category: 'Composite',
    subcategory: 'Gaussian-N',
    popular: false,
    needsBasis: false,
    isDft: false,
    rung: 'composite',
  },
  {
    keyword: 'G3MP2',
    name: 'G3MP2',
    description: 'G3 with reduced MP2 treatment — faster alternative',
    category: 'Composite',
    subcategory: 'Gaussian-N',
    popular: false,
    needsBasis: false,
    isDft: false,
    rung: 'composite',
  },
  {
    keyword: 'G3B3',
    name: 'G3B3',
    description: 'G3 using B3LYP geometries and zero-point energies',
    category: 'Composite',
    subcategory: 'Gaussian-N',
    popular: false,
    needsBasis: false,
    isDft: false,
    rung: 'composite',
  },
  {
    keyword: 'G3MP2B3',
    name: 'G3MP2B3',
    description: 'G3MP2 using B3LYP geometries',
    category: 'Composite',
    subcategory: 'Gaussian-N',
    popular: false,
    needsBasis: false,
    isDft: false,
    rung: 'composite',
  },
  {
    keyword: 'G4',
    name: 'G4',
    description: 'Gaussian-4 composite method — improved accuracy over G3',
    category: 'Composite',
    subcategory: 'Gaussian-N',
    popular: true,
    needsBasis: false,
    isDft: false,
    rung: 'composite',
  },
  {
    keyword: 'G4MP2',
    name: 'G4MP2',
    description: 'G4 with reduced perturbation treatment — cost-effective thermochemistry',
    category: 'Composite',
    subcategory: 'Gaussian-N',
    popular: false,
    needsBasis: false,
    isDft: false,
    rung: 'composite',
  },
  {
    keyword: 'W1BD',
    name: 'W1BD',
    description: 'Weizmann-1 with Brueckner doubles — sub-kcal/mol accuracy',
    category: 'Composite',
    subcategory: 'Weizmann',
    popular: false,
    needsBasis: false,
    isDft: false,
    rung: 'composite',
  },

  // ─── Semi-Empirical ─────────────────────────────────────────────────
  {
    keyword: 'AM1',
    name: 'AM1',
    description: 'Austin Model 1 semi-empirical method',
    category: 'Semi-Empirical',
    subcategory: 'Semi-Empirical',
    popular: false,
    needsBasis: false,
    isDft: false,
    rung: 'semi-empirical',
  },
  {
    keyword: 'PM3',
    name: 'PM3',
    description: 'Parameterized Model 3 semi-empirical method',
    category: 'Semi-Empirical',
    subcategory: 'Semi-Empirical',
    popular: false,
    needsBasis: false,
    isDft: false,
    rung: 'semi-empirical',
  },
  {
    keyword: 'PM6',
    name: 'PM6',
    description: 'Parameterized Model 6 — improved semi-empirical method',
    category: 'Semi-Empirical',
    subcategory: 'Semi-Empirical',
    popular: false,
    needsBasis: false,
    isDft: false,
    rung: 'semi-empirical',
  },
  {
    keyword: 'PM7',
    name: 'PM7',
    description: 'Parameterized Model 7 — latest in PM series',
    category: 'Semi-Empirical',
    subcategory: 'Semi-Empirical',
    popular: false,
    needsBasis: false,
    isDft: false,
    rung: 'semi-empirical',
  },
  {
    keyword: 'MNDO',
    name: 'MNDO',
    description: 'Modified Neglect of Diatomic Overlap',
    category: 'Semi-Empirical',
    subcategory: 'Semi-Empirical',
    popular: false,
    needsBasis: false,
    isDft: false,
    rung: 'semi-empirical',
  },
  {
    keyword: 'INDO',
    name: 'INDO',
    description: 'Intermediate Neglect of Differential Overlap',
    category: 'Semi-Empirical',
    subcategory: 'Semi-Empirical',
    popular: false,
    needsBasis: false,
    isDft: false,
    rung: 'semi-empirical',
  },

  // ─── Molecular Mechanics ────────────────────────────────────────────
  {
    keyword: 'UFF',
    name: 'UFF',
    description: 'Universal Force Field — covers entire periodic table',
    category: 'Molecular Mechanics',
    subcategory: 'Molecular Mechanics',
    popular: false,
    needsBasis: false,
    isDft: false,
    rung: 'MM',
  },
  {
    keyword: 'AMBER',
    name: 'AMBER',
    description: 'Assisted Model Building with Energy Refinement — biomolecular force field',
    category: 'Molecular Mechanics',
    subcategory: 'Molecular Mechanics',
    popular: false,
    needsBasis: false,
    isDft: false,
    rung: 'MM',
  },
  {
    keyword: 'DREIDING',
    name: 'DREIDING',
    description: 'DREIDING force field for organic and main-group molecules',
    category: 'Molecular Mechanics',
    subcategory: 'Molecular Mechanics',
    popular: false,
    needsBasis: false,
    isDft: false,
    rung: 'MM',
  },
];

/** Top-level method categories for grouping in the UI. */
export const methodCategories = [
  'DFT',
  'Ab Initio',
  'Composite',
  'Semi-Empirical',
  'Molecular Mechanics',
];

/**
 * Look up a method definition by its route keyword (case-insensitive).
 *
 * @param {string} keyword - Route keyword, e.g. 'B2PLYPD3'.
 * @returns {Object|undefined} The matching method definition, if any.
 */
export function getMethodByKeyword(keyword) {
  if (typeof keyword !== 'string' || keyword.trim() === '') return undefined;
  const needle = keyword.trim().toUpperCase();
  return methods.find((m) => m.keyword.toUpperCase() === needle);
}

/**
 * Whether a method keyword already requests an empirical dispersion model by
 * default, so that adding `EmpiricalDispersion=...` would double-count it.
 *
 * @param {string} keyword - Route keyword, e.g. 'B2PLYPD3'.
 * @returns {boolean}
 */
export function methodIncludesDispersion(keyword) {
  const method = getMethodByKeyword(keyword);
  return method?.alreadyIncludesDispersion === true;
}

export default methods;
