import { describe, expect, test } from "bun:test";
import sharp from "sharp";

import { encodeFrame, parseHexColor, solidJpeg } from "../src";

describe("image encoding", () => {
  test("parses RGB colors", () => {
    expect(parseHexColor("#ff0080")).toEqual({ r: 255, g: 0, b: 128 });
    expect(() => parseHexColor("red")).toThrow();
  });

  test("creates baseline JPEG data", async () => {
    const jpeg = await solidJpeg(16, 8, { r: 255, g: 0, b: 0 });
    const metadata = await sharp(jpeg).metadata();
    expect(metadata.width).toBe(16);
    expect(metadata.height).toBe(8);
    expect(metadata.isProgressive).toBe(false);
  });

  test("tiles a frame and suppresses unchanged tiles", async () => {
    const input = await solidJpeg(16, 16, { r: 10, g: 20, b: 30 });
    const first = await encodeFrame(input, { width: 16, height: 16, tileSize: 8 });
    expect(first.tiles).toHaveLength(4);
    expect(first.tiles.map(({ x, y }) => [x, y])).toEqual([
      [0, 0], [8, 0], [0, 8], [8, 8],
    ]);

    const second = await encodeFrame(input, { width: 16, height: 16, tileSize: 8 }, first.pixels);
    expect(second.tiles).toHaveLength(0);
  });
});
