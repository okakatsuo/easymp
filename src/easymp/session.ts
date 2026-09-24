import dgram from "node:dgram";
import net from "node:net";

import { delay, withTimeout } from "../utils/async";
import { ipv4ToBuffer } from "../utils/ip";

export const EASYMP_CONTROL_PORT = 3620;
const EEMP_MAGIC = Buffer.from("EEMP0100", "ascii");

export function createControlPacket(
  localAddress: string,
  type: number,
  payload: Buffer = Buffer.alloc(0),
): Buffer {
  if (!Number.isInteger(type) || type < 0 || type > 0xff) {
    throw new RangeError("EasyMP control packet type must be a byte");
  }

  const header = Buffer.alloc(20);
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
  private connecting = false;

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
    return Boolean(this.control && !this.control.destroyed);
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    if (this.connecting) throw new Error("EasyMP session is already connecting");

    this.connecting = true;

    try {
      this.server = net.createServer();
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          this.server!.once("error", reject);
          this.server!.listen(this.port, this.localAddress, resolve);
        }),
        this.timeout,
        `Timed out listening on ${this.localAddress}:${this.port}`,
      );

      this.udp = dgram.createSocket({ type: "udp4", reuseAddr: true });
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          this.udp!.once("error", reject);
          this.udp!.bind(this.port, this.localAddress, resolve);
        }),
        this.timeout,
        `Timed out binding UDP ${this.localAddress}:${this.port}`,
      );

      const discovery = await this.discover();
      const projectorId = discovery?.subarray(70, 74);

      const connectionPromise = withTimeout(
        new Promise<net.Socket>((resolve, reject) => {
          this.server!.once("connection", resolve);
          this.server!.once("error", reject);
        }),
        this.timeout,
        `Projector ${this.host} did not connect back to ${this.localAddress}:${this.port}`,
      );

      await new Promise<void>((resolve, reject) => {
        this.udp!.send(
          createConnectPacket(this.localAddress, this.host, projectorId),
          this.port,
          this.host,
          (error) => error ? reject(error) : resolve(),
        );
      });

      const control = await connectionPromise;
      this.control = control;
      control.on("error", () => this.stopKeepAlive());
      control.on("close", () => this.stopKeepAlive());

      const response = await this.readOnce(control);
      if (response.length < EEMP_MAGIC.length || !response.subarray(0, 8).equals(EEMP_MAGIC)) {
        throw new Error(`Unexpected EasyMP response: ${response.toString("hex")}`);
      }

      await this.sendControl(0x0a);

      const interval = this.options.keepAliveInterval ?? 5_000;
      if (!Number.isFinite(interval) || interval <= 0) {
        throw new RangeError("keepAliveInterval must be greater than zero");
      }

      this.keepAlive = setInterval(() => {
        if (!this.control || this.control.destroyed) return;
        this.control.write(createControlPacket(this.localAddress, 0x0a));
      }, interval);
    } catch (error) {
      await this.closeResources();
      throw error;
    } finally {
      this.connecting = false;
    }
  }

  async disconnect(): Promise<void> {
    this.stopKeepAlive();

    if (this.control && !this.control.destroyed) {
      await withTimeout(
        new Promise<void>((resolve) => {
          this.control!.write(
            createControlPacket(this.localAddress, 0x06),
            () => resolve(),
          );
        }),
        Math.min(this.timeout, 1_000),
        "Timed out sending the EasyMP disconnect packet",
      ).catch(() => undefined);
      await delay(100);
    }

    await this.closeResources();
  }

  async sendControl(type: number, payload: Buffer = Buffer.alloc(0)): Promise<void> {
    const control = this.control;
    if (!control || control.destroyed) {
      throw new Error("EasyMP session is not connected");
    }

    await withTimeout(
      new Promise<void>((resolve, reject) => {
        control.write(
          createControlPacket(this.localAddress, type, payload),
          (error) => error ? reject(error) : resolve(),
        );
      }),
      this.timeout,
      "Timed out sending EasyMP control data",
    );
  }

  private async discover(): Promise<Buffer | undefined> {
    const udp = this.udp!;
    udp.setBroadcast(true);
    const subnetBroadcast = this.localAddress.replace(/\d+$/, "255");
    let onMessage: ((message: Buffer, remote: dgram.RemoteInfo) => void) | undefined;

    const response = new Promise<Buffer>((resolve) => {
      onMessage = (message, remote) => {
        if (
          remote.address === this.host
          && message.length >= 74
          && message.subarray(0, 8).equals(EEMP_MAGIC)
          && message[12] === 0x03
        ) {
          resolve(message);
        }
      };
      udp.on("message", onMessage);
    });

    try {
      for (let attempt = 0; attempt < 7; attempt += 1) {
        for (const [destination, type] of [
          [this.host, 0x02],
          [subnetBroadcast, 0x01],
          ["255.255.255.255", 0x01],
        ] as const) {
          await new Promise<void>((resolve, reject) => {
            udp.send(
              createDiscoveryPacket(this.localAddress, type === 0x02),
              this.port,
              destination,
              (error) => error ? reject(error) : resolve(),
            );
          });
        }
        if (attempt < 6) await delay(100);
      }

      return await withTimeout(
        response,
        Math.min(this.timeout, 2_000),
        `Projector ${this.host} did not answer EasyMP discovery`,
      ).catch(() => undefined);
    } finally {
      if (onMessage) udp.off("message", onMessage);
    }
  }

  private readOnce(socket: net.Socket): Promise<Buffer> {
    return withTimeout(
      new Promise<Buffer>((resolve, reject) => {
        socket.once("data", resolve);
        socket.once("error", reject);
        socket.once("end", () => reject(new Error("EasyMP control socket closed")));
      }),
      this.timeout,
      "Timed out waiting for the EasyMP control response",
    );
  }

  private stopKeepAlive(): void {
    if (this.keepAlive !== undefined) {
      clearInterval(this.keepAlive);
      this.keepAlive = undefined;
    }
  }

  private async closeResources(): Promise<void> {
    this.stopKeepAlive();
    this.control?.destroy();
    this.control = undefined;

    if (this.udp) {
      try {
        this.udp.close();
      } catch {
        // The socket may not have reached the bound state.
      }
      this.udp = undefined;
    }

    const server = this.server;
    this.server = undefined;
    if (server?.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
}
