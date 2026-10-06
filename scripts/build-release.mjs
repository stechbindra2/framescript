import {createHash} from 'node:crypto';
import {copyFile, mkdir, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const releaseDirectory = path.resolve(root, 'release');
if (path.dirname(releaseDirectory) !== path.resolve(root) || path.basename(releaseDirectory) !== 'release') {
  throw new Error(`Refusing to replace unexpected release directory '${releaseDirectory}'.`);
}
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const preRelease = process.argv.includes('--pre-release');
const npmCommand = process.platform === 'win32' ? process.execPath : 'npm';
const npmCliPrefix = process.platform === 'win32'
  ? [path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')]
  : [];

const run = (command, args, cwd = root) => {
  const result = spawnSync(command, args, {cwd, stdio: 'inherit'});
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}.`);
};

await rm(releaseDirectory, {recursive: true, force: true});
await mkdir(releaseDirectory, {recursive: true});
run(npmCommand, [...npmCliPrefix, 'pack', '--pack-destination', releaseDirectory]);
run(npmCommand, [...npmCliPrefix, 'pack', './tree-sitter-framescript', '--pack-destination', releaseDirectory]);
run(npmCommand, [...npmCliPrefix, 'run', preRelease ? 'package:pre-release' : 'package'], path.join(root, 'editors', 'vscode'));
await copyFile(
  path.join(root, 'editors', 'vscode', 'dist', 'framescript-vscode.vsix'),
  path.join(releaseDirectory, `framescript-vscode-${packageJson.version}.vsix`),
);

const names = (await readdir(releaseDirectory)).filter((name) => name !== 'SHA256SUMS.txt').sort();
const sums = [];
for (const name of names) {
  const contents = await readFile(path.join(releaseDirectory, name));
  sums.push(`${createHash('sha256').update(contents).digest('hex')}  ${name}`);
}
await writeFile(path.join(releaseDirectory, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`, 'utf8');
process.stdout.write(`Release artifacts written to ${releaseDirectory}\n`);
