// scripts/snapshot-response.js
// 1) POST /api/calculate avec tests/request.sample.json
// 2) Sauvegarde la réponse dans /tests/reponse-live-YYYYMMDD-HHMMSS.json
// 3) Valide le JSON contre le schéma officiel (AJV 2020)

const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

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

    // === Sauvegarde snapshot daté
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const ts = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

    const outDir = path.join(__dirname, '..', 'tests');
    const outFile = path.join(outDir, `reponse-live-${ts}.json`);
    fs.writeFileSync(outFile, JSON.stringify(data, null, 2), 'utf8');
    console.log(`💾 Snapshot écrit → ${outFile}`);

    // === Validation AJV
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);

    const schemaPath = path.join(__dirname, '..', 'schemas', 'calcResponse.schema.json');
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    const validate = ajv.compile(schema);

    const valid = validate(data);
    if (!valid) {
      console.error('❌ Snapshot NON conforme au schéma :');
      console.error(validate.errors);
      process.exit(1);
    }

    console.log('✅ Snapshot conforme au schéma AJV');
    console.log(`🏁 ok=${data.ok} | audit_ok=${data.audit_ok} | gagnant=${data?.scenario_gagnant?.code || '—'}`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Erreur snapshot:', err?.message || err);
    process.exit(1);
  }
})();
