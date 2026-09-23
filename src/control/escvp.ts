import net from "node:net";

import { withTimeout } from "../utils/async";

export const ESCVP_PORT = 3629;
export const ESCVP_HANDSHAKE = Buffer.from(
  "45 53 43 2f 56 50 2e 6e 65 74 10 03 00 00 00 00",
  "hex",
);
const ESCVP_HANDSHAKE_MAGIC = Buffer.from("ESC/VP.net", "ascii");

export interface EscVpClientOptions {
  host: string;
  port?: number;
  timeout?: number;
}

export class EscVpError extends Error {
  constructor(
    message: string,
    readonly command: string,
    readonly response?: string,
  ) {
    super(message);
    this.name = "EscVpError";
  }
}

export class EscVpClient {
  readonly host: string;
  readonly port: number;
  readonly timeout: number;

  constructor(options: EscVpClientOptions) {
    this.host = options.host;
    this.port = options.port ?? ESCVP_PORT;
    this.timeout = options.timeout ?? 5_000;
  }

  async command(command: string): Promise<string> {
    if (!/^[\x20-\x7e]+$/.test(command) || command.includes("\r") || command.includes("\n")) {
      throw new EscVpError("ESC/VP command must be one line of printable ASCII", command);
    }

    const socket = net.createConnection({ host: this.host, port: this.port });
    socket.setNoDelay(true);

    try {
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          socket.once("connect", resolve);
          socket.once("error", reject);
        }),
        this.timeout,
        `Timed out connecting to ESC/VP.net at ${this.host}:${this.port}`,
      );

      const handshakeResponse = this.read(socket, (data) => data.length >= 16);
      await this.write(socket, ESCVP_HANDSHAKE);
      const handshake = await handshakeResponse;
      if (!handshake.subarray(0, ESCVP_HANDSHAKE_MAGIC.length).equals(ESCVP_HANDSHAKE_MAGIC)) {
        throw new EscVpError(
          `Unexpected ESC/VP.net handshake: ${handshake.toString("hex")}`,
          command,
        );
      }

      const responsePromise = this.read(socket, (data) => data.includes(0x3a));
      await this.write(socket, Buffer.from(`${command}\r`, "ascii"));
      const response = parseEscVpResponse(await responsePromise);

      if (response.startsWith("ERR")) {
        throw new EscVpError(`Projector rejected ${command}: ${response}`, command, response);
      }

      return response;
    } finally {
      socket.destroy();
    }
  }

  async query(command: string): Promise<string> {
    const query = command.endsWith("?") ? command : `${command}?`;
    const response = await this.command(query);
    const equals = response.indexOf("=");
    return equals === -1 ? response : response.slice(equals + 1);
  }

  private write(socket: net.Socket, data: Buffer): Promise<void> {
    return withTimeout(
      new Promise<void>((resolve, reject) => {
        socket.write(data, (error) => error ? reject(error) : resolve());
      }),
      this.timeout,
      "Timed out writing an ESC/VP.net command",
    );
  }

  private read(
    socket: net.Socket,
    complete: (data: Buffer) => boolean,
  ): Promise<Buffer> {
    return withTimeout(
      new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];

        const cleanup = () => {
          socket.off("data", onData);
          socket.off("error", onError);
          socket.off("end", onEnd);
        };
        const onData = (chunk: Buffer) => {
          chunks.push(chunk);
          const data = Buffer.concat(chunks);
          if (complete(data)) {
            cleanup();
            resolve(data);
          }
        };
        const onError = (error: Error) => {
          cleanup();
          reject(error);
        };
        const onEnd = () => {
          cleanup();
          reject(new Error("ESC/VP.net connection closed before a complete response"));
        };

        socket.on("data", onData);
        socket.once("error", onError);
        socket.once("end", onEnd);
      }),
      this.timeout,
      "Timed out waiting for an ESC/VP.net response",
    );
  }
}

export function parseEscVpResponse(data: Buffer): string {
  const prompt = data.indexOf(0x3a);
  const body = prompt === -1 ? data : data.subarray(0, prompt);
  return body.toString("ascii").replace(/[\r\n]+$/g, "");
}
