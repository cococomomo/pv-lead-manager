'use strict';

/** PM2: NOORTEC Web-App. IMAP-Import nur manuell (Dashboard POST /api/sync-leads oder `npm run poll`). */
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
  ],
};
