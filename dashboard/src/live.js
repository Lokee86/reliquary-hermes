(function (browser) {
  "use strict";

  const sdk = browser.__HERMES_PLUGIN_SDK__;
  const registry = browser.__HERMES_PLUGINS__;
  if (!sdk || !registry || sdk.sdkVersion !== "1.1.0" || typeof sdk.authedFetch !== "function") {
    throw new Error("Reliquary requires the Hermes web dashboard plugin SDK 1.1.0.");
  }
  registry.register("reliquary-hermes", createReliquarySurface({
    React: sdk.React, hooks: sdk.hooks, authedFetch: sdk.authedFetch, surfaceLabel: "HERMES WEB DASHBOARD PLUGIN",
  }));
})(window);
