module.exports = {
  apps: [{
    name: 'nextjs',
    script: 'sh',
    args: '-c "npm run dev"',
    cwd: '/app',
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'development',
      PORT: 3000
    }
  }]
};