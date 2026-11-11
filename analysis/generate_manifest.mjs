import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const excludedDirectories = new Set(['.git', 'node_modules', 'preview']);
const excludedFiles = new Set(['MANIFEST.sha256']);

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (!excludedFiles.has(entry.name)) files.push(full);
  }
  return files;
}

const records = walk(root).map((file) => {
  const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const relative = path.relative(root, file).split(path.sep).join('/');
  return `${hash}  ${relative}`;
}).sort((a, b) => a.slice(66).localeCompare(b.slice(66)));

fs.writeFileSync(path.join(root, 'MANIFEST.sha256'), `${records.join('\n')}\n`, 'utf8');
process.stdout.write(`Wrote ${records.length} SHA-256 records to MANIFEST.sha256.\n`);
