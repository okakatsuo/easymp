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
  private readonly video: EasyMPVideo;
  private readonly frameOptions: FrameOptions;
  private frame?: Map<string, Buffer>;
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
    this.video = new EasyMPVideo({
      host: options.host,
      timeout: options.timeout,
    });
  }

  get connected(): boolean {
    return Boolean(this.session?.connected && this.video.connected);
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    const localAddress = this.options.localAddress
      ?? await resolveLocalAddress(this.host, 3620, this.options.timeout);
    this.localAddress = localAddress;
    this.session = new EasyMPSession({
      host: this.host,
      localAddress,
      timeout: this.options.timeout,
      keepAliveInterval: this.options.keepAliveInterval,
    });

    await this.session.connect();
    try {
      await delay(this.options.connectDelay ?? 300);
      await this.video.connect();
      this.frame = undefined;
    } catch (error) {
      await this.session.disconnect();
      this.session = undefined;
      throw error;
    }
  }

  start(): Promise<void> {
    return this.connect();
  }

  async disconnect(): Promise<void> {
    await this.queue;
    this.video.disconnect();
    await this.session?.disconnect();
    this.session = undefined;
    this.frame = undefined;
  }

  async rectangle(options: RectangleOptions): Promise<void> {
    return this.enqueue(async () => {
      this.assertConnected();
      const jpeg = await solidJpeg(
        options.width,
        options.height,
        parseHexColor(options.color),
        this.options.jpegQuality,
      );
      await this.video.send(createEprdPacket(this.requireLocalAddress(), [{ ...options, jpeg }]));
      this.frame = undefined;
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
    this.assertConnected();
    const encoded = await encodeFrame(
      input,
      this.frameOptions,
      changedOnly ? this.frame : undefined,
    );

    if (encoded.tiles.length > 0) {
      await this.video.send(createEprdPacket(this.requireLocalAddress(), encoded.tiles));
    }
    this.frame = encoded.pixels;
  }

  private assertConnected(): void {
    if (!this.connected) {
      throw new Error("EasyMP display is not connected; call display.connect() first");
    }
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
