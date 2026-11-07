import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';

const path = resolve(import.meta.dir, '../data/party-host-key.json');
if (!existsSync(path)) writeFileSync(path, JSON.stringify({ key: randomBytes(32).toString('base64url') }) + '\n', { flag: 'wx', mode: 0o600 });
chmodSync(path, 0o600);
console.log('Private host key is ready. No key was printed.');
