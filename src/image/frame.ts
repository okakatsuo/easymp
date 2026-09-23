import sharp from "sharp";

import { rawRgbToJpeg } from "./encoder";
import type { Tile } from "../easymp/packet";

export type EasyMPImageInput = string | Buffer | Uint8Array;

export interface FrameOptions {
  width?: number;
  height?: number;
  tileSize?: number;
  jpegQuality?: number;
}

export interface EncodedFrame {
  tiles: Tile[];
  pixels: Map<string, Buffer>;
}

interface RawTile {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pixels: Buffer;
}

export async function encodeFrame(
  input: EasyMPImageInput,
  options: FrameOptions = {},
  previous?: ReadonlyMap<string, Buffer>,
): Promise<EncodedFrame> {
  const width = options.width ?? 1024;
  const height = options.height ?? 768;
  const tileSize = options.tileSize ?? 128;
  const jpegQuality = options.jpegQuality ?? 85;

  assertPositiveInteger("width", width);
  assertPositiveInteger("height", height);
  assertPositiveInteger("tileSize", tileSize);

  const source = typeof input === "string" || Buffer.isBuffer(input)
    ? input
    : Buffer.from(input);

  const { data, info } = await sharp(source)
    .rotate()
    .resize(width, height, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    })
    .toColourspace("srgb")
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.channels !== 3) {
    throw new Error(`Expected an RGB frame, received ${info.channels} channels`);
  }

  const rawTiles = splitRgbFrame(data, width, height, tileSize);
  const changed = previous
    ? rawTiles.filter((tile) => !previous.get(tile.key)?.equals(tile.pixels))
    : rawTiles;

  const tiles = await Promise.all(changed.map(async (tile): Promise<Tile> => ({
    x: tile.x,
    y: tile.y,
    width: tile.width,
    height: tile.height,
    jpeg: await rawRgbToJpeg(tile.pixels, tile.width, tile.height, jpegQuality),
  })));

  return {
    tiles,
    pixels: new Map(rawTiles.map((tile) => [tile.key, tile.pixels])),
  };
}

function splitRgbFrame(
  frame: Buffer,
  width: number,
  height: number,
  tileSize: number,
): RawTile[] {
  const tiles: RawTile[] = [];

  for (let y = 0; y < height; y += tileSize) {
    for (let x = 0; x < width; x += tileSize) {
      const tileWidth = Math.min(tileSize, width - x);
      const tileHeight = Math.min(tileSize, height - y);
      const pixels = Buffer.allocUnsafe(tileWidth * tileHeight * 3);

      for (let row = 0; row < tileHeight; row += 1) {
        const sourceStart = ((y + row) * width + x) * 3;
        const targetStart = row * tileWidth * 3;
        frame.copy(pixels, targetStart, sourceStart, sourceStart + tileWidth * 3);
      }

      tiles.push({
        key: `${x}:${y}`,
        x,
        y,
        width: tileWidth,
        height: tileHeight,
        pixels,
      });
    }
  }

  return tiles;
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}
