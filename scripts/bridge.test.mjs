import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";

test("preview bridge only accepts matching parent replies and preserves revisions", async () => {
  let receive;
  const messages = [];
  const parent = { postMessage: (message) => messages.push(message) };
  const window = {
    addEventListener: (_, listener) => {
      receive = listener;
    },
  };
  const source = readFileSync(
    new URL("../internal/server/bridge.js", import.meta.url),
    "utf8",
  );
  runInNewContext(source.replace("__ARVLET_CHANNEL__", '"test-channel"'), {
    parent,
    window,
    setTimeout,
    clearTimeout,
  });
  let resolved = false;
  const pending = window.arvlet.getState().then((value) => {
    resolved = true;
    return value;
  });
  const request = messages[0];
  assert.equal(request.op, "state.get");
  const reply = {
    ...request,
    type: "arvlet:reply",
    result: { revision: 3, data: { total: 5 } },
  };
  receive({ source: {}, data: reply });
  receive({ source: parent, data: { ...reply, channel: "wrong" } });
  await Promise.resolve();
  assert.equal(resolved, false);
  receive({ source: parent, data: reply });
  assert.equal((await pending).revision, 3);
  const saved = window.arvlet.setState({ total: 6 }, 3);
  const write = messages[1];
  assert.equal(write.payload.revision, 3);
  receive({
    source: parent,
    data: {
      ...write,
      type: "arvlet:reply",
      error: "Write permission required",
    },
  });
  await assert.rejects(saved, /Write permission/);
});
