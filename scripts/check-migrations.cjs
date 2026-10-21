const fs = require('fs');
const path = require('path');

const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations');
const schemaFile = path.join(__dirname, '..', 'supabase', 'schema.sql');

function concatMigrations() {
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();
  return files.map(f => fs.readFileSync(path.join(migrationsDir, f), 'utf8')).join('\n');
}

function main() {
  if (!fs.existsSync(migrationsDir) || !fs.existsSync(schemaFile)) {
    console.error('Migrations directory or schema.sql missing');
    process.exit(2);
  }
  const migrations = concatMigrations();
  const schema = fs.readFileSync(schemaFile, 'utf8');
  if (migrations.trim() === '' || schema.trim() === '') {
    console.error('Empty migrations or schema');
    process.exit(2);
  }
  if (!schema.includes(migrations.split('\n').slice(-1)[0].slice(0,20))) {
    console.error('Schema and migrations may be out of sync. Please update schema.sql after running migrations.');
    process.exit(1);
  }
  console.log('Migrations and schema appear present — manual verification recommended.');
}

main();