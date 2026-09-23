import sharp from "sharp";

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export function parseHexColor(color: string): RgbColor {
  const match = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color);
  if (!match) {
    throw new Error(`Invalid RGB hex color: ${color}`);
  }

  return {
    r: Number.parseInt(match[1]!, 16),
    g: Number.parseInt(match[2]!, 16),
    b: Number.parseInt(match[3]!, 16),
  };
}

export async function solidJpeg(
  width: number,
  height: number,
  rgb: {
    r: number;
    g: number;
    b: number;
  },
  quality = 90,
): Promise<Buffer> {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new RangeError("JPEG width and height must be positive integers");
  }

  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: rgb,
    },
  })
    .jpeg({
      quality,
      progressive: false,
    })
    .toBuffer();
}

export async function rawRgbToJpeg(
  pixels: Buffer,
  width: number,
  height: number,
  quality = 85,
): Promise<Buffer> {
  if (pixels.length !== width * height * 3) {
    throw new RangeError("RGB buffer length does not match its dimensions");
  }

  return sharp(pixels, {
    raw: { width, height, channels: 3 },
  })
    .jpeg({ quality, progressive: false })
    .toBuffer();
}
