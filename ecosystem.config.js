module.exports = {
  apps: [
    {
      name: 'do-an-api',
      script: './dist/apps/do-an/main.js',
      instances: 3,
      exec_mode: 'cluster',
      watch: false,
    },
    {
      name: 'do-an-worker',
      script: './dist/apps/worker/main.js',
      instances: 2,
      exec_mode: 'fork',
      watch: false,
    },
  ],
};
