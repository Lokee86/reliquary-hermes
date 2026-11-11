/** Observe the real native HTTP transport without recording authorization headers. */
export async function installGraphRequestProbe(app) {
  await app.evaluate(async () => {
    const http = process.getBuiltinModule("node:http");
    const original = http.request;
    globalThis.reliquaryGraphSmokeTraffic = [];
    http.request = function (...args) {
      const request = original.apply(this, args);
      const url = args[0] instanceof URL ? args[0] : null;
      const operation = url?.pathname.match(/\/graph-render-v1\/([a-z-]+)$/)?.[1];
      if (!operation) return request;
      const entry = { operation, body: null };
      globalThis.reliquaryGraphSmokeTraffic.push(entry);
      const parts = [];
      const write = request.write;
      const end = request.end;
      request.write = function (chunk, ...rest) {
        if (chunk) parts.push(Buffer.from(chunk));
        return write.call(this, chunk, ...rest);
      };
      request.end = function (chunk, ...rest) {
        if (chunk && typeof chunk !== "function") parts.push(Buffer.from(chunk));
        try { entry.body = JSON.parse(Buffer.concat(parts).toString("utf8")); } catch { /* No JSON body. */ }
        return end.call(this, chunk, ...rest);
      };
      request.on("response", response => {
        entry.status = response.statusCode;
        if (operation !== "prepare" || response.statusCode !== 200) return;
        const chunks = [];
        response.on("data", chunk => chunks.push(chunk));
        response.on("end", () => {
          try { entry.manifest = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* Reported by acceptance. */ }
        });
      });
      return request;
    };
  });
  return () => app.evaluate(() => globalThis.reliquaryGraphSmokeTraffic);
}
