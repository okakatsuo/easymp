import dgram from "node:dgram";
import { networkInterfaces } from "node:os";

import { withTimeout } from "./async";
import { ipv4ToBuffer } from "./ip";

export async function resolveLocalAddress(
  host: string,
  port = 3620,
  timeout = 2_000,
): Promise<string> {
  const target = ipv4ToBuffer(host);
  const matches: string[] = [];

  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== "IPv4" || address.internal) continue;
      if (sameSubnet(target, ipv4ToBuffer(address.address), ipv4ToBuffer(address.netmask))) {
        matches.push(address.address);
      }
    }
  }

  if (matches.length > 0) return matches[0]!;

  const socket = dgram.createSocket("udp4");
  try {
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        socket.once("error", reject);
        socket.connect(port, host, resolve);
      }),
      timeout,
      `Could not determine a local address for ${host}`,
    );
    const address = socket.address();
    if (typeof address !== "object" || address.address === "0.0.0.0") {
      throw new Error(`Could not determine a local address for ${host}`);
    }
    return address.address;
  } finally {
    try {
      socket.close();
    } catch {
      // A route lookup error can occur before the socket is implicitly bound.
    }
  }
}

export function sameSubnet(target: Buffer, address: Buffer, netmask: Buffer): boolean {
  if (target.length !== 4 || address.length !== 4 || netmask.length !== 4) return false;
  for (let index = 0; index < 4; index += 1) {
    if ((target[index]! & netmask[index]!) !== (address[index]! & netmask[index]!)) {
      return false;
    }
  }
  return true;
}
