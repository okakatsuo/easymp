import { performance } from "node:perf_hooks";

import { createEprdPacket } from "./packet";
import { EasyMPSession } from "./session";
import { EasyMPVideo } from "./video";
import { delay } from "../utils/async";
import { resolveLocalAddress } from "../utils/network";
import { encodeFrame, type EasyMPImageInput, type FrameOptions } from "../image/frame";
import { parseHexColor, solidJpeg } from "../image/encoder";

export interface EasyMPDisplayOptions extends FrameOptions {
  host: string;
  localAddress?: string;
  connectDelay?: number;
  timeout?: number;
  keepAliveInterval?: number;
  /** Minimum interval in milliseconds between full frames during update(). */
  fullFrameInterval?: number;
}

export interface RectangleOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

export class EasyMPDisplay {
  private session?: EasyMPSession;
  private video?: EasyMPVideo;
  private readonly frameOptions: FrameOptions;
  private frame?: Map<string, Buffer>;
  private lastFullFrameAt?: number;
  private queue: Promise<void> = Promise.resolve();

  readonly host: string;
  localAddress?: string;

  constructor(private readonly options: EasyMPDisplayOptions) {
    this.host = options.host;
    this.localAddress = options.localAddress;
    this.frameOptions = {
      width: options.width,
      height: options.height,
      tileSize: options.tileSize,
      jpegQuality: options.jpegQuality,
    };
    if (options.fullFrameInterval !== undefined
      && (!Number.isFinite(options.fullFrameInterval) || options.fullFrameInterval <= 0)) {
      throw new RangeError("fullFrameInterval must be greater than zero");
    }
  }

  get connected(): boolean {
    return Boolean(this.session?.connected && this.video?.connected);
  }

  connect(): Promise<void> {
    return this.enqueue(async () => {
      if (this.connected) return;
      await this.closeConnection();

      const localAddress = this.options.localAddress
        ?? await resolveLocalAddress(this.host, 3620, this.options.timeout);
      this.localAddress = localAddress;
      this.session = new EasyMPSession({
        host: this.host,
        localAddress,
        timeout: this.options.timeout,
        keepAliveInterval: this.options.keepAliveInterval,
      });
      this.video = new EasyMPVideo({
        host: this.host,
        localAddress,
        timeout: this.options.timeout,
      });

      try {
        await this.session.connect();
        await delay(this.options.connectDelay ?? 300);
        await this.video.connect();
        this.requireConnectedVideo();
      } catch (error) {
        await this.closeConnection();
        throw error;
      }
    });
  }

  start(): Promise<void> {
    return this.connect();
  }

  disconnect(): Promise<void> {
    return this.enqueue(() => this.closeConnection());
  }

  private async closeConnection(): Promise<void> {
    this.video?.disconnect();
    this.video = undefined;
    await this.session?.disconnect();
    this.session = undefined;
    this.frame = undefined;
    this.lastFullFrameAt = undefined;
  }

  async rectangle(options: RectangleOptions): Promise<void> {
    return this.enqueue(async () => {
      const video = this.requireConnectedVideo();
      const jpeg = await solidJpeg(
        options.width,
        options.height,
        parseHexColor(options.color),
        this.options.jpegQuality,
      );
      this.frame = undefined;
      await video.send(createEprdPacket(this.requireLocalAddress(), [{ ...options, jpeg }]));
    });
  }

  show(input: EasyMPImageInput): Promise<void> {
    return this.enqueue(() => this.sendFrame(input, false));
  }

  image(input: EasyMPImageInput): Promise<void> {
    return this.show(input);
  }

  update(input: EasyMPImageInput): Promise<void> {
    return this.enqueue(() => this.sendFrame(input, true));
  }

  private async sendFrame(input: EasyMPImageInput, changedOnly: boolean): Promise<void> {
    const video = this.requireConnectedVideo();
    const interval = this.options.fullFrameInterval;
    const refreshDue = interval !== undefined && this.lastFullFrameAt !== undefined
      && performance.now() - this.lastFullFrameAt >= interval;
    const previous = changedOnly && !refreshDue ? this.frame : undefined;
    const encoded = await encodeFrame(input, this.frameOptions, previous);

    if (encoded.tiles.length > 0) {
      this.frame = undefined;
      await video.send(createEprdPacket(this.requireLocalAddress(), encoded.tiles));
    }
    this.frame = encoded.pixels;
    if (!previous) this.lastFullFrameAt = performance.now();
  }

  private requireConnectedVideo(): EasyMPVideo {
    if (!this.session?.connected || !this.video?.connected) {
      throw new Error("EasyMP display is not connected; call display.connect() first");
    }
    return this.video;
  }

  private requireLocalAddress(): string {
    if (!this.localAddress) throw new Error("EasyMP local address is not resolved");
    return this.localAddress;
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => undefined);
    return result;
  }
}
