#!/usr/bin/env node
// Generate once into a private, ignored file. Never print private key material.
import { createRequire } from 'node:module';
import { mkdir, lstat, open } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../web/package.json', import.meta.url));
const webpush = require('web-push');
const dotenv = require('dotenv');
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
const root = new URL('../data/secrets/', import.meta.url);
const subject = new URL(process.env.APP_URL ?? '');
if (subject.protocol !== 'https:' || subject.username || subject.password) throw new Error('HTTPS APP_URL required');
await mkdir(root, { recursive: true, mode: 0o700 });
if ((await lstat(root)).isSymbolicLink()) throw new Error('Symlink secret directory rejected');
const keys = webpush.generateVAPIDKeys();
const handle = await open(new URL('web-push.env', root), 'wx', 0o600);
try {
  await handle.writeFile(`WEB_PUSH_PUBLIC_KEY=${keys.publicKey}\nWEB_PUSH_PRIVATE_KEY=${keys.privateKey}\nWEB_PUSH_SUBJECT=${subject.origin}\n`);
  await handle.sync();
} finally { await handle.close(); }
console.log('Created data/secrets/web-push.env with mode 0600; deployment configuration was not changed.');
