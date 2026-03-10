module.exports = {
  apps: [
    {
      name: "game",
      script: "src/app.js",
      instances: 1, // Single instance — game uses in-memory state (timers, grace periods). Cluster mode requires Redis adapter + state migration.
      exec_mode: "fork",
      max_memory_restart: "1G",
      node_args: "--max-old-space-size=2048",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
