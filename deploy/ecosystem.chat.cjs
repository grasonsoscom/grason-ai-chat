module.exports = {
  apps: [
    {
      name: "grason-chat",
      script: "npm",
      args: "start",
      cwd: "/opt/grason-ai-chat",
      env: { NODE_ENV: "production", PORT: "3000" },
    },
  ],
};
