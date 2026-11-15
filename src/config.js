require("dotenv").config();

const required = [
  "DISCORD_TOKEN", "CLIENT_ID", "MAIN_GUILD_ID",
  "CONTROL_CHANNEL_ID", "ACCESS_ROLE_ID",
  "LOGS_GUILD_ID", "LOGS_CHANNEL_ID"
];

const missing = required.filter((key) =>
  !process.env[key] || process.env[key].startsWith("PUT_")
);

if (missing.length) {
  console.error(`[CONFIG] Missing values in .env: ${missing.join(", ")}`);
  process.exit(1);
}

module.exports = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  mainGuildId: process.env.MAIN_GUILD_ID,
  controlChannelId: process.env.CONTROL_CHANNEL_ID,
  accessRoleId: process.env.ACCESS_ROLE_ID,
  logsGuildId: process.env.LOGS_GUILD_ID,
  logsChannelId: process.env.LOGS_CHANNEL_ID,
  sessionTtlMs: Math.max(60_000, Number(process.env.SESSION_TTL_MS) || 600_000)
};