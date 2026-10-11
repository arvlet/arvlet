(() => {
  const frame = document.querySelector("iframe");
  const base = location.pathname.replace(/\/$/, "");
  // LAN HTTP is not a secure context: randomUUID is unavailable there.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const channel = Array.from(bytes, (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  let busy = false;
  window.addEventListener("message", async (event) => {
    const request = event.data;
    if (
      event.source !== frame.contentWindow ||
      event.origin !== "null" ||
      request?.type !== "arvlet:request" ||
      request.channel !== channel ||
      typeof request.id !== "string" ||
      request.id.length > 100
    )
      return;
    const reply = (result, error) =>
      frame.contentWindow.postMessage(
        { type: "arvlet:reply", channel, id: request.id, result, error },
        "*",
      );
    if (busy) {
      reply(undefined, "Another request is in progress");
      return;
    }
    busy = true;
    try {
      if (!["state.get", "state.put"].includes(request.op))
        throw new Error("Unsupported operation");
      const writing = request.op === "state.put";
      const body = writing ? JSON.stringify(request.payload) : undefined;
      if (writing && (!body || body.length > 210000))
        throw new Error("Invalid state payload");
      const response = await fetch(base + "/state", {
        method: writing ? "PUT" : "GET",
        credentials: "omit",
        headers: writing ? { "Content-Type": "application/json" } : {},
        body,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to save");
      reply(result);
    } catch (error) {
      reply(undefined, error.message);
    } finally {
      busy = false;
    }
  });
  frame.src = base + "/preview?channel=" + channel;
  frame.hidden = false;
})();
