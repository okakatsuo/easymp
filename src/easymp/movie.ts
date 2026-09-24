import { spawn, type ChildProcess } from "node:child_process";
import { createReadStream } from "node:fs";
import net from "node:net";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { createMovieStartPacket, EasyMPSession } from "./session";
import { EasyMPVideo } from "./video";
import { delay, withTimeout } from "../utils/async";
import { resolveLocalAddress } from "../utils/network";

export const EASYMP_MOVIE_HTTP_RESPONSE = [
  "HTTP/1.0 200 OK",
  "Content-type: application/octet-stream",
  "Cache-Control: no-cache",
  "X-vsfb-status: play",
  "",
  "",
].join("\r\n");
export const EASYMP_MOVIE_PORT = 50_020;

export type EasyMPTransportStreamInput = string | Uint8Array;

export interface EasyMPMovieOptions {
  host: string;
  localAddress?: string;
  timeout?: number;
  keepAliveInterval?: number;
  serverPort?: number;
  ffmpegPath?: string;
}

export interface EasyMPMoviePlayOptions {
  ffmpegPath?: string;
}

export function createEasyMPFfmpegArgs(input: string): string[] {
  return [
    "-hide_banner",
    "-loglevel", "error",
    "-nostdin",
    "-i", input,
    "-map", "0:v:0",
    "-map", "0:a:0",
    "-vf", "scale=320:240:force_original_aspect_ratio=decrease,pad=320:240:(ow-iw)/2:(oh-ih)/2:black",
    "-r", "30",
    "-c:v", "mpeg2video",
    "-profile:v", "main",
    "-level:v", "4",
    "-pix_fmt", "yuv420p",
    "-b:v", "7808000",
    "-minrate", "7808000",
    "-maxrate", "7808000",
    "-bufsize", "1130496",
    "-c:a", "mp2",
    "-b:a", "192000",
    "-ar", "48000",
    "-ac", "2",
    "-metadata:s:a:0", "language=eng",
    "-streamid", "0:68",
    "-streamid", "1:69",
    "-mpegts_transport_stream_id", "25946",
    "-mpegts_service_id", "1",
    "-mpegts_pmt_start_pid", "66",
    "-mpegts_flags", "pat_pmt_at_frames",
    "-muxrate", "8288000",
    "-muxdelay", "0",
    "-muxpreload", "0",
    "-shortest",
    "-f", "mpegts",
    "pipe:1",
  ];
}

interface MovieSource {
  stream: Readable;
  completion: Promise<void>;
}

export class EasyMPMovie {
  private session?: EasyMPSession;
  private video?: EasyMPVideo;
  private server?: net.Server;
  private socket?: net.Socket;
  private ffmpeg?: ChildProcess;
  private abort?: AbortController;
  private current?: Promise<void>;
  private stopping = false;

  readonly host: string;
  localAddress?: string;

  constructor(private readonly options: EasyMPMovieOptions) {
    this.host = options.host;
    this.localAddress = options.localAddress;
  }

  get playing(): boolean {
    return this.current !== undefined;
  }

  play(input: string, options: EasyMPMoviePlayOptions = {}): Promise<void> {
    return this.start(() => this.createFfmpegSource(
      input,
      options.ffmpegPath ?? this.options.ffmpegPath ?? "ffmpeg",
    ));
  }

  playTransportStream(input: EasyMPTransportStreamInput): Promise<void> {
    return this.start(() => ({
      stream: typeof input === "string"
        ? createReadStream(input)
        : Readable.from([Buffer.from(input)]),
      completion: Promise.resolve(),
    }));
  }

  async stop(): Promise<void> {
    const current = this.current;
    if (!current) return;

    this.stopping = true;
    this.abort?.abort();
    this.ffmpeg?.kill();
    this.socket?.destroy();
    if (this.server?.listening) this.server.close();
    await current;
  }

  private start(source: () => MovieSource): Promise<void> {
    if (this.current) {
      return Promise.reject(new Error("An EasyMP movie is already playing"));
    }

    this.stopping = false;
    const abort = new AbortController();
    this.abort = abort;

    const current = this.run(source, abort.signal)
      .catch((error: unknown) => {
        if (!this.stopping) throw error;
      })
      .finally(() => {
        if (this.current === current) this.current = undefined;
        this.abort = undefined;
        this.stopping = false;
      });
    this.current = current;
    return current;
  }

