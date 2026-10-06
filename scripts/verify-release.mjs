import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const readJson = async (file) => JSON.parse(await readFile(path.join(root, file), 'utf8'));
const compiler = await readJson('package.json');
const grammar = await readJson('tree-sitter-framescript/package.json');
const extension = await readJson('editors/vscode/package.json');

const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

check(compiler.name === 'framescript', "Compiler package must be named 'framescript'.");
check(compiler.private === false, 'Compiler package must be publishable.');
check(grammar.private !== true, 'Tree-sitter package must be publishable.');
check(extension.private === false, 'VS Code extension must be publishable.');
check(grammar.version === compiler.version, 'Tree-sitter and compiler versions must match.');
check(extension.version === compiler.version, 'VS Code extension and compiler versions must match.');
check(compiler.license === 'MIT' && grammar.license === 'MIT' && extension.license === 'MIT', 'All artifacts must declare the MIT license.');
check(typeof extension.publisher === 'string' && extension.publisher.length > 0, 'VS Code publisher is required.');

const tag = process.env.GITHUB_REF_NAME;
if (tag?.startsWith('v')) check(tag.slice(1) === compiler.version, `Tag '${tag}' must match package version '${compiler.version}'.`);

const githubRepository = process.env.GITHUB_REPOSITORY;
if (githubRepository) {
  const repositoryUrl = typeof compiler.repository === 'string' ? compiler.repository : compiler.repository?.url;
  const normalizedRepository = repositoryUrl?.replace(/^git\+/u, '').replace(/\.git$/u, '').toLowerCase();
  check(
    normalizedRepository === `https://github.com/${githubRepository}`.toLowerCase(),
    `package.json repository must match GitHub repository '${githubRepository}' for npm trusted publishing. Run 'npm run repository:set -- ${githubRepository}'.`,
  );
}

for (const file of ['LICENSE', 'README.md', 'CHANGELOG.md', 'SECURITY.md', 'docs/PUBLISHING.md']) {
  try { await readFile(path.join(root, file)); } catch { failures.push(`Required release file '${file}' is missing.`); }
}

const npmArgs = ['pack', '--dry-run', '--json', '--ignore-scripts'];
const npmCommand = process.platform === 'win32' ? process.execPath : 'npm';
if (process.platform === 'win32') {
  npmArgs.unshift(path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'));
}
const dryRun = spawnSync(npmCommand, npmArgs, {
  cwd: root,
  encoding: 'utf8',
});
if (dryRun.status !== 0) {
  failures.push(`npm pack dry-run failed: ${(dryRun.stderr ?? dryRun.error?.message ?? 'unknown error').trim()}`);
} else {
  const packed = JSON.parse(dryRun.stdout)[0];
  const files = new Set((packed?.files ?? []).map(({path: file}) => file));
  for (const required of ['dist/src/index.js', 'dist/src/cli.js', 'dist/src/lsp/server.js', 'README.md', 'LICENSE']) {
    check(files.has(required), `npm artifact is missing '${required}'.`);
  }
  for (const file of files) {
    check(!/^(?:tests|examples|editors|\.framescript|node_modules)\//u.test(file), `npm artifact must not include '${file}'.`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`release error: ${failure}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Release metadata verified for FrameScript ${compiler.version}.\n`);
}
