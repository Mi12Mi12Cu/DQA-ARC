import fs from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const dir = path.resolve(arg('dir', 'figures'));
const files = fs.readdirSync(dir).filter((name) => name.endsWith('.svg'));

for (const file of files) {
  const svg = fs.readFileSync(path.join(dir, file), 'utf8');
  const renderer = new Resvg(svg, {
    fitTo: { mode: 'zoom', value: 2 },
    font: { loadSystemFonts: true, defaultFontFamily: 'Arial' }
  });
  const output = path.join(dir, file.replace(/\.svg$/i, '.png'));
  fs.writeFileSync(output, renderer.render().asPng());
  process.stdout.write(`${file} -> ${path.basename(output)}\n`);
}
