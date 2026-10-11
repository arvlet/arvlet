import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const template = readFileSync(
  new URL("../.env.example", import.meta.url),
  "utf8",
);
const contents = template.replace(
  /^(ARVLET_API_KEY|ARVLET_PASSWORD|ARVLET_SESSION_SECRET)=$/gm,
  (_, key) => `${key}=${randomBytes(32).toString("base64url")}`,
);
// Exclusive creation prevents accidentally rotating credentials on a second run.
writeFileSync(new URL("../.env", import.meta.url), contents, {
  flag: "wx",
  mode: 0o600,
});
console.log(
  "Created .env. Read ARVLET_PASSWORD to sign in; give ARVLET_API_KEY only to trusted agents.",
);
