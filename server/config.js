// Process-wide settings from the environment.
export const env = {
  port: Number(process.env.PORT || 3000),
  databaseUrl: process.env.DATABASE_URL || "postgres://dbc:dbc@localhost:5432/dbc",
  // "dev": name-only login for local development and simulations. Production swaps in a real
  // provider (e.g. Replit Auth) by implementing server/auth/<provider>.js with the same shape.
  authProvider: process.env.AUTH_PROVIDER || "dev",
  // Cookies are marked Secure when served over https (set COOKIE_SECURE=1 behind a TLS proxy).
  cookieSecure: process.env.COOKIE_SECURE === "1",
  // How many rounds may simulate at once across all games (each round spawns ~3 processes per team).
  maxConcurrentRounds: Number(process.env.MAX_CONCURRENT_ROUNDS || 4),
};
