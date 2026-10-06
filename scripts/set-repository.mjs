import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const repository = process.argv[2]?.replace(/^https:\/\/github\.com\//u, '').replace(/\.git$/u, '');
if (!repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) {
  throw new Error('Usage: npm run repository:set -- <github-owner>/<repository>');
}

const root = process.cwd();
const url = `https://github.com/${repository}`;
for (const relative of ['package.json', 'tree-sitter-framescript/package.json', 'editors/vscode/package.json']) {
  const file = path.join(root, relative);
  const value = JSON.parse(await readFile(file, 'utf8'));
  value.repository = {type: 'git', url: `git+${url}.git`};
  value.homepage = `${url}#readme`;
  value.bugs = {url: `${url}/issues`};
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

process.stdout.write(`Set FrameScript repository metadata to ${url}.\n`);
