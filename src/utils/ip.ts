export function ipv4ToBuffer(ip: string): Buffer {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) {
    throw new Error(`Invalid IPv4 address: ${ip}`);
  }

  const parts = ip.split(".").map(Number);
  if (parts.some((part) => part > 255)) {
    throw new Error(`Invalid IPv4 address: ${ip}`);
  }

  return Buffer.from(parts);
}
