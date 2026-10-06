import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/u.test(version)) {
  throw new Error('Usage: npm run version:set -- <major.minor.patch>');
}
const root = process.cwd();

const updateJson = async (relative, update) => {
  const file = path.join(root, relative);
  const value = JSON.parse(await readFile(file, 'utf8'));
  update(value);
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

for (const file of ['package.json', 'tree-sitter-framescript/package.json', 'editors/vscode/package.json']) {
  await updateJson(file, (value) => { value.version = version; });
}
await updateJson('package-lock.json', (value) => {
  value.name = 'framescript';
  value.version = version;
  value.packages[''].name = 'framescript';
  value.packages[''].version = version;
});
await updateJson('editors/vscode/package-lock.json', (value) => {
  value.version = version;
  value.packages[''].version = version;
});
process.stdout.write(`Set all FrameScript artifact versions to ${version}.\n`);
