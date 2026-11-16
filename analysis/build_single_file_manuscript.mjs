import fs from 'node:fs';
import path from 'node:path';

const source = process.argv[2] ?? path.join('paper', 'main.tex');
const destination = process.argv[3] ?? path.join('paper', 'main-single.tex');
const sourceDir = path.dirname(source);
let text = fs.readFileSync(source, 'utf8');
text = text.replace(/\\input\{([^}]+)\}/g, (_match, relative) => {
  const file = path.resolve(sourceDir, `${relative}.tex`);
  if (!fs.existsSync(file)) throw new Error(`Missing section input: ${file}`);
  return `% BEGIN INLINED ${relative}.tex\n${fs.readFileSync(file, 'utf8').trim()}\n% END INLINED ${relative}.tex`;
});
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, `${text.trim()}\n`, 'utf8');
process.stdout.write(`Wrote self-contained section source to ${destination}.\n`);
