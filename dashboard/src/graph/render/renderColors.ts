export function nodeRgb(
  packed: Uint32Array,
  renderIds: Uint32Array,
  selectedRenderId: number | null,
  hoveredRenderId: number | null = null,
) {
  const rgb = new Uint8Array(packed.length * 3);
  for (let index = 0; index < packed.length; index += 1) {
    const emphasized = (selectedRenderId === null && hoveredRenderId === null)
      || renderIds[index] === selectedRenderId
      || renderIds[index] === hoveredRenderId;
    writeRgb(rgb, index * 3, packed[index], emphasized ? 1 : 0.16);
  }
  return rgb;
}

export function edgeRgb(packed: Uint32Array, weights: Float32Array) {
  const rgb = new Uint8Array(packed.length * 6);
  for (let index = 0; index < packed.length; index += 1) {
    const intensity = Math.max(0.08, Math.min(1, weights[index] * 0.7));
    writeRgb(rgb, index * 6, packed[index], intensity);
    writeRgb(rgb, index * 6 + 3, packed[index], intensity);
  }
  return rgb;
}

function writeRgb(target: Uint8Array, offset: number, packed: number, intensity: number) {
  target[offset] = Math.round(((packed >>> 24) & 0xff) * intensity);
  target[offset + 1] = Math.round(((packed >>> 16) & 0xff) * intensity);
  target[offset + 2] = Math.round(((packed >>> 8) & 0xff) * intensity);
}
