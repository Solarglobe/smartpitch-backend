// backend/controllers/calcController.js

/**
 * Contrôleur principal de calcul SmartPitch
 * - OA: 0.04 €/kWh <= 9 kWc ; 0.0617 €/kWh > 9 kWc
 * - Batterie: 7 kWh/unité, 3 750 € HT l'unité, max 3 unités
 * - Forçage: kwc / variant / battery_units / oa_enabled
 * - Tempo: on peut passer un prix moyen tempo_avg en entrée
 */

// === Validation du format de réponse SmartPitch ===
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const fs = require('fs');
const path = require('path');

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

let validateCalc = null;
(() => {
  try {
    const schemaPath = path.join(__dirname, '..', 'schemas', 'calcResponse.schema.json');
    const schemaCalc = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    validateCalc = ajv.compile(schemaCalc);
    console.log('✅ Schéma SmartPitch chargé & compilé pour validation des réponses.');
  } catch (e) {
    console.error('⚠️ Impossible de charger/compilier le schéma SmartPitch (validation désactivée) :', e?.message || e);
  }
})();

// ===== Helpers =====
function number(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function arr12(a, d = 0) {
  if (Array.isArray(a) && a.length === 12) return a.map(x => number(x, d));
  return new Array(12).fill(d);
}

function prixOA(kwc) {
  return kwc > 9 ? 0.0617 : 0.04;
}

function capexTTCPvc(kwc) {
  // modèle simple : 1 350 €/kWc mat. + 1 650 / 2 200 / 2 700 € pose
  const materiel = kwc * 1350;
  const pose = kwc <= 3.5 ? 1650 : kwc <= 6.5 ? 2200 : 2700;
  return { materiel_ttc: Math.round(materiel), pose_ttc: pose, total_ttc: Math.round(materiel + pose) };
}

function capexBatterie(units) {
  // 3 750 € HT / unité ; TVA 20% (ajuster si besoin)
  const ht = 3750 * units;
  const ttc = Math.round(ht * 1.2);
  return { ht, ttc };
}

function moisLabel(i) {
  return ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'][i];
}

// ===== Construction d’un scénario (avec/sans batterie) =====
function buildScenario({ label, kwc, consoMensuelle, prodMensuelleRef, price_kwh, oa_enabled, battery_units }) {
  // production proportionnelle à une référence (refKwc)
  const refKwc = 3.4; // base utilisée pour nos exemples
  const scale = kwc / refKwc;

  const prodMensuelle = prodMensuelleRef.map(v => number(v) * scale);
  const conso = consoMensuelle.map(v => number(v));

  // batterie : tampon mensualisé simplifié (capacité exprimée en kWh/mois)
  const capacity_kwh = 7 * Math.min(Math.max(number(battery_units, 0), 0), 3);

  const mois = [];
  let totalProd = 0, totalConso = 0, totalAuto = 0, totalImport = 0, totalSurplus = 0;
  let ecoAuto = 0, revenuOA = 0;

  for (let i = 0; i < 12; i++) {
    const p = prodMensuelle[i];
    const c = conso[i];

    // Base sans batterie
    const auto_base = Math.min(p, c);
    let surplus = Math.max(p - c, 0);
    const deficit = Math.max(c - p, 0);

    // Batterie = simple transfert intra-mensuel limité par: capacité, surplus, déficit
    let transfer = 0;
    if (capacity_kwh > 0) {
      transfer = Math.min(capacity_kwh, surplus, deficit);
    }

    // Autoconso réelle après usage batterie (ne dépasse jamais la conso)
    const autoconso = auto_base + transfer;

    // Surplus résiduel après "charge+décharge" virtuelle
    surplus -= transfer;

    // Import réseau (assure l’identité c = autoconso + import)
    const fromGrid = Math.max(c - autoconso, 0);

    // Économies et OA
    const eco_eur = autoconso * price_kwh;
    const oa_rate = oa_enabled ? prixOA(kwc) : 0;
    const oa_eur = surplus * oa_rate;

    mois.push({
      mois: moisLabel(i),
      prod: +p.toFixed(2),
      conso: +c.toFixed(2),
      autoconso: +autoconso.toFixed(2),
      surplus: +surplus.toFixed(2),
      import: +fromGrid.toFixed(2),
      eco_eur: +eco_eur.toFixed(2),
      oa_eur: +oa_eur.toFixed(2),
    });

    // Accumulations (non arrondies pour préserver les identités)
    totalProd += p;
    totalConso += c;
    totalAuto += autoconso;
    totalImport += fromGrid;
    totalSurplus += surplus;
    ecoAuto += eco_eur;
    revenuOA += oa_eur;
  }

  const totaux = {
    prod: +totalProd.toFixed(2),
    conso: +totalConso.toFixed(2),
    autoconso: +totalAuto.toFixed(2),
    surplus: +totalSurplus.toFixed(2),
    import: +totalImport.toFixed(2),
    economie_auto: +ecoAuto.toFixed(2),
    revenu_oa: +revenuOA.toFixed(2),
    prime: 0, // (option : prime autoconsommation à intégrer selon règles actées)
  };

  // CAPEX (PV + éventuelle batterie)
  const capex = capexTTCPvc(kwc);
  const capex_batt = capacity_kwh > 0 ? capexBatterie(capacity_kwh / 7) : { ht: 0, ttc: 0 };
  const capex_ttc = {
    materiel_ttc: capex.materiel_ttc,
    pose_ttc: capex.pose_ttc,
    total_ttc: capex.total_ttc + capex_batt.ttc,
  };

  // KPI indicatifs
  const gains_annee1 = totaux.economie_auto + totaux.revenu_oa;
  const roi_annees = gains_annee1 > 0 ? Math.round((capex_ttc.total_ttc / gains_annee1) * 10) / 10 : null;
  const roi_annuel_pct = roi_annees ? Math.round((100 / roi_annees) * 100) / 100 : null;
  const tri_pct = roi_annees ? Math.max(0, Math.round((roi_annuel_pct - 1.84) * 100) / 100) : 0; // placeholder
  const autoprod_pct = Math.round((totaux.autoconso / totaux.prod) * 10000) / 100;
  const autoconso_pct = Math.round((totaux.autoconso / totaux.conso) * 10000) / 100;

  // Projection 25 ans (inflation +4 %, dégradation -0.5 %/an)
  const ans25 = [];
  let cum = 0;
  for (let a = 1; a <= 25; a++) {
    const prodA = totaux.prod * Math.pow(1 - 0.5 / 100, a - 1);
    const ecoA = totaux.economie_auto * Math.pow(1 + 4 / 100, a - 1);
    const oaA = totaux.revenu_oa * Math.pow(1 + 2 / 100, a - 1);
    const gains = ecoA + oaA;
    cum += gains;
    ans25.push({
      annee: a,
      prod: Math.round(prodA * 100) / 100,
      economie_auto: Math.round(ecoA * 100) / 100,
      revenu_oa: Math.round(oaA * 100) / 100,
      gains_totaux: Math.round(gains * 100) / 100,
    });
  }

  const kpi = {
    roi_annees,
    roi_annuel_pct,
    tri_pct,
    lcoe_eur_kwh: Math.round((capex_ttc.total_ttc / Math.max(1, totaux.prod * 25)) * 100) / 100,
    autoconso_pct,
    autoprod_pct,
    gains_annee1: Math.round(gains_annee1 * 100) / 100,
    gains_25ans: Math.round(cum * 100) / 100,
  };

  return {
    label,
    annee1: { mois, totaux },
    ans25,
    capex_ttc: capex_ttc,
    kpi,
    audit: { ok: true, messages: [] },
  };
}

// ===== Audit interne des scénarios =====
function auditScenarios(obj) {
  const issues = [];
  for (const key of ['A1','A2','B1','B2']) {
    if (!obj.scenarios[key]) continue;
    const sc = obj.scenarios[key];
    const t = sc.annee1.totaux;
    if (Math.abs(t.conso - (t.autoconso + t.import)) > 0.5) {
      issues.push({ severity: 'error', code: 'ID_CONSO', msg: 'conso_kwh doit = autoconso_kwh + from_grid_kwh (±0,5 kWh).', scenario: key });
      sc.audit.ok = false;
    }
    if (!sc.kpi.roi_annees || sc.kpi.roi_annees <= 0) {
      issues.push({ severity: 'warn', code: 'ROI_NON_POSITIF', msg: 'ROI (années) non positif — vérifier les entrées prix/conso.', scenario: key });
    }
  }
  return { audit_ok: issues.filter(i => i.severity === 'error').length === 0, issues };
}

// ===== Contrôleur principal =====
async function runCalculation(req, res) {
  try {
    const body = req.body || {};

    // Tarifs & options
    const prixBase = number(body?.tarifs_effectifs?.effective_price, 0.1952);
    const tempo = !!body?.tarifs_effectifs?.tempo;
    const tempoAvg = number(body?.tarifs_effectifs?.tempo_avg, null);
    const price_kwh = tempo && tempoAvg ? tempoAvg : prixBase;

    const oa_enabled = body?.tarifs_effectifs?.oa_enabled !== false;

    // Batterie
    const battEnabled = !!(body?.battery_config?.enabled);
    const battUnitsReq = Math.min(3, Math.max(0, number(body?.battery_config?.units_requested, 0)));

    // Forçage
    const force = body?.force || body?.forced || {};
    const forceEnabled = !!force.enabled || !!force.active;

    // Profils mensuels
    const prodRef = arr12(body?.pvgis?.production_mensuelle_kwh, 400);
    const consoMensuelle = arr12(body?.consommation?.mensuelle_kwh, 580);

    // Sélection auto (ou forçage)
    let kwcA = 2.91; // ~6 panneaux
    let kwcB = 5.82; // ~12 panneaux
    if (forceEnabled && Number(force.kwc)) {
      kwcA = Number(force.kwc);
      kwcB = Number(force.kwc);
    }

    // Forçage batterie/variant/OA
    const battUnitsForced = forceEnabled && Number.isFinite(Number(force.battery_units)) ? Math.min(3, Math.max(0, Number(force.battery_units))) : null;
    const varForced = forceEnabled && typeof force.variant === 'string' ? force.variant : null;
    const oaForced = typeof force.oa_enabled === 'boolean' ? force.oa_enabled : null;
    const oaEffective = oaForced !== null ? oaForced : oa_enabled;

    // Scénarios (A1/A2 sur kwcA, B1/B2 sur kwcB) — 1 = sans batt, 2 = avec batt
    const A1 = buildScenario({
      label: 'A1',
      kwc: kwcA,
      consoMensuelle,
      prodMensuelleRef: prodRef,
      price_kwh,
      oa_enabled: oaEffective,
      battery_units: (varForced === 'with_battery') ? (battUnitsForced ?? (battEnabled ? Math.max(1, battUnitsReq) : 0)) :
                      (varForced === 'without_battery') ? 0 :
                      0
    });

    const A2 = buildScenario({
      label: 'A2',
      kwc: kwcA,
      consoMensuelle,
      prodMensuelleRef: prodRef,
      price_kwh,
      oa_enabled: oaEffective,
      battery_units: (varForced === 'with_battery') ? (battUnitsForced ?? (battEnabled ? Math.max(1, battUnitsReq) : 0)) :
                      (varForced === 'without_battery') ? 0 :
                      (battEnabled ? Math.max(1, battUnitsReq) : 0)
    });

    const B1 = buildScenario({
      label: 'B1',
      kwc: kwcB,
      consoMensuelle,
      prodMensuelleRef: prodRef,
      price_kwh,
      oa_enabled: oaEffective,
      battery_units: (varForced === 'with_battery') ? (battUnitsForced ?? (battEnabled ? Math.max(1, battUnitsReq) : 0)) :
                      (varForced === 'without_battery') ? 0 :
                      0
    });

    const B2 = buildScenario({
      label: 'B2',
      kwc: kwcB,
      consoMensuelle,
      prodMensuelleRef: prodRef,
      price_kwh,
      oa_enabled: oaEffective,
      battery_units: (varForced === 'with_battery') ? (battUnitsForced ?? (battEnabled ? Math.max(1, battUnitsReq) : 0)) :
                      (varForced === 'without_battery') ? 0 :
                      (battEnabled ? Math.max(1, battUnitsReq) : 0)
    });

    // Choix gagnant (heuristique simple)
    const pick = (s) => (s.kpi.tri_pct || 0) * 1000 + (s.kpi.gains_25ans || 0);
    const best = [['A1', A1], ['A2', A2], ['B1', B1], ['B2', B2]].sort((a, b) => pick(b[1]) - pick(a[1]))[0][0];

    // Données pour graphes
    const stacked_mensuel = A1.annee1.mois.map((m) => ({
      mois: m.mois,
      production: m.prod,
      consommation: m.conso,
      autoconso: m.autoconso,
      surplus: m.surplus,
      import: m.import,
    }));

    const gains_cumules_25ans = A1.ans25.map((a, i, all) => ({
      annee: a.annee,
      gains_cumules: Math.round(all.slice(0, i + 1).reduce((s, x) => s + x.gains_totaux, 0) * 100) / 100,
      gains_annuels: a.gains_totaux,
    }));

    const comparatif_kpi = [
      { scenario: 'A1', roi_annuel_pct: A1.kpi.roi_annuel_pct, tri_pct: A1.kpi.tri_pct, lcoe_eur_kwh: A1.kpi.lcoe_eur_kwh, gains_25ans: A1.kpi.gains_25ans },
      { scenario: 'A2', roi_annuel_pct: A2.kpi.roi_annuel_pct, tri_pct: A2.kpi.tri_pct, lcoe_eur_kwh: A2.kpi.lcoe_eur_kwh, gains_25ans: A2.kpi.gains_25ans },
      { scenario: 'B1', roi_annuel_pct: B1.kpi.roi_annuel_pct, tri_pct: B1.kpi.tri_pct, lcoe_eur_kwh: B1.kpi.lcoe_eur_kwh, gains_25ans: B1.kpi.gains_25ans },
      { scenario: 'B2', roi_annuel_pct: B2.kpi.roi_annuel_pct, tri_pct: B2.kpi.tri_pct, lcoe_eur_kwh: B2.kpi.lcoe_eur_kwh, gains_25ans: B2.kpi.gains_25ans },
    ];

    const impact_batterie_A = {
      sans_batterie: { autoprod_pct: A1.kpi.autoprod_pct, roi_annuel_pct: A1.kpi.roi_annuel_pct, tri_pct: A1.kpi.tri_pct, surplus_kwh_an: A1.annee1.totaux.surplus },
      avec_batterie: { autoprod_pct: A2.kpi.autoprod_pct, roi_annuel_pct: A2.kpi.roi_annuel_pct, tri_pct: A2.kpi.tri_pct, surplus_kwh_an: A2.annee1.totaux.surplus },
      deltas: {
        autoprod_pct: Math.round((A2.kpi.autoprod_pct - A1.kpi.autoprod_pct) * 100) / 100,
        roi_annuel_pct: A2.kpi.roi_annuel_pct && A1.kpi.roi_annuel_pct ? Math.round((A2.kpi.roi_annuel_pct - A1.kpi.roi_annuel_pct) * 100) / 100 : 0,
        tri_pct: A2.kpi.tri_pct - A1.kpi.tri_pct,
        surplus_kwh_an: Math.round((A2.annee1.totaux.surplus - A1.annee1.totaux.surplus) * 100) / 100
      }
    };

    const impact_batterie_B = {
      sans_batterie: { autoprod_pct: B1.kpi.autoprod_pct, roi_annuel_pct: B1.kpi.roi_annuel_pct, tri_pct: B1.kpi.tri_pct, surplus_kwh_an: B1.annee1.totaux.surplus },
      avec_batterie: { autoprod_pct: B2.kpi.autoprod_pct, roi_annuel_pct: B2.kpi.roi_annuel_pct, tri_pct: B2.kpi.tri_pct, surplus_kwh_an: B2.annee1.totaux.surplus },
      deltas: {
        autoprod_pct: Math.round((B2.kpi.autoprod_pct - B1.kpi.autoprod_pct) * 100) / 100,
        roi_annuel_pct: B2.kpi.roi_annuel_pct && B1.kpi.roi_annuel_pct ? Math.round((B2.kpi.roi_annuel_pct - B1.kpi.roi_annuel_pct) * 100) / 100 : 0,
        tri_pct: B2.kpi.tri_pct - B1.kpi.tri_pct,
        surplus_kwh_an: Math.round((B2.annee1.totaux.surplus - B1.annee1.totaux.surplus) * 100) / 100
      }
    };

    const responsePayload = {
      ok: true,
      stage: 'optimizer+audit+charts',
      meta: {
        algo: 'TRI>ROI>Gains25 + Autoprod',
        tarifs_effectifs: { mode: 'base', effective_price: price_kwh, oa_enabled: oaEffective, tempo: tempo, tempo_avg: tempo ? tempoAvg : null },
        oa: { enabled: oaEffective, rate_upto_9: 0.04, rate_above_9: 0.0617 },
        battery_config: { enabled: battEnabled, unit_kwh: 7, unit_price_ht: 3750, max_units: 3, units_requested: battUnitsReq }
      },
      selection: {
        A: { panneaux: Math.round(kwcA / 0.485), kwc: kwcA, variante: 'sans_batterie', capex: A1.capex_ttc.total_ttc },
        B: { panneaux: Math.round(kwcB / 0.485), kwc: kwcB, variante: 'sans_batterie', capex: B1.capex_ttc.total_ttc },
      },
      scenario_gagnant: { code: best, raison: 'max TRI puis Gains25' },
      scenario_forced: forceEnabled ? { kwc: kwcA, variant: varForced, battery_units: battUnitsForced } : null,
      scenarios: { A1, A2, B1, B2 },
      charts: {
        stacked_mensuel,
        gains_cumules_25ans,
        comparatif_kpi,
        impact_batterie_A,
        impact_batterie_B,
        financement: null
      }
    };

    // ===== Audit interne =====
    const audit = auditScenarios(responsePayload);
    responsePayload.audit_ok = audit.audit_ok;
    responsePayload.audit = audit;

    // ===== Validation finale avant réponse (AJV 2020) =====
    if (validateCalc) {
      const valid = validateCalc(responsePayload);
      if (!valid) {
        console.error('❌ Réponse non conforme au schéma :', validateCalc.errors);
        return res.status(500).json({
          ok: false,
          error: 'INVALID_RESPONSE_SCHEMA',
          details: validateCalc.errors
        });
      }
    } else {
      console.warn('⚠️ Validation AJV désactivée (schéma non chargé). La réponse est renvoyée sans contrôle de schéma.');
    }

    // ===== Réponse OK =====
    res.json(responsePayload);

  } catch (err) {
    console.error('calc error:', err);
    res.status(500).json({ ok: false, error: 'CALC_FAILED', message: err?.message || 'Erreur interne' });
  }
}

module.exports = { runCalculation };
