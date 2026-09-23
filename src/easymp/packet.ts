import { encodeEasyMPLength } from "./length";
import { ipv4ToBuffer } from "../utils/ip";

export interface Tile {
  x: number;
  y: number;
  width: number;
  height: number;
  jpeg: Buffer;
}

const MAX_UINT16 = 0xffff;

function assertUInt16(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > MAX_UINT16) {
    throw new RangeError(`${name} must be an integer from 0 to ${MAX_UINT16}`);
  }
}

function uint16BE(value: number): Buffer {
  const buffer = Buffer.allocUnsafe(2);
  buffer.writeUInt16BE(value);
  return buffer;
}

function uint32BE(value: number): Buffer {
  const buffer = Buffer.allocUnsafe(4);
  buffer.writeUInt32BE(value);
  return buffer;
}

export function createTile(tile: Tile): Buffer {
  assertUInt16("tile.x", tile.x);
  assertUInt16("tile.y", tile.y);
  assertUInt16("tile.width", tile.width);
  assertUInt16("tile.height", tile.height);

  if (tile.width === 0 || tile.height === 0) {
    throw new RangeError("Tile width and height must be greater than zero");
  }

  if (!Buffer.isBuffer(tile.jpeg) || tile.jpeg.length === 0) {
    throw new TypeError("Tile JPEG must be a non-empty Buffer");
  }

  return Buffer.concat([
    uint16BE(tile.x),
    uint16BE(tile.y),

    uint16BE(tile.width),
    uint16BE(tile.height),

    // JPEG tile type
    uint32BE(7),

    encodeEasyMPLength(tile.jpeg.length),

    tile.jpeg,
  ]);
}

export function createEprdPacket(
  localAddress: string,
  tiles: Tile[],
): Buffer {
  if (tiles.length === 0) {
    throw new RangeError("An EPRD packet must contain at least one tile");
  }

  const encodedTiles = tiles.map(createTile);

  const payload = Buffer.concat([
    uint32BE(tiles.length),
    ...encodedTiles,
  ]);

  return Buffer.concat([
    Buffer.from("EPRD0600", "ascii"),
    ipv4ToBuffer(localAddress),

    // Unknown/reserved
    Buffer.alloc(4),

    uint32BE(payload.length),

    payload,
  ]);
}
