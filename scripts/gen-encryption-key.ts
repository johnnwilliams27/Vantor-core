#!/usr/bin/env node
/**
 * One-shot generator for CREDENTIALS_ENCRYPTION_KEY.
 * Prints two lines suitable for pasting into .env.local.
 *
 * Usage: npm run crypto:gen
 */
import { randomBytes } from 'node:crypto';

const key = randomBytes(32).toString('hex');

process.stdout.write(`CREDENTIALS_ENCRYPTION_KEY=${key}\n`);
process.stdout.write(`CREDENTIALS_ENCRYPTION_KEY_ID=v1\n`);
process.stdout.write('\n');
process.stdout.write('Copy the two lines above into your .env.local.\n');
process.stdout.write('Never commit this key. Never share it over insecure channels.\n');
