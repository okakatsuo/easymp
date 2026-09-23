export function encodeEasyMPLength(length: number): Buffer {
  if (!Number.isSafeInteger(length) || length < 0 || length >= 1 << 21) {
    throw new RangeError(`Invalid EasyMP payload length: ${length}`);
  }

  return Buffer.from([
    0x90,
    0x80 | (length & 0x7f),
    0x80 | ((length >> 7) & 0x7f),
    (length >> 14) & 0x7f,
  ]);
}
