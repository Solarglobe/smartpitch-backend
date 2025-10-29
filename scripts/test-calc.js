// scripts/test-calc.js
// Test d'intégration minimal pour /api/calculate
// - Envoie tests/request.sample.json
// - Vérifie HTTP 200, ok:true, audit_ok:true
// - Affiche un résumé (TRI/ROI gagnant) et sort avec code 0/1

const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.CALC_URL || 'http://localhost:3000/api/calculate';

(async () => {
  try {
    const bodyPath = path.join(__dirname, '..', 'tests', 'request.sample.json');
    const raw = fs.readFileSync(bodyPath, 'utf8');

    const res = await fetch(BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: raw
    });

    if (!res.ok) {
      console.error(`❌ HTTP ${res.status} ${res.statusText}`);
      process.exit(1);
    }

    const data = await res.json();

    // Vérifs de base
    if (!data || data.ok !== true) {
      console.error('❌ Payload invalide ou ok !== true');
      console.error(data);
      process.exit(1);
    }
    if (data.audit_ok !== true) {
      console.error('❌ audit_ok !== true — détails audit:');
      console.error(JSON.stringify(data.audit, null, 2));
      process.exit(1);
    }

    // Résumé utile
    const best = data?.scenario_gagnant?.code || '—';
    const kpiBest = best && data.scenarios?.[best]?.kpi ? data.scenarios[best].kpi : null;

    console.log('✅ /api/calculate → 200 OK');
    console.log('✅ ok:true & audit_ok:true confirmés');
    if (kpiBest) {
      console.log(`🏆 Scénario gagnant: ${best}`);
      console.log(`   • ROI (années): ${kpiBest.roi_annees}`);
      console.log(`   • TRI (%): ${kpiBest.tri_pct}`);
      console.log(`   • Gains 25 ans (€): ${kpiBest.gains_25ans}`);
    }

    process.exit(0);
  } catch (err) {
    console.error('❌ Erreur de test:', err?.message || err);
    process.exit(1);
  }
})();
