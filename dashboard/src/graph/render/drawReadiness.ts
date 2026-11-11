/** Calls graph-ready once, after a node chunk's onAfterRender callback fires. */
export function createDrawReadyReporter(onReady: () => void) {
  let reported = false;
  return () => {
    if (reported) return;
    reported = true;
    onReady();
  };
}
