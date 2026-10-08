/**
 * Property methods on the roadmap, shown in the Model group and on the flowsheet's Method page as
 * "not available yet" (locked, with what each is for). Open, established models with published
 * parameter sets; none of them is implemented, so none can be chosen. References by author and
 * year; each needs its own proposal before it is built (AGENTS.md, "Rules for code").
 */
export const FUTURE_MODELS = {
  // liquid activity coefficients, next to NRTL and UNIQUAC
  activity: [
    { id: "wilson", label: "Wilson", note: "Wilson (1964): two parameters per pair, often the best fit of vapour-liquid data of miscible mixtures; it cannot describe two liquids. Not available yet." },
    { id: "unifac", label: "UNIFAC", note: "UNIFAC group contribution (Fredenslund, Jones and Prausnitz, 1975; modified UNIFAC, Dortmund): predicts pairs without data, labelled 'predicted'. Waiting for the parameter licence (proposal 0008, Part A). Not available yet." },
  ],
  // equations of state, next to Peng-Robinson and SRK
  eos: [
    { id: "pcsaft", label: "PC-SAFT", note: "PC-SAFT (Gross and Sadowski, 2001): chains, association and polar molecules; open parameter sets in Clapeyron.jl and FeOs. Not available yet." },
    { id: "cpa", label: "CPA", note: "Cubic-Plus-Association (Kontogeorgis et al., 1996): SRK plus hydrogen bonding, for water, alcohols, glycols and acids at high pressure. Not available yet." },
  ],
  // mixtures with ions (salts, acids, bases in water)
  electrolyte: [
    { id: "enrtl", label: "eNRTL", note: "Electrolyte NRTL (Chen et al., 1982): ions in water and mixed solvents, salt solubility, pH. Not available yet." },
    { id: "pitzer", label: "Pitzer", note: "Pitzer equations (Pitzer, 1973): activity coefficients of ions in concentrated aqueous solutions. Not available yet." },
  ],
  // polymers (a chain length, not a boiling point)
  polymer: [
    { id: "flory-huggins", label: "Flory–Huggins", note: "Flory–Huggins (Flory, 1942; Huggins, 1941): polymer + solvent mixtures, swelling and precipitation. Not available yet." },
    { id: "pcsaft-polymer", label: "PC-SAFT polymers", note: "PC-SAFT for polymers (Gross and Sadowski, 2002): polymer + solvent phase behaviour at any pressure. Not available yet." },
  ],
};
