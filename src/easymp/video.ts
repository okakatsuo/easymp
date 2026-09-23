import net from "node:net";

import { withTimeout } from "../utils/async";

export const EASYMP_VIDEO_PORT = 3621;

export interface EasyMPVideoOptions {
  host: string;
  port?: number;
  timeout?: number;
}

export class EasyMPVideo {
  private socket?: net.Socket;

  readonly host: string;
  readonly port: number;
  readonly timeout: number;

  constructor(hostOrOptions: string | EasyMPVideoOptions) {
    const options = typeof hostOrOptions === "string"
      ? { host: hostOrOptions }
      : hostOrOptions;

    this.host = options.host;
    this.port = options.port ?? EASYMP_VIDEO_PORT;
    this.timeout = options.timeout ?? 5_000;
  }

  get connected(): boolean {
    return Boolean(this.socket && !this.socket.destroyed);
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    const socket = net.createConnection({ host: this.host, port: this.port });

    try {
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          socket.once("connect", resolve);
          socket.once("error", reject);
        }),
        this.timeout,
        `Timed out connecting to EasyMP video at ${this.host}:${this.port}`,
      );
    } catch (error) {
      socket.destroy();
      throw error;
    }

    socket.on("error", () => {
      // An active send reports its own error. Keep later socket failures from
      // turning into uncaught EventEmitter errors.
    });
    this.socket = socket;
  }

  async send(packet: Buffer): Promise<void> {
    const socket = this.socket;
    if (!socket || socket.destroyed) {
      throw new Error("EasyMP video channel is not connected");
    }

    await withTimeout(
      new Promise<void>((resolve, reject) => {
        socket.write(packet, (error) => error ? reject(error) : resolve());
      }),
      this.timeout,
      "Timed out while sending EasyMP video data",
    );
  }

  disconnect(): void {
    this.socket?.destroy();
    this.socket = undefined;
  }
}