  private async run(sourceFactory: () => MovieSource, signal: AbortSignal): Promise<void> {
    const timeout = this.options.timeout ?? 5_000;
    const localAddress = this.options.localAddress
      ?? await resolveLocalAddress(this.host, 3620, timeout);
    this.localAddress = localAddress;

    const session = new EasyMPSession({
      host: this.host,
      localAddress,
      timeout,
      keepAliveInterval: this.options.keepAliveInterval,
    });
    this.session = session;

    try {
      await session.connect();
      signal.throwIfAborted();
      await delay(300);
      signal.throwIfAborted();

      const video = new EasyMPVideo({ host: this.host, timeout });
      this.video = video;
      await video.connect();

      const server = net.createServer();
      this.server = server;
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(this.options.serverPort ?? EASYMP_MOVIE_PORT, localAddress, resolve);
        }),
        timeout,
        `Timed out opening the EasyMP movie server on ${localAddress}`,
      );

      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("EasyMP movie server did not receive a TCP port");
      }

      const connection = this.waitForConnection(server, signal, timeout);
      const start = createMovieStartPacket(localAddress, address.port);
      await session.sendControl(0x13, start.subarray(20));

      const socket = await connection;
      this.socket = socket;
      server.close();
      await this.readHttpRequest(socket, signal, timeout);
      signal.throwIfAborted();

      await this.write(socket, Buffer.from(EASYMP_MOVIE_HTTP_RESPONSE, "ascii"), timeout);
      const source = sourceFactory();
      await Promise.all([
        pipeline(source.stream, socket, { signal }),
        source.completion,
      ]);
    } finally {
      await this.closeResources();
    }
  }

  private createFfmpegSource(input: string, ffmpegPath: string): MovieSource {
    const child = spawn(ffmpegPath, createEasyMPFfmpegArgs(input), {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    this.ffmpeg = child;

    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-16_384);
    });

    const completion = new Promise<void>((resolve, reject) => {
      child.once("error", (error) => {
        reject(new Error(`Could not start ffmpeg at ${ffmpegPath}: ${error.message}`));
      });
      child.once("close", (code, signal) => {
        if (code === 0) resolve();
        else reject(new Error(
          `ffmpeg failed (${signal ?? `exit ${String(code)}`}): ${stderr.trim()}`,
        ));
      });
    });

    return { stream: child.stdout, completion };
  }

  private waitForConnection(
    server: net.Server,
    signal: AbortSignal,
    timeout: number,
  ): Promise<net.Socket> {
    return withTimeout(
      new Promise<net.Socket>((resolve, reject) => {
        const onAbort = () => reject(new Error("EasyMP movie playback stopped"));
        signal.addEventListener("abort", onAbort, { once: true });
        server.once("connection", (socket) => {
          signal.removeEventListener("abort", onAbort);
          resolve(socket);
        });
        server.once("error", reject);
      }),
      timeout,
      `Projector ${this.host} did not request the EasyMP movie stream`,
    );
  }

  private readHttpRequest(
    socket: net.Socket,
    signal: AbortSignal,
    timeout: number,
  ): Promise<void> {
    return withTimeout(
      new Promise<void>((resolve, reject) => {
        let request = Buffer.alloc(0);
        const onAbort = () => reject(new Error("EasyMP movie playback stopped"));
        const cleanup = () => {
          signal.removeEventListener("abort", onAbort);
          socket.off("data", onData);
          socket.off("error", onError);
          socket.off("end", onEnd);
        };
        const onData = (chunk: Buffer) => {
          request = Buffer.concat([request, chunk]);
          if (request.length > 4_096) {
            cleanup();
            reject(new Error("EasyMP movie HTTP request is too large"));
            return;
          }
          if (request.includes("\n\n") || request.includes("\r\n\r\n")) {
            cleanup();
            if (!request.subarray(0, 6).equals(Buffer.from("GET / ", "ascii"))) {
              reject(new Error(`Unexpected EasyMP movie request: ${request.toString("ascii")}`));
              return;
            }
            resolve();
          }
        };
        const onError = (error: Error) => {
          cleanup();
          reject(error);
        };
        const onEnd = () => {
          cleanup();
          reject(new Error("Projector closed the EasyMP movie request"));
        };
        signal.addEventListener("abort", onAbort, { once: true });
        socket.on("data", onData);
        socket.once("error", onError);
        socket.once("end", onEnd);
      }),
      timeout,
      "Timed out waiting for the EasyMP movie HTTP request",
    );
  }

  private write(socket: net.Socket, data: Buffer, timeout: number): Promise<void> {
    return withTimeout(
      new Promise<void>((resolve, reject) => {
        socket.write(data, (error) => error ? reject(error) : resolve());
      }),
      timeout,
      "Timed out writing the EasyMP movie HTTP response",
    );
  }

  private async closeResources(): Promise<void> {
    this.ffmpeg?.kill();
    this.ffmpeg = undefined;

    this.socket?.destroy();
    this.socket = undefined;

    const server = this.server;
    this.server = undefined;
    if (server?.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    const session = this.session;
    this.session = undefined;
    this.video?.disconnect();
    this.video = undefined;
    await session?.disconnect();
  }
}
