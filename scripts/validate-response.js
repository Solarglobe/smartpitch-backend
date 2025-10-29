// scripts/validate-response.js
const fs = require('fs');
const path = require('path');

// ⚠️ Utiliser la classe Ajv pour draft 2020-12
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const schemaPath = path.join(__dirname, '..', 'schemas', 'calcResponse.schema.json');
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));

// compile le schéma 2020-12
const validate = ajv.compile(schema);

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Usage: node scripts/validate-response.js <file1.json> [file2.json ...]');
  process.exit(1);
}

let exitCode = 0;

for (const f of files) {
  try {
    const data = JSON.parse(fs.readFileSync(f, 'utf8'));
    const ok = validate(data);
    if (ok) {
      console.log('✅ OK :', f);
    } else {
      exitCode = 2;
      console.log('❌ INVALID :', f);
      console.log(
        validate.errors
          .map(e => `  - ${e.instancePath || '/'} ${e.message}`)
          .join('\n')
      );
    }
  } catch (err) {
    exitCode = 3;
    console.log('💥 ERROR :', f, '-', err.message);
  }
}

process.exit(exitCode);
