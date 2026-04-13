/** PM2: auf dem Server im Repo-Verzeichnis `pm2 start ecosystem.config.cjs` (einmal) bzw. `pm2 restart pv-lead-manager` */
module.exports = {
  apps: [
    {
      name: 'pv-lead-manager',
      script: 'src/server.js',
      instances: 1,
      autorestart: true,
      max_restarts: 30,
      min_uptime: '4s',
      env: { NODE_ENV: 'production' },
    },
  ],
};
