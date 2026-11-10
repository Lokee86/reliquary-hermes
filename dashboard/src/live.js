(function (browser) {
  "use strict";

  const sdk = browser.__HERMES_PLUGIN_SDK__;
  const registry = browser.__HERMES_PLUGINS__;
  if (!sdk || !registry || sdk.sdkVersion !== "1.1.0" || typeof sdk.authedFetch !== "function") {
    throw new Error("Reliquary requires the Hermes web dashboard plugin SDK 1.1.0.");
  }
  // Web dialogs use the authenticated profile-scoped setup API.
  registry.register("reliquary-hermes", createReliquarySurface({
    React: sdk.React, hooks: sdk.hooks, components: webComponents(sdk),
    authedFetch: sdk.authedFetch, webDialogPicker: true, surfaceLabel: "HERMES WEB DASHBOARD PLUGIN",
  }));
})(window);
