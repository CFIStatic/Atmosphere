#!/usr/bin/env node
/**
 * Pull a public https://*.up.railway.app origin out of Railway CLI JSON/text.
 */
import fs from 'node:fs';

const raw = fs.readFileSync(0, 'utf8');
const match =
  raw.match(/https:\/\/[a-z0-9.-]+\.up\.railway\.app/i) ||
  raw.match(/[a-z0-9-]+\.up\.railway\.app/i);
if (!match) process.exit(0);
const value = match[0].startsWith('http') ? match[0] : `https://${match[0]}`;
process.stdout.write(value.toLowerCase());
