import dgram from "node:dgram";
import net from "node:net";

import { withTimeout } from "../utils/async";
import { ipv4ToBuffer } from "../utils/ip";
import { subnetBroadcast } from "../utils/network";

export const EASYMP_CONTROL_PORT = 3620;
const EEMP_MAGIC = Buffer.from("EEMP0100", "ascii");
const EEMP_HEADER_SIZE = 20;

export function createControlPacket(
  localAddress: string,
  type: number,
  payload: Buffer = Buffer.alloc(0),
): Buffer {
  if (!Number.isInteger(type) || type < 0 || type > 0xff) {
    throw new RangeError("EasyMP control packet type must be a byte");
  }

  const header = Buffer.alloc(EEMP_HEADER_SIZE);
  EEMP_MAGIC.copy(header, 0);
  ipv4ToBuffer(localAddress).copy(header, 8);
  header[12] = type;
  header.writeUInt32LE(payload.length, 16);
  return Buffer.concat([header, payload]);
}

export function createMovieStartPacket(
  localAddress: string,
  port: number,
): Buffer {
  if (!Number.isInteger(port) || port < 1 || port > 0xffff) {
    throw new RangeError("EasyMP movie server port must be from 1 to 65535");
  }

  const payload = Buffer.alloc(48);
  ipv4ToBuffer(localAddress).copy(payload, 4);
  payload.writeUInt16BE(port, 8);
  return createControlPacket(localAddress, 0x13, payload);
}

export function createDiscoveryPacket(localAddress: string, direct = false): Buffer {
  return createControlPacket(localAddress, direct ? 0x02 : 0x01, Buffer.alloc(48));
}

export function createConnectPacket(
  localAddress: string,
  projectorAddress: string,
  projectorId: Buffer = Buffer.from("4879da83", "hex"),
): Buffer {
  if (projectorId.length !== 4) {
    throw new RangeError("EasyMP projector ID must be exactly four bytes");
  }

  // Captured from and verified against an EMP-1715. Several fields remain
  // undocumented, so the known-good body stays byte-for-byte compatible.
  const packet = Buffer.from(
    [
      "45 45 4d 50 30 31 30 30",
      "c0 a8 01 11",
      "04 00 00 00",
      "4a 00 00 00",
      "01 00 00 00",
      "00 bc c8 8c 07 e0 be 8c 07 ff ff ff 00",
      "c0 a8 01 01",
      "e8 01 00 00",
      "04 00 03 20 20 00 01",
      "ff 00 ff 00 ff 00",
      "00 08 10 00",
      "00 00 00 00 00 00 00 00",
      "48 79 da 83",
      "00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
      "c0 a8 01 52",
    ].join("").replaceAll(" ", ""),
    "hex",
  );

  ipv4ToBuffer(localAddress).copy(packet, 8);
  projectorId.copy(packet, 70);
  ipv4ToBuffer(projectorAddress).copy(packet, packet.length - 4);
  return packet;
}

export interface EasyMPSessionOptions {
  host: string;
  localAddress: string;
  port?: number;
  keepAliveInterval?: number;
  timeout?: number;
}

export class EasyMPSession {
  private server?: net.Server;
  private udp?: dgram.Socket;
  private control?: net.Socket;
  private keepAlive?: ReturnType<typeof setInterval>;
  private connecting?: Promise<void>;
  private disconnecting?: Promise<void>;
  private ready = false;

  readonly host: string;
  readonly localAddress: string;
  readonly port: number;
  readonly timeout: number;

  constructor(private readonly options: EasyMPSessionOptions) {
    this.host = options.host;
    this.localAddress = options.localAddress;
    this.port = options.port ?? EASYMP_CONTROL_PORT;
    this.timeout = options.timeout ?? 5_000;

    ipv4ToBuffer(this.host);
    ipv4ToBuffer(this.localAddress);
  }

  get connected(): boolean {
    return Boolean(this.ready && this.control && !this.control.destroyed);
  }

