(function (root) {
  "use strict";

  /**
   * @template {import("../types").ReadOperation} K
   * @param {import("../types").DashboardClient} client
   * @param {K} operation
   * @param {import("../types").ReadScope} scope
   * @param {import("../types").ReadArgs[K] | null} args
   * @returns {import("../types").ReadHandle<import("../types").ReadResults[K]>}
   */
  function useRead(client, operation, scope, args) {
    const { useState, useEffect } = root.ReliquaryDashboardHost.hooks;
    const [attempt, setAttempt] = useState(0);
    const [snapshot, setSnapshot] = useState(/** @type {{ client: import("../types").DashboardClient, key: string, state: import("../types").ReadOutcome<import("../types").ReadResults[K]> } | null} */ (null));
    const key = JSON.stringify([operation, scope, args, attempt]);

    useEffect(() => {
      if (args === null) return;
      const controller = new AbortController();
      client.read(operation, scope, args, controller.signal).then((state) => {
        if (!controller.signal.aborted) setSnapshot({ client, key, state });
      }, () => {
        if (!controller.signal.aborted) {
          setSnapshot({ client, key, state: { status: "error", code: "request_failed", retryable: true } });
        }
      });
      return () => controller.abort();
    }, [client, key]);

    return {
      state: args === null ? { status: "idle" } : snapshot?.client === client && snapshot.key === key ? snapshot.state : { status: "loading" },
      retry: () => setAttempt((value) => value + 1),
    };
  }

  /** @returns {import("../types").CursorState} */
  function useCursor() {
    const { useState } = root.ReliquaryDashboardHost.hooks;
    const [trail, setTrail] = useState(/** @type {(string | null)[]} */ ([null]));
    return {
      current: trail[trail.length - 1],
      next: (cursor) => setTrail((previous) => [...previous, cursor]),
      previous: () => setTrail((previous) => previous.length > 1 ? previous.slice(0, -1) : previous),
      reset: () => setTrail([null]),
    };
  }

  root.ReliquaryDashboardState = { useRead, useCursor };
})(globalThis);
