'use strict';

/** PM2: Web-App + optional IMAP-Poller. Auf dem Server: `pm2 start ecosystem.config.cjs` */
module.exports = {
  apps: [
    {
      name: 'pv-lead-manager',
      script: './src/server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'pv-lead-poll',
      script: './scripts/pv-lead-poll.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      env: { NODE_ENV: 'production' },
    },
  ],
};
