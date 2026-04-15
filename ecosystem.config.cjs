'use strict';

/** PM2: NOORTEC Web-App. Lead-Import über n8n → POST /api/webhook/n8n-lead. */
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
