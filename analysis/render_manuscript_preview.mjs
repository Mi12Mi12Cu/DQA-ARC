import fs from 'node:fs';
import path from 'node:path';
import { PDFParse } from 'pdf-parse';

const pdf = path.join('paper', 'main.pdf');
const out = path.join('paper', 'preview');
fs.mkdirSync(out, { recursive: true });
const parser = new PDFParse({ data: fs.readFileSync(pdf) });
const result = await parser.getScreenshot({ scale: 1.25, imageDataUrl: false, imageBuffer: true });
for (let i = 0; i < result.pages.length; i += 1) {
  fs.writeFileSync(path.join(out, `page-${String(i + 1).padStart(2, '0')}.png`), result.pages[i].data);
}
await parser.destroy();
process.stdout.write(`Rendered ${result.pages.length} manuscript pages to ${out}.\n`);
