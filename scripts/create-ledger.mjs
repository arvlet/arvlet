import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { randomUUID } from "node:crypto";

const kind = process.argv[2] || "table";
if (!["table", "worklog"].includes(kind)) {
  throw new Error("Usage: node scripts/create-ledger.mjs [table|worklog]");
}
const config = parseEnv(
  readFileSync(new URL("../.env", import.meta.url), "utf8"),
);
const date = new Date().toISOString().slice(0, 10);
const run = randomUUID();
async function write(path, method, body) {
  const response = await fetch(config.ARVLET_ORIGIN + "/api/v1" + path, {
    method,
    headers: {
      Authorization: `Bearer ${config.ARVLET_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `${run}:${path}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error(`${response.status}: ${await response.text()}`);
  return response.json();
}
const table = kind === "table";
const artifact = await write("/artifacts", "POST", {
  title: table ? "表格台账 · 单元格编辑" : "Agent 工作台账",
  kind: "html",
  collection: "Examples",
  content: readFileSync(
    new URL(
      `../examples/${table ? "table-ledger" : "worklog"}.html`,
      import.meta.url,
    ),
    "utf8",
  ),
});
const data = table
  ? {
      schemaVersion: 1,
      rows: [
        {
          id: randomUUID(),
          date,
          agent: "Example Agent",
          subject: "示例记录",
          category: "示例",
          result: "单击单元格即可修改，编辑后点击保存。",
          note: "可修改或删除",
        },
      ],
    }
  : {
      schemaVersion: 1,
      entries: [
        {
          id: randomUUID(),
          date,
          agent: "Example Agent",
          title: "创建示例台账",
          category: "其他",
          result: "这是一条示例记录，可以编辑或新增。",
        },
      ],
    };
await write(`/artifacts/${artifact.id}/state`, "PUT", { revision: 0, data });
const share = await write(`/artifacts/${artifact.id}/shares`, "POST", {});
// The returned edit URL is a capability. Print only when explicitly creating a share.
console.log(`Artifact: ${artifact.id}`);
console.log(`Workbench: ${config.ARVLET_ORIGIN}/?artifact=${artifact.id}`);
const host = config.ARVLET_SHARE_BIND || "127.0.0.1";
if (host === "0.0.0.0" || host.includes(":")) {
  console.log(
    `Share path: ${share.path} (append to your reachable share origin)`,
  );
} else {
  console.log(
    `Editable share: http://${host}:${config.ARVLET_SHARE_PORT || 3091}${share.path}`,
  );
}
