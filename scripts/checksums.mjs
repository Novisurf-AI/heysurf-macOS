import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const directory = path.join(root, 'dist');
const files = (await readdir(directory)).filter(name => name.startsWith(`HeySurf-${version}-`) && /\.(dmg|zip)$/.test(name)).sort();
if (!files.length) throw new Error(`No release artifacts found for ${version}`);
const lines = [];
for (const name of files) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path.join(directory, name))) hash.update(chunk);
  lines.push(`${hash.digest('hex')}  ${name}`);
}
await writeFile(path.join(directory, 'SHA256SUMS.txt'), lines.join('\n') + '\n');
console.log(`Wrote checksums for ${files.length} artifacts (${version}).`);
