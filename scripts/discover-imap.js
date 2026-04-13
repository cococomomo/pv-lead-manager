#!/usr/bin/env node
/**
 * IMAP Host Discovery Script
 * Tries common IMAP hostnames for the configured email domain and reports which ones accept connections.
 */

const net = require('net');
const tls = require('tls');
const dns = require('dns').promises;

require('dotenv').config({ path: require('path').join(__dirname, '../.env.txt') });

const email = process.env.IMAP_USER || '';
const domain = email.split('@')[1] || '';
const password = process.env.IMAP_PASSWORD || '';

if (!domain) {
  console.error('No IMAP_USER found in .env.txt');
  process.exit(1);
}

console.log(`\nDiscovering IMAP server for domain: ${domain}`);
console.log('='.repeat(50));

const candidates = [
  `mail.${domain}`,
  `imap.${domain}`,
  `webmail.${domain}`,
  `smtp.${domain}`,
  `mx.${domain}`,
  domain,
];

const ports = [
  { port: 993, tls: true,  label: 'IMAPS (993)' },
  { port: 143, tls: false, label: 'IMAP  (143)' },
];

function tryTlsConnect(host, port, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const socket = tls.connect({ host, port, rejectUnauthorized: false }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.setTimeout(timeoutMs);
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.on('error', () => { socket.destroy(); resolve(false); });
  });
}

function tryPlainConnect(host, port, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.setTimeout(timeoutMs);
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.on('error', () => { socket.destroy(); resolve(false); });
  });
}

async function getMxHosts(domain) {
  try {
    const records = await dns.resolveMx(domain);
    records.sort((a, b) => a.priority - b.priority);
    return records.map(r => r.exchange);
  } catch {
    return [];
  }
}

async function main() {
  // Add MX-derived hostnames
  console.log('\nLooking up MX records...');
  const mxHosts = await getMxHosts(domain);
  if (mxHosts.length) {
    console.log('MX records found:', mxHosts.join(', '));
    for (const mx of mxHosts) {
      if (!candidates.includes(mx)) candidates.unshift(mx);
    }
  } else {
    console.log('No MX records found.');
  }

  console.log('\nTesting connections...\n');

  const working = [];

  for (const host of candidates) {
    for (const { port, tls: useTls, label } of ports) {
      const ok = useTls
        ? await tryTlsConnect(host, port)
        : await tryPlainConnect(host, port);
      const status = ok ? '✓ OPEN  ' : '✗ closed';
      console.log(`  ${status}  ${host}:${port}  (${label})`);
      if (ok) working.push({ host, port, tls: useTls, label });
    }
  }

  console.log('\n' + '='.repeat(50));
  if (working.length === 0) {
    console.log('No reachable IMAP endpoints found.');
  } else {
    console.log('Reachable endpoints:');
    for (const w of working) {
      console.log(`  → ${w.host}:${w.port}  (${w.label})`);
    }
    const best = working[0];
    console.log(`\nRecommended setting:\n  IMAP_HOST=${best.host}\n  IMAP_PORT=${best.port}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
