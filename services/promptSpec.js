// D:\smartpitch\backend\services\promptSpec.js
//
// Spécification d’entrée/sortie + générateur de prompt
// Aligné avec :
// - Prompt DOCX "Comparateur Intelligent Solarglobe 25 ans – TVA corrigée X10"
// - Cahier des charges v2 (KPIs ROI/TRI/LCOE, prime année 1, OA différenciée, dégrad -0,5%, +4% prix)
// Réfs: carte v2 (sections Prompts & KPI) et DOCX tarifs/TVA/étapes.


// ---- 1) Schéma d’entrée (validation ultra-simple) ----
function validateInput(payload) {
  const required = [
    'client', 'installation', 'toit', 'pvgis', 'consommation', 'eco', 'pricing'
  ];
  for (const key of required) {
    if (!(key in payload)) return { ok: false, error: `Champ manquant: ${key}` };
  }
  // contrôles minimaux
  if (!Array.isArray(payload.pvgis.production_mensuelle_kwh) || payload.pvgis.production_mensuelle_kwh.length !== 12) {
    return { ok: false, error: 'pvgis.production_mensuelle_kwh doit contenir 12 valeurs.' };
  }
  if (!Array.isArray(payload.consommation.mensuelle_kwh) || payload.consommation.mensuelle_kwh.length !== 12) {
    return { ok: false, error: 'consommation.mensuelle_kwh doit contenir 12 valeurs.' };
  }
  return { ok: true };
}


// ---- 2) Modèle de sortie attendu ----
const OUTPUT_SPEC = {
  annee1: {
    mois: [{ mois: "Jan", prod: 0, conso: 0, autoconso: 0, surplus: 0, import: 0, eco_eur: 0, oa_eur: 0 }],
    totaux: {
      prod: 0, conso: 0, autoconso: 0, surplus: 0, import: 0,
      economie_auto: 0, revenu_oa: 0, prime: 0,
      autoconso_pct: 0, autoprod_pct: 0, conso_reseau_kwh: 0
    }
  },
  ans25: [{ annee: 1, prod: 0, economie_auto: 0, revenu_oa: 0, gains_totaux: 0 }],
  capex_ttc: { materiel_ttc: 0, pose_ttc: 0, total_ttc: 0 },
  kpi: {
    roi_annees: 0, roi_annuel_pct: 0, tri_pct: 0, lcoe_eur_kwh: 0,
    autoconso_pct: 0, autoprod_pct: 0, gains_annee1: 0, gains_25ans: 0
  },
  audit: { ok: true, messages: [] },
  scenario_gagnant: { code: "A1|A2|B1|B2", raison: "" }
};


// ---- 3) Générateur de prompt (string) ----
function buildPrompt(payload) {
  const header = [
    'PROMPT – Comparateur Intelligent Solarglobe (25 ans – LONGi X10 – TVA corrigée).',
    'Objectif : calculer 4 scénarios (A1/A2/B1/B2) avec audit automatique, sur 25 ans.',
    'Ne fais AUCUNE hypothèse non fournie. Utilise exactement les 12 mois conso et prod PVGIS.',
    'Post-traitement réalisme : appliquer p = 0,85 sur l’autoconsommation annuelle (sans pilotage).',
    'Règles financières :',
    '- Tarif OA : 0,04 €/kWh pour les installations < 9 kWc, et 0,0617 €/kWh pour ≥ 9 kWc.',
    '- Prime à l’autoconsommation (année 1 uniquement) : 80 €/kWc pour < 9 kWc, 180 €/kWc pour ≥ 9 kWc.',
    '- Dégradation PV = −0,5 %/an ; Prix électricité +4 %/an ; OA fixe selon la tranche de puissance.',
    'TVA : 20 % matériel (modules X10, MC-100, Batterie, Gestion) ; 10 % pose.',
    'Sortie stricte en JSON conforme au schéma ci-dessous.'
  ].join('\n');

  // Tarifs / catalogue (issus des règles Solarglobe)
  const catalogue = {
    module_x10: payload?.pricing?.materiel_ht?.module_x10 ?? 0, // à fournir côté app (Éco/Pro)
    mc100: 1650,
    batterie7kwh: 4590,
    gestion: 710,
    pose_ht: payload?.pricing?.pose_ht ?? { k3:1500, k6:2200, k9:2700, supp_par_kwc:300 }
  };

  const inputJsonPretty = JSON.stringify(payload, null, 2);
  const outputSpecPretty = JSON.stringify(OUTPUT_SPEC, null, 2);
  const cataloguePretty = JSON.stringify(catalogue, null, 2);

  return `${header}

[ENTRÉE_JSON]
${inputJsonPretty}

[CATALOGUE_ET_TARIFS]
${cataloguePretty}

[CONTRAINTES_DE_CALCUL]
- Autoconso_mois = min(prod_mois, conso_mois); Surplus_mois = prod - autoconso; Import_mois = conso - autoconso.
- Applique p=0,85 sur l’autoconso annuelle pour le réalisme (p*Σmin(prod, conso)).
- Économie auto (€/an) = Σ autoconso × prix_kWh.
- Revente OA (€/an) :
    • 0,04 €/kWh si puissance < 9 kWc
    • 0,0617 €/kWh si puissance ≥ 9 kWc
- Prime (année 1) :
    • 80 €/kWc si puissance < 9 kWc
    • 180 €/kWc si puissance ≥ 9 kWc
- Projection 25 ans : dégrad PV −0,5 %/an ; prix élec +4 %/an ; OA fixe selon la tranche.
- CAPEX TTC = (Matériel HT × 1,20) + (Pose HT × 1,10). Matériel = X10 + MC-100 + Batterie + Gestion.
- KPIs : Autoconso %, Autoprod %, Gains A1 / 25 ans, ROI (années), ROI annuel %, TRI %, LCOE €/kWh.

[AUDIT_AUTOMATIQUE_BLOQUANT]
1) Σ mois = annuel (prod & conso) ±1 kWh
2) Autoconso ≤ Prod & ≤ Conso (mois)
3) Σ(autoconso+surplus) = Σ(prod) ±0,1 %
4) Σ(autoconso+import) = Σ(conso) ±0,1 %
5) Éco (€/an) = autoconso × prix ±1 € ; OA (€/an) = surplus × tarif selon tranche ±1 €
6) Prime = règle 80€/kWc (<9) ou 180€/kWc (≥9)
7) Cumul 25 ans = somme années (±1 €)
8) Ratios entre 0–100 % (aucun zéro diviseur)
9) Si audit échoue → {"audit":{"ok":false,"messages":[...]}} sans autre texte.

[PUISSANCES_À_COMPARER]
- Génère des puissances candidates par pas de 1 panneau X10 (485 Wc).
- Sélectionne 2 puissances distinctes (écart ≥ 10 % en kWc) optimales (ROI/TRI/gains/budget).
- Scénarios: A1 (A sans batt), A2 (A avec batt 7 kWh), B1 (B sans batt), B2 (B avec batt 7 kWh).

[FORMAT_SORTIE_JSON_OBLIGATOIRE]
${outputSpecPretty}

[INSTRUCTION FINALE]
- Ne réponds QUE par l’objet JSON (aucun texte hors JSON).
- Si l’audit échoue, renvoie {"audit":{"ok":false,"messages":[...]}} et n’écris rien d’autre.
`;
}

module.exports = { validateInput, buildPrompt, OUTPUT_SPEC };
