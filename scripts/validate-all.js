// scripts/validate-all.js
// Valide plusieurs jeux de réponses JSON via le schéma officiel AJV 2020

const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

// Charger le schéma de référence
const schemaPath = path.join(__dirname, '..', 'schemas', 'calcResponse.schema.json');
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const validate = ajv.compile(schema);

// Dossier contenant les réponses à valider
const testsDir = path.join(__dirname, '..', 'tests');
const files = fs.readdirSync(testsDir).filter(f => /^reponse\d+\.json$/i.test(f));

if (files.length === 0) {
  console.warn('⚠️ Aucun fichier reponseX.json trouvé dans /tests');
  process.exit(0);
}

let okCount = 0;

for (const f of files) {
  const fullPath = path.join(testsDir, f);
  const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  const valid = validate(data);
  if (valid) {
    console.log(`✅ OK : ${f}`);
    okCount++;
  } else {
    console.error(`❌ Erreurs dans ${f} :`);
    console.error(validate.errors);
  }
}

console.log(`\nRésultat : ${okCount}/${files.length} réponses valides ✅`);
