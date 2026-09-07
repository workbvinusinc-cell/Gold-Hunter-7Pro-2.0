module.exports = {
  apps: [{
    name: 'xauusd-hft',
    script: './backend/server.js',
    cwd: __dirname,
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_memory_restart: '500M',
    env: { NODE_ENV: 'production' }
  }]
};
