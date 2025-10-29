// D:\smartpitch\backend\services\audit.js
// Module d'audit — vérifie la cohérence énergétique & économique des scénarios

const EPS = 1e-6;
const inRange = (v, min, max) => typeof v === "number" && v >= min - EPS && v <= max + EPS;
const sum = arr => (Array.isArray(arr) ? arr.reduce((a, b) => a + (Number(b) || 0), 0) : 0);
const isArrayLen = (arr, n = 12) => Array.isArray(arr) && arr.length === n;

function checkMonthlySums(sc, issues) {
  const m = sc.monthly || {};
  const keys = ["prod_kwh","conso_kwh","autocons_kwh","surplus_kwh","from_grid_kwh","to_grid_kwh"];
  for (const k of keys) {
    if (!isArrayLen(m[k])) {
      issues.push({severity:"error", code:`MONTH_LEN_${k.toUpperCase()}`, msg:`${k} doit contenir 12 valeurs.`});
    }
    if ((m[k] || []).some(v => v < -EPS)) {
      issues.push({severity:"error", code:`MONTH_NEG_${k.toUpperCase()}`, msg:`${k} contient des valeurs négatives.`});
    }
  }
}

function checkAnnualConsistency(sc, issues) {
  const m = sc.monthly || {};
  const a = sc.annual || {};
  const annualFromMonths = {
    prod_kwh: sum(m.prod_kwh),
    conso_kwh: sum(m.conso_kwh),
    autocons_kwh: sum(m.autoconso_kwh || m.autoconso || m.autocons_kwh), // tolère renommage accidentel
    surplus_kwh: sum(m.surplus_kwh),
    from_grid_kwh: sum(m.from_grid_kwh),
    to_grid_kwh: sum(m.to_grid_kwh),
  };
  // correctif: si autoconso a été nommée "autocons_kwh", uniformise
  if (!Array.isArray(m.autoconso_kwh) && Array.isArray(m.autoconso)) annualFromMonths.autoconso_kwh = sum(m.autoconso);

  for (const k of Object.keys(annualFromMonths)) {
    const target = Number((a || {})[k] || 0);
    const calc = annualFromMonths[k];
    const diff = Math.abs(calc - target);
    const tol = Math.max(0.001 * Math.max(1, target), 0.05); // tolérance adaptative
    if (diff > tol) {
      issues.push({severity:"error", code:`ANNUAL_MISMATCH_${k.toUpperCase()}`, msg:`Somme mensuelle de ${k} (${calc.toFixed(2)}) ≠ annuel (${target.toFixed(2)}).`});
    }
  }
  // identités énergie (±0,5 kWh)
  if (Math.abs(a.prod_kwh - (a.autocons_kwh + a.to_grid_kwh)) > 0.5) {
    issues.push({severity:"error", code:"ID_PROD", msg:"prod_kwh doit = autocons_kwh + to_grid_kwh (±0,5 kWh)."});
  }
  if (Math.abs(a.conso_kwh - (a.autocons_kwh + a.from_grid_kwh)) > 0.5) {
    issues.push({severity:"error", code:"ID_CONSO", msg:"conso_kwh doit = autocons_kwh + from_grid_kwh (±0,5 kWh)."});
  }
  // ratios
  const autoprod_pct = a.prod_kwh > EPS ? (a.autocons_kwh / a.prod_kwh) * 100 : 0;
  const autonomie_pct = a.conso_kwh > EPS ? (a.autocons_kwh / a.conso_kwh) * 100 : 0;
  if (!inRange(autoprod_pct, 0, 100)) {
    issues.push({severity:"error", code:"RATIO_AUTOPROD", msg:`Autoproduction % hors bornes (0–100) : ${autoprod_pct.toFixed(2)}%.`});
  }
  if (!inRange(autonomie_pct, 0, 100)) {
    issues.push({severity:"error", code:"RATIO_AUTONOMIE", msg:`Autonomie % hors bornes (0–100) : ${autonomie_pct.toFixed(2)}%.`});
  }
}

