// D:\smartpitch\backend\services\localSimService.js
// Moteur local (mock réaliste) conforme aux règles Solarglobe v2.
// Intègre la batterie ATMOCE (par défaut 7 kWh) avec un modèle mensuel simple.

function sum(a) { return a.reduce((x, y) => x + y, 0); }

function irr(cashflows, guessLow = 0, guessHigh = 0.5, steps = 60) {
  // Recherche binaire simple de TRI (0..50%)
  const npv = (r) => cashflows.reduce((acc, cf, i) => acc + cf / Math.pow(1 + r, i), 0);
  let lo = guessLow, hi = guessHigh;
  for (let i = 0; i < steps; i++) {
    const mid = (lo + hi) / 2;
    const v = npv(mid);
    if (Math.abs(v) < 1e-2) return mid;
    if (v > 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

function pricePoseHT(kwc, pose) {
  if (kwc <= 3) return pose.k3;
  if (kwc <= 6) return pose.k6;
  if (kwc <= 9) return pose.k9;
  return pose.k9 + pose.supp_par_kwc * (kwc - 9);
}

// jours par mois pour capacité batterie mensuelle
const DAYS = [31,28,31,30,31,30,31,31,30,31,30,31];

function simulateScenario(payload) {
  const prod = payload.pvgis.production_mensuelle_kwh.map(Number);
  const conso = payload.consommation.mensuelle_kwh.map(Number);
  const prix = Number(payload.consommation.prix_eur_kwh);
  const hausse = Number(payload.consommation.hausse_pct_an || 4) / 100;
  const oa = Number(payload.eco.oa_eur_kwh || 0.04);
  const prime_kwc = Number(payload.eco.prime_eur_par_kwc || 80);
  const prime_plafond = Number(payload.eco.prime_plafond_kwc || 9);
  const degr = Number(payload.eco.degradation_pv_pct_an || 0.5) / 100;
  const horizon = Number(payload.eco.horizon_ans || 25);
  const kwc = Number(payload.installation.kwc);
  const panneaux = Number(payload.installation.panneaux || Math.round(kwc / 0.485));
  const batt = Number(payload.installation.batterie_kwh || 0); // 0 ou 7 (ATMOCE)

  const tvaM = Number(payload.pricing.tva_materiel || 0.20);
  const tvaP = Number(payload.pricing.tva_pose || 0.10);
  const m = payload.pricing.materiel_ht || {};
  const poseHTCfg = payload.pricing.pose_ht || { k3:1500,k6:2200,k9:2700,supp_par_kwc:300 };

  // Matériel HT : modules + MC100 + gestion + (batterie eventuelle)
  const modulesHT = Number(m.module_x10 || 0) * panneaux;
  const mc100HT = Number(m.mc100 || 1650);
  const gestionHT = Number(m.gestion || 710);
  const battHT = batt > 0 ? Number(m.batterie7kwh || 4590) : 0;
  const materielHT = modulesHT + mc100HT + gestionHT + battHT;
  const materielTTC = materielHT * (1 + tvaM);

  const poseHT = pricePoseHT(kwc, poseHTCfg);
  const poseTTC = poseHT * (1 + tvaP);
  const capexTTC = materielTTC + poseTTC;

  // Année 1 (mensuel) avec facteur réalisme p=0.85 appliqué sur l'autoconso
  const autoconsoTh = prod.map((p, i) => Math.min(p, conso[i]));
  const pFactor = 0.85;
  const autoconsoBase = autoconsoTh.map(v => v * pFactor);
  const surplusBase = prod.map((p, i) => Math.max(0, p - autoconsoBase[i]));
  const importBase  = conso.map((c, i) => Math.max(0, c - autoconsoBase[i]));

  // ===== Modèle Batterie v1 =====
  // On déplace une partie du surplus vers l’autoconso, limité par :
  //   1) surplus du mois
  //   2) import du mois
  //   3) capacité utilisable mensuelle = batt * DoD * cycles/jour * jours
  // Hypothèses :
  const DoD = 0.90;          // profondeur de décharge utilisable 90 %
  const cyclesParJour = 1.0;  // 1 cycle/jour utilisable
  // Si pas de batterie → on garde les valeurs de base
  const autoconsoM = [...autoconsoBase];
  const surplusM = [...surplusBase];
  const importM = [...importBase];

  if (batt > 0) {
    for (let i = 0; i < 12; i++) {
      const capMonth = batt * DoD * cyclesParJour * DAYS[i]; // kWh utilisables sur le mois
      const possibleShift = Math.min(surplusM[i], importM[i], capMonth);
      autoconsoM[i] += possibleShift;
      surplusM[i]   -= possibleShift;
      importM[i]    -= possibleShift;
    }
  }

  const totalProd = sum(prod);
  const totalConso = sum(conso);
  const totalAutoconso = sum(autoconsoM);
  const totalSurplus = sum(surplusM);
  const totalImport = sum(importM);

  const economieA1 = sum(autoconsoM.map(v => v * prix));
  const oaA1 = sum(surplusM.map(v => v * oa));
  const prime = Math.min(kwc, prime_plafond) * prime_kwc;

  const autoconsoPct = totalAutoconso / totalProd * 100;
  const autoprodPct = totalAutoconso / totalConso * 100;

  // Projection 25 ans (approx : on scale autoconso/surplus sur la prod)
  const annualProdY1 = totalProd;
  const annualAutocY1 = totalAutoconso;
  const annualSurpY1 = totalSurplus;

  let gainsCum = 0;
  const ans25 = [];
  const prodByYear = [];
  for (let a = 1; a <= horizon; a++) {
    const prodYear = annualProdY1 * Math.pow(1 - degr, a - 1);
    prodByYear.push(prodYear);
    const scale = prodYear / annualProdY1;
    const autoc = annualAutocY1 * scale;
    const surp = annualSurpY1 * scale;
    const prixYear = prix * Math.pow(1 + hausse, a - 1);
    const eco = autoc * prixYear;
    const oaRev = surp * oa;
    const gains = eco + oaRev + (a === 1 ? prime : 0);
    gainsCum += gains;
    ans25.push({ annee: a, prod: Math.round(prodYear), economie_auto: Math.round(eco), revenu_oa: Math.round(oaRev), gains_totaux: Math.round(gains) });
  }

  // KPIs
  const gainsAn1 = Math.round(economieA1 + oaA1 + prime);
  const gains25 = Math.round(gainsCum);
  const roiAnnees = (() => {
    let cum = 0;
    for (let i = 0; i < ans25.length; i++) {
      cum += ans25[i].gains_totaux;
      if (cum >= capexTTC) return i + 1;
    }
    return null;
  })();
  const roiAnnuelPct = capexTTC > 0 ? (gainsAn1 / capexTTC) * 100 : 0;
  const lcoe = capexTTC / sum(prodByYear); // €/kWh
  const cashflows = [-capexTTC, ...ans25.map(a => a.gains_totaux)];
  const tri = irr(cashflows) * 100;

  // Audit simple
  const audit = { ok: true, messages: [] };
  const eq1 = Math.abs(totalAutoconso + totalSurplus - totalProd) <= totalProd * 0.001;
  const eq2 = Math.abs(totalAutoconso + totalImport - totalConso) <= totalConso * 0.001;
  if (!eq1) { audit.ok = false; audit.messages.push('Identité prod: autoconso+surplus != prod'); }
  if (!eq2) { audit.ok = false; audit.messages.push('Identité conso: autoconso+import != conso'); }

  return {
    annee1: {
      mois: prod.map((p, i) => ({
        mois: ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'][i],
        prod: Math.round(p),
        conso: Math.round(conso[i]),
        autoconso: Math.round(autoconsoM[i]),
        surplus: Math.round(surplusM[i]),
        import: Math.round(importM[i]),
        eco_eur: +(autoconsoM[i] * prix).toFixed(2),
        oa_eur: +(surplusM[i] * oa).toFixed(2),
      })),
      totaux: {
        prod: Math.round(totalProd),
        conso: Math.round(totalConso),
        autoconso: Math.round(totalAutoconso),
        surplus: Math.round(totalSurplus),
        import: Math.round(totalImport),
        economie_auto: Math.round(economieA1),
        revenu_oa: Math.round(oaA1),
        prime: Math.round(prime),
        autoconso_pct: +autoconsoPct.toFixed(1),
        autoprod_pct: +autoprodPct.toFixed(1),
        conso_reseau_kwh: Math.round(totalImport)
      }
    },
    ans25,
    capex_ttc: {
      materiel_ttc: Math.round(materielTTC),
      pose_ttc: Math.round(poseTTC),
      total_ttc: Math.round(capexTTC)
    },
    kpi: {
      roi_annees: roiAnnees,
      roi_annuel_pct: +roiAnnuelPct.toFixed(1),
      tri_pct: +tri.toFixed(1),
      lcoe_eur_kwh: +lcoe.toFixed(3),
      autoconso_pct: +autoconsoPct.toFixed(1),
      autoprod_pct: +autoprodPct.toFixed(1),
      gains_annee1: gainsAn1,
      gains_25ans: gains25
    },
    audit
  };
}

function simulate(payload) {
  // Ici on calcule un seul scénario (installation telle que fournie)
  return simulateScenario(payload);
}

module.exports = { simulate };
