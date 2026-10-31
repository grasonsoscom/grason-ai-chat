module.exports = {
  apps: [
    {
      name: "oms-api",
      script: "dist/main.js",
      cwd: "/opt/grason-oms/apps/api",
      env: { NODE_ENV: "production" },
    },
    {
      name: "oms-worker",
      script: "dist/main.js",
      cwd: "/opt/grason-oms/apps/worker",
      env: { NODE_ENV: "production" },
    },
    {
      name: "oms-web",
      script: "pnpm",
      args: "--filter @grason/web exec next start --port 3002",
      cwd: "/opt/grason-oms",
      env: { NODE_ENV: "production" },
    },
  ],
};