function checkKwcAndOA(sc, issues) {
  const kwc = Number(sc.kwc || 0);
  if (kwc <= 0) {
    issues.push({severity:"error", code:"KWC_ZERO", msg:"Puissance kWc doit être > 0."});
  }
  const oa = Number(((sc.pricing || {}).oa_centaire_eur_kwh) || 0);
  const expected = kwc < 9 ? 0.04 : 0.0617;
  if (Math.abs(oa - expected) > 0.0005) {
    issues.push({severity:"error", code:"OA_RATE", msg:`Tarif OA incohérent : ${oa} €/kWh (attendu ${expected} €/kWh selon kWc).`});
  }
}

function checkPrime(sc, issues) {
  const kwc = Number(sc.kwc || 0);
  const prime = Number(((sc.pricing || {}).prime_autoconso_eur) || 0);
  const expected = kwc < 9 ? 80 * kwc : 180 * kwc;
  if (Math.abs(prime - expected) > 1) {
    issues.push({severity:"error", code:"PRIME", msg:`Prime autoconsommation inattendue : ${prime.toFixed(2)} € (attendu ~${expected.toFixed(2)} €).`});
  }
}

function checkBattery(sc, issues) {
  const b = (sc.pricing || {}).battery || {};
  const units = Number(b.units || 0);
  const unitKwh = Number(b.unit_kwh || 0);
  const unitPrice = Number(b.unit_price_ht || 0);
  if (units < 0 || units > 3) {
    issues.push({severity:"error", code:"BAT_UNITS", msg:`Nombre de batteries (${units}) hors bornes (0–3).`});
  }
  if (units > 0) {
    if (unitKwh <= 0) issues.push({severity:"error", code:"BAT_KWH", msg:"Capacité unitaire batterie doit être > 0 kWh."});
    const expected = 3750;
    if (Math.abs(unitPrice - expected) > 1) {
      issues.push({severity:"error", code:"BAT_PRICE", msg:`Prix batterie unitaire non conforme : ${unitPrice} € HT (attendu ${expected} € HT).`});
    }
  }
}

function checkEconomics(sc, issues) {
  const y25 = sc.years25 || {};
  if (y25.gains_total_eur === undefined || isNaN(Number(y25.gains_total_eur))) {
    issues.push({severity:"error", code:"Y25_GAINS", msg:"gains_total_eur manquant ou invalide (25 ans)."});
  }
  if (y25.lcoe_ct_kwh !== undefined && Number(y25.lcoe_ct_kwh) < 0) {
    issues.push({severity:"error", code:"Y25_LCOE", msg:"LCOE ne peut pas être négatif."});
  }
  if (y25.roi_years !== undefined && Number(y25.roi_years) <= 0) {
    issues.push({severity:"warn", code:"ROI_NON_POSITIF", msg:"ROI (années) non positif — vérifier les entrées prix/conso."});
  }
  if (y25.tri_pct !== undefined && Number(y25.tri_pct) < -100) {
    issues.push({severity:"warn", code:"TRI_TROP_BAS", msg:"TRI très bas — vérifier hypothèses (inflation, tarifs, CAPEX)."});
  }
}

function auditScenario(sc) {
  const issues = [];
  checkMonthlySums(sc, issues);
  checkAnnualConsistency(sc, issues);
  checkKwcAndOA(sc, issues);
  checkPrime(sc, issues);
  checkBattery(sc, issues);
  checkEconomics(sc, issues);
  return issues;
}

function flattenSelections(simulation) {
  const sel = simulation?.selections || {};
  const keys = Object.keys(sel);
  if (!keys.length) return [];
  return keys.map(k => ({ key: k, data: sel[k] }));
}

function auditSimulation(simulation) {
  const all = [];
  for (const { key, data } of flattenSelections(simulation)) {
    const issues = auditScenario(data).map(it => ({ ...it, scenario: key }));
    all.push(...issues);
  }
  const audit_ok = !all.some(x => x.severity === "error");
  return { audit_ok, issues: all };
}

module.exports = { auditSimulation };
