module.exports = {
  apps: [
    {
      name: "demir-cashless-reports",
      script: "server.js",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
        PORT: process.env.PORT || 3100
      }
    }
  ]
};
