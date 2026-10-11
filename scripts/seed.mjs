import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

const config = parseEnv(
  readFileSync(new URL("../.env", import.meta.url), "utf8"),
);
const base = config.ARVLET_ORIGIN;
async function write(path, body, key) {
  const response = await fetch(base + "/api/v1" + path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.ARVLET_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": key,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error(`${response.status}: ${await response.text()}`);
  return response.json();
}
const demos = [
  {
    title: "月度预算 · 交互工具",
    kind: "html",
    collection: "生活工具",
    content: readFileSync(
      new URL("../examples/budget.html", import.meta.url),
      "utf8",
    ),
  },
  {
    title: "Arvlet · 产品手记",
    kind: "markdown",
    collection: "产品设计",
    content:
      "# 把成果留在手边\n\nArvlet 是一个围绕 **产物与记录** 的工作区。\n\n## 两个简单的概念\n\n- **产物**：可以打开、编辑、继续使用的成果。\n- **记录**：一次观察、修改说明，或 Agent 的执行结果。\n\n## 内容会演进，历史会留下\n\n每次编辑保存为一个新版本。交互数据单独保存在服务端，不会随着代码更新而丢失。\n\n> 这是一份演示文档，你可以直接修改它。\n",
  },
  {
    title: "阅读清单 · 示例数据",
    kind: "json",
    collection: "个人知识库",
    content: JSON.stringify(
      [
        { title: "The Design of Everyday Things", topic: "设计" },
        { title: "A Philosophy of Software Design", topic: "工程" },
      ],
      null,
      2,
    ),
  },
];
for (const [index, demo] of demos.entries()) {
  const artifact = await write("/artifacts", demo, `demo-artifact-${index}`);
  await write(
    "/entries",
    {
      artifact_id: artifact.id,
      agent: "Demo Agent",
      message: `通过 API 创建了「${demo.title}」。这是一份演示产物，可以编辑内容并保留版本。`,
    },
    `demo-entry-${index}`,
  );
}
await write(
  "/entries",
  {
    agent: "Demo Agent",
    message: "工作区已就绪。产物可直接创建；记录也可独立存在，无需先建立任务。",
  },
  "demo-welcome",
);
console.log("Created 3 demo artifacts and 4 entries through the public API.");