  connect(): Promise<void> {
    if (this.disconnecting) return this.disconnecting.then(() => this.connect());
    if (this.connecting) return this.connecting;
    if (this.connected) return Promise.resolve();

    this.connecting = this.open().finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  disconnect(): Promise<void> {
    if (this.disconnecting) return this.disconnecting;

    this.disconnecting = this.close().finally(() => {
      this.disconnecting = undefined;
    });
    return this.disconnecting;
  }

  async sendControl(type: number, payload: Buffer = Buffer.alloc(0)): Promise<void> {
    if (!this.connected) throw new Error("EasyMP session is not connected");
    await this.writeControl(this.control!, type, this.timeout, payload);
  }

  private async open(): Promise<void> {
    this.closeResources();
    const interval = this.options.keepAliveInterval ?? 5_000;
    if (!Number.isFinite(interval) || interval <= 0) {
      throw new RangeError("keepAliveInterval must be greater than zero");
    }

    let acceptConnection: ((socket: net.Socket) => void) | undefined;
    const server = net.createServer((socket) => {
      if (socket.remoteAddress !== this.host || !acceptConnection) {
        socket.destroy();
        return;
      }

      const accept = acceptConnection;
      acceptConnection = undefined;
      this.control = socket;
      socket.on("error", () => socket.destroy());
      socket.once("close", () => {
        if (this.control === socket && this.ready) this.closeResources();
      });
      accept(socket);
    });
    this.server = server;

    try {
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(this.port, this.localAddress, resolve);
        }),
        this.timeout,
        `Timed out listening on ${this.localAddress}:${this.port}`,
      );

      const udp = dgram.createSocket("udp4");
      this.udp = udp;
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          udp.once("error", reject);
          udp.bind(this.port, this.localAddress, resolve);
        }),
        this.timeout,
        `Timed out binding UDP ${this.localAddress}:${this.port}`,
      );

      const projectorId = await this.discover(udp);

      const connectPacket = createConnectPacket(this.localAddress, this.host, projectorId);
      const control = await withTimeout(
        new Promise<net.Socket>((resolve, reject) => {
          acceptConnection = resolve;
          server.once("error", reject);
          void this.sendDatagram(udp, connectPacket, this.host).catch(reject);
        }),
        this.timeout,
        `Projector ${this.host} did not connect back to ${this.localAddress}:${this.port}`,
      );
      const greeting = readControlReply(control, 0x05, this.timeout);
      readControlPackets(control);
      await greeting;
      await this.writeControl(control, 0x0a, this.timeout);
      if (control.destroyed) throw new Error("EasyMP control socket closed");

      this.ready = true;
      this.keepAlive = setInterval(() => {
        // If a stalled write times out, close the session instead of queueing more heartbeats.
        if (control.writableLength === 0) {
          void this.writeControl(control, 0x0a, this.timeout).catch(() => control.destroy());
        }
      }, interval);
    } catch (error) {
      this.closeResources();
      throw error;
    } finally {
      acceptConnection = undefined;
    }
  }

  private async close(): Promise<void> {
    await this.connecting?.catch(() => undefined);
    this.stopKeepAlive();

    const control = this.control;
    this.ready = false;
    try {
      if (control && !control.destroyed) {
        const timeout = Math.min(this.timeout, 1_000);
        await Promise.all([
          readControlReply(control, 0x07, timeout),
          this.writeControl(control, 0x06, timeout),
        ]).catch(() => undefined);
      }
    } finally {
      this.closeResources();
    }
  }

  private async discover(udp: dgram.Socket): Promise<Buffer | undefined> {
    const direct = createDiscoveryPacket(this.localAddress, true);
    const broadcast = createDiscoveryPacket(this.localAddress);
    const destinations = new Set<string>();
    try {
      udp.setBroadcast(true);
      const directedBroadcast = subnetBroadcast(this.localAddress);
      if (directedBroadcast) destinations.add(directedBroadcast);
      destinations.add("255.255.255.255");
    } catch {
      // Broadcast may be unavailable on this interface even when unicast works.
    }
    let onMessage: ((message: Buffer, remote: dgram.RemoteInfo) => void) | undefined;
    let retry: ReturnType<typeof setInterval> | undefined;

    const response = new Promise<Buffer>((resolve, reject) => {
      onMessage = (message, remote) => {
        if (
          remote.address === this.host
          && message.length >= 74
          && message.subarray(0, 8).equals(EEMP_MAGIC)
          && message.readUInt32LE(12) === 0x03
          && message.readUInt32LE(16) === message.length - EEMP_HEADER_SIZE
        ) {
          if (retry !== undefined) clearInterval(retry);
          resolve(message.subarray(70, 74));
        }
      };
      udp.on("message", onMessage);
      void this.sendDatagram(udp, direct, this.host).catch(reject);

      let attempts = 1;
      retry = setInterval(() => {
        void this.sendDatagram(udp, direct, this.host).catch(reject);
        for (const destination of destinations) {
          void this.sendDatagram(udp, broadcast, destination).catch(() => undefined);
        }
        attempts += 1;
        if (attempts >= 7) clearInterval(retry);
      }, 100);
    });

    try {
      return await withTimeout(
        response,
        Math.min(this.timeout, 2_000),
        `Projector ${this.host} did not answer EasyMP discovery`,
      ).catch(() => undefined);
    } finally {
      if (retry !== undefined) clearInterval(retry);
      if (onMessage) udp.off("message", onMessage);
    }
  }

  private sendDatagram(udp: dgram.Socket, packet: Buffer, destination: string): Promise<void> {
    return new Promise((resolve, reject) => {
      udp.send(packet, this.port, destination, (error) => error ? reject(error) : resolve());
    });
  }

  private writeControl(socket: net.Socket, type: number, timeout: number, payload?: Buffer): Promise<void> {
    const packet = createControlPacket(this.localAddress, type, payload);
    return withTimeout(
      new Promise<void>((resolve, reject) => {
        socket.write(packet, (error) => error ? reject(error) : resolve());
      }),
      timeout,
      "Timed out sending EasyMP control data",
    );
  }

  private stopKeepAlive(): void {
    if (this.keepAlive !== undefined) {
      clearInterval(this.keepAlive);
      this.keepAlive = undefined;
    }
  }

  private closeResources(): void {
    this.ready = false;
    this.stopKeepAlive();
    this.control?.destroy();
    this.control = undefined;

    const udp = this.udp;
    this.udp = undefined;
    try {
      udp?.close();
    } catch {
      // A bind error can close the socket before cleanup.
    }

    this.server?.close();
    this.server = undefined;
  }
}

