/** Calls graph-ready once after every planned node chunk has submitted a draw. */
export function createDrawReadyReporter(expectedChunkIds: readonly number[], onReady: () => void) {
  const expected = new Set(expectedChunkIds);
  const drawn = new Set<number>();
  let reported = false;
  return (chunkId: number) => {
    if (!expected.has(chunkId)) return;
    drawn.add(chunkId);
    if (drawn.size !== expected.size) return;
    if (reported) return;
    reported = true;
    onReady();
  };
}
