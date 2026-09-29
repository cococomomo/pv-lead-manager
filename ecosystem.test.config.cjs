'use strict';

/**
 * PM2 für die Testinstanz. Niemals `ecosystem.config.cjs` / `pv-lead-manager` verwenden.
 * Läuft nur in einem eigenen Checkout (nicht im Production-Verzeichnis).
 * PORT hier gewinnt gegenüber PORT in der .env (dotenv überschreibt gesetzte Variablen nicht).
 */
module.exports = {
  apps: [
    {
      name: 'pv-lead-manager-test',
      script: './src/server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 3081,
        APP_BASE_PATH: '/test',
        SESSION_COOKIE_NAME: 'pvltest.sid',
      },
    },
  ],
};
