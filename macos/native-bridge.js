(() => {
  if (!window.webkit?.messageHandlers?.notes) return;

  const pending = new Map();
  let requestNumber = 0;
  const browserFetch = window.fetch.bind(window);

  window.__nativeNotesResolve = (packet) => {
    const request = pending.get(packet.id);
    if (!request) return;
    pending.delete(packet.id);

    if (packet.transportError) {
      request.reject(new TypeError(packet.transportError));
      return;
    }

    const responseBody = packet.status === 204 ? null : JSON.stringify(packet.body);
    request.resolve(
      new Response(responseBody, {
        status: packet.status,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      })
    );
  };

  window.fetch = (input, options = {}) => {
    const path = typeof input === "string" ? input : input.url;
    if (!path.startsWith("/api/")) return browserFetch(input, options);

    const id = `native-${Date.now()}-${requestNumber++}`;
    let body = null;
    if (typeof options.body === "string" && options.body.length) {
      try {
        body = JSON.parse(options.body);
      } catch {
        return Promise.resolve(
          new Response(JSON.stringify({ error: "JSON inválido" }), {
            status: 400,
            headers: { "Content-Type": "application/json; charset=utf-8" },
          })
        );
      }
    }

    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      window.webkit.messageHandlers.notes.postMessage({
        id,
        path,
        method: (options.method || "GET").toUpperCase(),
        body,
      });
    });
  };
})();
