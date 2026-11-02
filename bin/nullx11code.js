#!/usr/bin/env node
import { entry } from '../src/entry.js';

entry(process.argv.slice(2)).catch((err) => {
  console.error(`\x1b[31merror:\x1b[0m ${err?.message || err}`);
  if (process.env.NULLX11_DEBUG) console.error(err);
  process.exit(1);
});
