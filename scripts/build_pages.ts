// Builds the static archive for GitHub Pages into dist/. Usage: bun scripts/build_pages.ts [base-path]
// Needs the locked record in data/final/ (the count must be final: a static page cannot refresh).
// Writes the API responses the page reads as JSON files, leaves the audio clips out, and never opens a database.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { loadFinal } from '../backend-lib/final';

const root = new URL('../', import.meta.url).pathname;
const base = process.argv[2] ?? '/tired-of-winning/';
if (!/^\/([a-z0-9-]+\/)?$/.test(base)) throw new Error(`Base path must look like /name/, got ${base}`);
if (!(await loadFinal(root + 'data/final/'))) throw new Error('No locked record in data/final/: the static archive is only built from the final count.');

const build = Bun.spawnSync(['bunx', 'vite', 'build'], { cwd: root, env: { ...process.env, PAGES_BASE: base, VITE_STATIC: '1' }, stdout: 'inherit', stderr: 'inherit' });
if (build.exitCode !== 0) throw new Error('vite build failed');

const { dashboard, auditExport } = await import('../backend-lib/election');
const election = await dashboard();
if (!election.final) throw new Error('The count is not locked.');
const reactions = await Bun.file(root + 'data/final/reactions-20261104.json').json();
const dist = root + 'dist/';
rmSync(dist + 'sounds', { recursive: true, force: true });
mkdirSync(dist + 'api', { recursive: true });
writeFileSync(dist + 'api/election.json', JSON.stringify(election));
writeFileSync(dist + 'api/reactions.json', JSON.stringify(reactions));
writeFileSync(dist + 'api/receipts.json', JSON.stringify(auditExport()));
cpSync(dist + 'index.html', dist + '404.html');
writeFileSync(dist + '.nojekyll', '');
if (existsSync(dist + 'sounds')) throw new Error('Audio clips must not ship in the static archive.');
console.log(`Static archive built in ${dist} for ${base}: ${election.races.length} races, locked ${election.final.frozenAt} (${election.final.reason}), ${election.final.uncalled} uncalled.`);
