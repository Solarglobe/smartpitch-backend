// scripts/quality-check.js
// Regroupe test-calc + snapshot + validation en une seule commande

const { execSync } = require('child_process');

function run(label, cmd) {
  console.log(`\n▶ ${label}`);
  try {
    execSync(cmd, { stdio: 'inherit' });
  } catch (err) {
    console.error(`❌ ${label} a échoué`);
    process.exit(1);
  }
}

// Étape 1 — Test calcul complet
run('Test /api/calculate', 'node scripts/test-calc.js');

// Étape 2 — Snapshot & validation AJV
run('Snapshot + validation schéma', 'node scripts/snapshot-response.js');

// Étape 3 — Validation multi-réponses
run('Validation globale (6 fichiers + live)', 'node scripts/validate-all.js');

console.log('\n✅ Vérification qualité SmartPitch terminée avec succès.\n');
