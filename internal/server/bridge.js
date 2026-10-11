(() => {
  // This value is JSON-encoded by Go. It identifies a preview, never an API key.
  const channel = __ARVLET_CHANNEL__;
  const pending = new Map();
  let nextID = 0;

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (
      event.source !== parent ||
      !message ||
      message.channel !== channel ||
      message.type !== "arvlet:reply"
    ) {
      return;
    }

    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);

    if (message.error) request.reject(new Error(message.error));
    else request.resolve(message.result);
  });

  function call(operation, payload) {
    return new Promise((resolve, reject) => {
      const id = String(++nextID);
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("Arvlet request timed out"));
      }, 15000);

      pending.set(id, { resolve, reject, timer });
      parent.postMessage(
        { type: "arvlet:request", channel, id, op: operation, payload },
        "*",
      );
    });
  }

  Object.defineProperty(window, "arvlet", {
    value: Object.freeze({
      getState: () => call("state.get"),
      setState: (data, revision) => call("state.put", { data, revision }),
    }),
    writable: false,
  });
})();
