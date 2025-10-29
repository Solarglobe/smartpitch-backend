// D:\smartpitch\backend\services\optimizerService.js
// Sélection automatique des 2 puissances optimales (A et B) + variantes batterie (A1/A2/B1/B2)

const { simulate } = require('./localSimService');

const P_WC = 0.485; // puissance par panneau (kWc)
const MIN_PANNEAUX = 6; // ~2,91 kWc

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function norm(v, vmin, vmax) {
  if (vmax <= vmin) return 0;
  return clamp((v - vmin) / (vmax - vmin), 0, 1);
}

function panelsToKwc(panels) {
  return +(panels * P_WC).toFixed(2);
}

function applyInstall(payload, panels, battKwh) {
  const clone = JSON.parse(JSON.stringify(payload));
  clone.installation = clone.installation || {};
  clone.installation.panneaux = panels;
  clone.installation.kwc = panelsToKwc(panels);
  clone.installation.batterie_kwh = battKwh;
  return clone;
}

/**
 * Simule une puissance en comparant sans/avec batterie.
 * Retourne la meilleure des deux variantes, avec ses KPI et un "score" (sans normalisation à ce stade).
 */
function evaluatePower(payload, panels, budgetEUR) {
  // Variante sans batterie
  const resNoBatt = simulate(applyInstall(payload, panels, 0));
  const noBatt = {
    variante: 'sans_batterie',
    kpi: resNoBatt.kpi,
    capex: resNoBatt.capex_ttc.total_ttc,
    autoprod: resNoBatt.kpi.autoprod_pct,
    tri: resNoBatt.kpi.tri_pct,
    roi: resNoBatt.kpi.roi_annuel_pct,
    gains25: resNoBatt.kpi.gains_25ans,
    results: resNoBatt
  };

  // Variante avec batterie 7 kWh
  const resBatt = simulate(applyInstall(payload, panels, 7));
  const withBatt = {
    variante: 'avec_batterie',
    kpi: resBatt.kpi,
    capex: resBatt.capex_ttc.total_ttc,
    autoprod: resBatt.kpi.autoprod_pct,
    tri: resBatt.kpi.tri_pct,
    roi: resBatt.kpi.roi_annuel_pct,
    gains25: resBatt.kpi.gains_25ans,
    results: resBatt
  };

  const variants = [noBatt, withBatt];

  // Filtre budget si fourni
  if (typeof budgetEUR === 'number') {
    variants.forEach(v => { if (v.capex > budgetEUR) v.excluded = true; });
  }

  // Garde la meilleure variante (priorité TRI, puis ROI, puis Gains 25 ans)
  const viable = variants.filter(v => !v.excluded);
  if (viable.length === 0) {
    return { excluded: true, reason: 'budget', panels };
  }
  viable.sort((a, b) => (
    (b.tri - a.tri) || (b.roi - a.roi) || (b.gains25 - a.gains25)
  ));
  const best = viable[0];

  return {
    excluded: false,
    panels,
    kwc: panelsToKwc(panels),
    variante: best.variante,
    tri: best.tri,
    roi: best.roi,
    gains25: best.gains25,
    autoprod: best.autoprod,
    capex: best.capex,
    bestResults: best.results, // objet results complet de la variante gagnante
    both: { noBatt, withBatt } // pour produire A1/A2/B1/B2 ensuite
  };
}

/**
 * Calcule le score global d'une puissance (après NORMALISATION des indicateurs).
 * score = 0.50 × TRI_norm + 0.20 × ROI_norm + 0.20 × Gains25_norm + 0.10 × Autoprod_norm(+bonus si >=60%)
 */
function scoreCandidate(cand, mins, maxs) {
  const triN = norm(cand.tri, mins.tri, maxs.tri);
  const roiN = norm(cand.roi, mins.roi, maxs.roi);
  const gainsN = norm(cand.gains25, mins.gains, maxs.gains);
  const autoN = norm(cand.autoprod, mins.auto, maxs.auto);
  const bonus = cand.autoprod >= 60 ? 0.05 : 0; // petit bonus si objectif d'autonomie atteint
  const score = 0.50 * triN + 0.20 * roiN + 0.20 * gainsN + 0.10 * autoN + bonus;
  return +score.toFixed(5);
}

function pickTwoPowers(sortedCands) {
  if (sortedCands.length === 0) return { A: null, B: null };
  const A = sortedCands[0];
  // B = meilleure puissance différente avec écart >= 10% en kWc
  const B = sortedCands.find(c => Math.abs(c.kwc - A.kwc) / A.kwc >= 0.10);
  return { A, B: B || null };
}