function readControlPackets(socket: net.Socket): void {
  let header: Buffer | null = null;
  socket.on("readable", () => {
    while (true) {
      header ??= socket.read(EEMP_HEADER_SIZE) as Buffer | null;
      if (!header) return;
      if (header.length !== EEMP_HEADER_SIZE || !header.subarray(0, 8).equals(EEMP_MAGIC)) {
        socket.destroy(new Error("Invalid EasyMP control packet header"));
        return;
      }

      const payloadLength = header.readUInt32LE(16);
      if (payloadLength > 65_535) {
        socket.destroy(new Error("Invalid EasyMP control packet length"));
        return;
      }
      if (payloadLength > 0) {
        const payload = socket.read(payloadLength) as Buffer | null;
        if (!payload) return;
        if (payload.length !== payloadLength) {
          socket.destroy(new Error("Truncated EasyMP control packet"));
          return;
        }
      }

      socket.emit("eempReply", header.readUInt32LE(12));
      header = null;
    }
  });
}

async function readControlReply(socket: net.Socket, type: number, timeout: number): Promise<void> {
  let cleanup: (() => void) | undefined;
  const reply = new Promise<void>((resolve, reject) => {
    const onReply = (received: number) => {
      if (received === type) resolve();
    };
    const onClose = () => reject(new Error("EasyMP control socket closed"));

    socket.on("eempReply", onReply);
    socket.once("error", reject);
    socket.once("end", onClose);
    socket.once("close", onClose);
    cleanup = () => {
      socket.off("eempReply", onReply);
      socket.off("error", reject);
      socket.off("end", onClose);
      socket.off("close", onClose);
    };
    if (socket.destroyed || socket.readableEnded) onClose();
  });

  try {
    await withTimeout(reply, timeout, `Timed out waiting for EasyMP control reply 0x${type.toString(16)}`);
  } finally {
    cleanup?.();
  }
}
