/**
 * Common solvents for implicit solvation models in Gaussian.
 * Each solvent: { name, keyword, dielectric, popular }
 *
 * Dielectric constants (ε) at 25 °C from standard references.
 * Keywords match Gaussian's SCRF solvent names.
 */

export const solvents = [
  {
    name: 'Water',
    keyword: 'Water',
    dielectric: 78.3553,
    popular: true,
  },
  {
    name: 'Methanol',
    keyword: 'Methanol',
    dielectric: 32.613,
    popular: true,
  },
  {
    name: 'Ethanol',
    keyword: 'Ethanol',
    dielectric: 24.852,
    popular: true,
  },
  {
    name: '1-Propanol',
    keyword: 'n-Propanol',
    dielectric: 20.524,
    popular: false,
  },
  {
    name: '2-Propanol',
    keyword: 'IsoPropanol',
    dielectric: 19.264,
    popular: false,
  },
  {
    name: '1-Butanol',
    keyword: 'n-Butanol',
    dielectric: 17.332,
    popular: false,
  },
  {
    name: 'Acetic Acid',
    keyword: 'AceticAcid',
    dielectric: 6.2528,
    popular: false,
  },
  {
    name: 'Acetone',
    keyword: 'Acetone',
    dielectric: 20.493,
    popular: true,
  },
  {
    name: 'Acetonitrile',
    keyword: 'Acetonitrile',
    dielectric: 35.688,
    popular: true,
  },
  {
    name: 'Benzene',
    keyword: 'Benzene',
    dielectric: 2.2706,
    popular: false,
  },
  {
    name: 'Carbon Tetrachloride',
    keyword: 'CarbonTetraChloride',
    dielectric: 2.228,
    popular: false,
  },
  {
    name: 'Chloroform',
    keyword: 'Chloroform',
    dielectric: 4.7113,
    popular: true,
  },
  {
    name: 'Cyclohexane',
    keyword: 'CycloHexane',
    dielectric: 2.0165,
    popular: false,
  },
  {
    name: '1,2-Dichloroethane',
    keyword: 'DiChloroEthane',
    dielectric: 10.125,
    popular: false,
  },
  {
    name: 'Dichloromethane (DCM)',
    keyword: 'DiChloroMethane',
    dielectric: 8.93,
    popular: true,
  },
  {
    name: 'Diethyl Ether',
    keyword: 'DiethylEther',
    dielectric: 4.24,
    popular: true,
  },
  {
    name: 'N,N-Dimethylformamide (DMF)',
    keyword: 'DiMethylFormamide',
    dielectric: 37.219,
    popular: true,
  },
  {
    name: 'Dimethyl Sulfoxide (DMSO)',
    keyword: 'DMSO',
    dielectric: 46.826,
    popular: true,
  },
  {
    name: 'Ethyl Acetate',
    keyword: 'EthylAcetate',
    dielectric: 5.9867,
    popular: false,
  },
  {
    name: 'Heptane',
    keyword: 'Heptane',
    dielectric: 1.9113,
    popular: false,
  },
  {
    name: 'Hexane',
    keyword: 'n-Hexane',
    dielectric: 1.8819,
    popular: true,
  },
  {
    name: 'Nitromethane',
    keyword: 'NitroMethane',
    dielectric: 36.562,
    popular: false,
  },
  {
    name: 'Pentane',
    keyword: 'n-Pentane',
    dielectric: 1.8371,
    popular: false,
  },
  {
    name: 'Pyridine',
    keyword: 'Pyridine',
    dielectric: 12.978,
    popular: false,
  },
  {
    name: 'Tetrahydrofuran (THF)',
    keyword: 'THF',
    dielectric: 7.4257,
    popular: true,
  },
  {
    name: 'Toluene',
    keyword: 'Toluene',
    dielectric: 2.3741,
    popular: true,
  },
  {
    name: 'Xylenes',
    keyword: 'o-Xylene',
    dielectric: 2.5454,
    popular: false,
  },
  {
    name: '1,4-Dioxane',
    keyword: '1,4-Dioxane',
    dielectric: 2.2099,
    popular: false,
  },
  {
    name: 'Aniline',
    keyword: 'Aniline',
    dielectric: 6.8882,
    popular: false,
  },
  {
    name: 'Formic Acid',
    keyword: 'MethanoicAcid',
    dielectric: 51.1,
    popular: false,
  },
];

/** Available implicit solvation models. */
export const solvationModels = [
  {
    keyword: 'PCM',
    name: 'PCM (Polarizable Continuum Model)',
    description: 'Default implicit solvation model in Gaussian',
  },
  {
    keyword: 'SMD',
    name: 'SMD',
    description: 'Universal solvation model based on solute electron density (recommended)',
  },
];

export default solvents;
