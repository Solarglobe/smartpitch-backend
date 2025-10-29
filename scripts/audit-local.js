// D:\smartpitch\backend\scripts\audit-local.js
const fs = require("fs");
const path = require("path");

// fonctions utilitaires
const sum = arr => (arr || []).reduce((t, n) => t + Number(n || 0), 0);
const eq = (a, b, tol = 0.5) => Math.abs((a ?? 0) - (b ?? 0)) <= tol;

// fonction d’audit principale
function auditOne(filePath) {
  const j = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const issues = [];

  if (!j.ok) issues.push("ok = false");
  if (!j.meta) issues.push("meta manquant");
  if (!j.scenarios) issues.push("scenarios manquant");

  const scenarios = j.scenarios || {};
  const names = Object.keys(scenarios);
  if (names.length === 0) issues.push("aucun scénario présent");

  for (const sName of names) {
    const s = scenarios[sName];
    const mois = s?.annee1?.mois || [];
    const tot = s?.annee1?.totaux || {};

    if (mois.length !== 12)
      issues.push(`${sName}: doit contenir 12 mois (actuellement ${mois.length})`);

    // vérif cohérence annuelle
    const P = sum(mois.map(m => m.prod));
    const C = sum(mois.map(m => m.conso));
    const A = sum(mois.map(m => m.autoconso));
    const S = sum(mois.map(m => m.surplus));
    const I = sum(mois.map(m => m.import));

    if (!eq(P, tot.prod)) issues.push(`${sName}: Σprod (${P}) ≠ totaux.prod (${tot.prod})`);
    if (!eq(C, tot.conso)) issues.push(`${sName}: Σconso (${C}) ≠ totaux.conso (${tot.conso})`);
    if (!eq(A, tot.autoconso)) issues.push(`${sName}: Σautoconso (${A}) ≠ totaux.autoconso (${tot.autoconso})`);
    if (!eq(S, tot.surplus)) issues.push(`${sName}: Σsurplus (${S}) ≠ totaux.surplus (${tot.surplus})`);
    if (!eq(I, tot.import)) issues.push(`${sName}: Σimport (${I}) ≠ totaux.import (${tot.import})`);

    // identités mensuelles
    mois.forEach((m, i) => {
      if (!eq(m.autoconso + m.import, m.conso))
        issues.push(`${sName} Mois ${m.mois || i + 1}: conso != autoconso + import`);
      if (!eq(m.autoconso + m.surplus, m.prod))
        issues.push(`${sName} Mois ${m.mois || i + 1}: prod != autoconso + surplus`);
      if (m.autoconso > m.prod + 0.5)
        issues.push(`${sName} Mois ${m.mois || i + 1}: autoconso > prod`);
      if (m.autoconso > m.conso + 0.5)
        issues.push(`${sName} Mois ${m.mois || i + 1}: autoconso > conso`);
    });

    // 25 ans
    const g25 = s?.ans25 || [];
    if (g25.length !== 25)
      issues.push(`${sName}: ans25 doit contenir 25 entrées`);
    for (let i = 1; i < g25.length; i++) {
      if (g25[i].gains_totaux < g25[i - 1].gains_totaux)
        issues.push(`${sName}: gains cumulés non croissants à l'année ${i + 1}`);
    }

    // KPI check
    const k = s?.kpi || {};
    if (k.tri_pct < 0) issues.push(`${sName}: TRI négatif`);
    if (k.gains_25ans <= 0) issues.push(`${sName}: gains_25ans <= 0`);
  }

  return { filePath, ok: issues.length === 0, issues };
}

// Lancer audit sur tous les fichiers fournis
const args = process.argv.slice(2);
if (args.length === 0) {
  console.log("Usage : node audit-local.js fichier1.json fichier2.json ...");
  process.exit(1);
}

for (const f of args) {
  const res = auditOne(f);
  console.log("\n-----------------------------");
  console.log(res.ok ? "✅ OK :" : "❌ ERREURS :", f);
  if (!res.ok) {
    for (const issue of res.issues) console.log(" -", issue);
  }
}
