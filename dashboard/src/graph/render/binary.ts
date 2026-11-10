import type {
  GraphRenderEdgeChunk,
  GraphRenderNodeChunk,
  GraphRenderNodeChunkDescriptor,
} from "./types";

const HEADER_BYTES = 32;
const NODE_BYTES = 24;
const EDGE_BYTES = 32;
const VERSION = 1;
const NODE_MAGIC = [0x57, 0x52, 0x4e, 0x4f, 0x44, 0x45, 0x00, 0x00] as const;
const EDGE_MAGIC = [0x57, 0x52, 0x45, 0x44, 0x47, 0x45, 0x00, 0x00] as const;

interface Header {
  generationId: bigint;
  payloadId: number;
  itemCount: number;
}

export function decodeNodeChunk(
  raw: Uint8Array,
  expectedGenerationId: string,
  descriptor: GraphRenderNodeChunkDescriptor,
): GraphRenderNodeChunk {
  const header = decodeHeader(raw, NODE_MAGIC, NODE_BYTES);
  validateHeader(
    header,
    expectedGenerationId,
    descriptor.chunkId,
    descriptor.nodeCount,
  );

  const count = header.itemCount;
  const base = raw.byteOffset + HEADER_BYTES;
  const buffer = raw.buffer as ArrayBuffer;
  const positions = new Float32Array(buffer, base, count * 3);
  const colorsOffset = base + count * 12;
  const packedColors = new Uint32Array(buffer, colorsOffset, count);
  const sizesOffset = colorsOffset + count * 4;
  const sizes = new Float32Array(buffer, sizesOffset, count);
  const idsOffset = sizesOffset + count * 4;
  const renderIds = new Uint32Array(buffer, idsOffset, count);
  for (const candidate of descriptor.labelCandidates) {
    if (candidate.itemIndex >= count) {
      throw new Error("graph render label candidate index is out of range");
    }
    if (renderIds[candidate.itemIndex] !== candidate.renderId) {
      throw new Error("graph render label candidate identity mismatch");
    }
  }

  return {
    raw,
    generationId: header.generationId,
    chunkId: header.payloadId,
    nodeCount: count,
    positions,
    packedColors,
    sizes,
    renderIds,
    bounds: descriptor.bounds,
    labelCandidates: descriptor.labelCandidates,
  };
}

export function decodeEdgeChunk(
  raw: Uint8Array,
  expectedGenerationId: string,
  expectedChunkId: number,
  expectedCount: number,
): GraphRenderEdgeChunk {
  const header = decodeHeader(raw, EDGE_MAGIC, EDGE_BYTES);
  validateHeader(header, expectedGenerationId, expectedChunkId, expectedCount);

  const count = header.itemCount;
  const base = raw.byteOffset + HEADER_BYTES;
  const buffer = raw.buffer as ArrayBuffer;
  const endpoints = new Float32Array(buffer, base, count * 6);
  const weightsOffset = base + count * 24;
  const weights = new Float32Array(buffer, weightsOffset, count);
  const colorsOffset = weightsOffset + count * 4;
  const packedColors = new Uint32Array(buffer, colorsOffset, count);

  return {
    raw,
    generationId: header.generationId,
    chunkId: header.payloadId,
    segmentCount: count,
    endpoints,
    weights,
    packedColors,
  };
}

function decodeHeader(
  raw: Uint8Array,
  magic: readonly number[],
  bytesPerItem: number,
): Header {
  if (raw.byteLength < HEADER_BYTES) throw new Error("graph render payload is shorter than its header");
  for (let index = 0; index < magic.length; index += 1) {
    if (raw[index] !== magic[index]) throw new Error("graph render payload magic is invalid");
  }

  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const version = view.getUint16(8, true);
  const headerBytes = view.getUint16(10, true);
  const flags = view.getUint32(12, true);
  if (version !== VERSION) throw new Error(`unsupported graph render payload version ${version}`);
  if (headerBytes !== HEADER_BYTES) throw new Error(`invalid graph render header length ${headerBytes}`);
  if (flags !== 0) throw new Error(`unsupported graph render payload flags ${flags}`);

  const itemCount = view.getUint32(28, true);
  const expectedLength = HEADER_BYTES + itemCount * bytesPerItem;
  if (raw.byteLength !== expectedLength) {
    throw new Error(`graph render payload length is ${raw.byteLength}, expected ${expectedLength}`);
  }

  return {
    generationId: view.getBigUint64(16, true),
    payloadId: view.getUint32(24, true),
    itemCount,
  };
}

function validateHeader(
  header: Header,
  generationId: string,
  chunkId: number,
  itemCount: number,
) {
  if (header.generationId !== BigInt(generationId)) throw new Error("graph render generation mismatch");
  if (header.payloadId !== chunkId) throw new Error("graph render chunk identity mismatch");
  if (header.itemCount !== itemCount) throw new Error("graph render chunk item count mismatch");
}