function buildScenarioLabel(prefix, variante) {
  // A1 = sans batterie ; A2 = avec batterie (idem pour B)
  if (prefix === 'A') return variante === 'sans_batterie' ? 'A1' : 'A2';
  if (prefix === 'B') return variante === 'sans_batterie' ? 'B1' : 'B2';
  return prefix;
}

/**
 * Détermine le scénario gagnant GLOBAL parmi A1, A2, B1, B2
 * Règle : TRI max, puis ROI annuel, puis Gains 25 ans.
 */
function pickGlobalWinner(scens) {
  const list = Object.values(scens);
  list.sort((s1, s2) => (
    (s2.kpi.tri_pct - s1.kpi.tri_pct) ||
    (s2.kpi.roi_annuel_pct - s1.kpi.roi_annuel_pct) ||
    (s2.kpi.gains_25ans - s1.kpi.gains_25ans)
  ));
  const top = list[0];
  const code = Object.keys(scens).find(k => scens[k] === top);
  return { code, raison: 'max TRI puis ROI puis Gains25' };
}

/**
 * Point d'entrée principal
 */
function optimize(payload) {
  // Plage de panneaux
  const maxPanelsProvided = payload?.installation?.max_panneaux;
  const maxPanels = Number.isFinite(maxPanelsProvided)
    ? Math.max(MIN_PANNEAUX, maxPanelsProvided)
    : 74; // ≈ 36 kWc / 0.485

  const budgetEUR = payload?.budget_eur ?? payload?.constraints?.budget_eur;

  const candidates = [];
  for (let panels = MIN_PANNEAUX; panels <= maxPanels; panels++) {
    const cand = evaluatePower(payload, panels, budgetEUR);
    if (!cand.excluded) candidates.push(cand);
  }

  if (candidates.length === 0) {
    return { ok: false, error: 'Aucun candidat viable dans la plage de panneaux/budget.' };
  }

  // Prépare normalisation
  const mins = {
    tri: Math.min(...candidates.map(c => c.tri)),
    roi: Math.min(...candidates.map(c => c.roi)),
    gains: Math.min(...candidates.map(c => c.gains25)),
    auto: Math.min(...candidates.map(c => c.autoprod)),
  };
  const maxs = {
    tri: Math.max(...candidates.map(c => c.tri)),
    roi: Math.max(...candidates.map(c => c.roi)),
    gains: Math.max(...candidates.map(c => c.gains25)),
    auto: Math.max(...candidates.map(c => c.autoprod)),
  };

  // Score + tri décroissant
  candidates.forEach(c => c.score = scoreCandidate(c, mins, maxs));
  candidates.sort((a, b) => (b.score - a.score));

  // Sélection A et B (écart >= 10%)
  const { A, B } = pickTwoPowers(candidates);
  if (!A) return { ok: false, error: 'Impossible de sélectionner A.' };
  if (!B) return { ok: false, error: 'Impossible de sélectionner B (écart < 10 % ?).' };

  // Construire 4 scénarios complets (A1/A2/B1/B2)
  const scenA1 = A.both.noBatt.results; // A sans batt
  const scenA2 = A.both.withBatt.results; // A avec batt
  const scenB1 = B.both.noBatt.results; // B sans batt
  const scenB2 = B.both.withBatt.results; // B avec batt

  const scenarios = {
    A1: scenA1, A2: scenA2, B1: scenB1, B2: scenB2
  };

  // Gagnant global
  const winner = pickGlobalWinner(scenarios);

  return {
    ok: true,
    meta: {
      algo: 'TRI>ROI>Gains25 + Autoprod (score avec normalisation)',
      min_panneaux: MIN_PANNEAUX,
      max_panneaux: maxPanels,
      budget_eur: budgetEUR ?? null
    },
    selection: {
      A: { panneaux: A.panels, kwc: A.kwc, variante: A.variante, score: A.score, capex: A.capex, tri: A.tri, roi: A.roi, autoprod_pct: A.autoprod, gains_25ans: A.gains25 },
      B: { panneaux: B.panels, kwc: B.kwc, variante: B.variante, score: B.score, capex: B.capex, tri: B.tri, roi: B.roi, autoprod_pct: B.autoprod, gains_25ans: B.gains25 }
    },
    scenarios,        // objets complets A1/A2/B1/B2 (avec kpi, annee1, ans25, capex...)
    scenario_gagnant: winner
  };
}

module.exports = { optimize };
