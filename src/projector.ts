import { EscVpClient } from "./control/escvp";
import { EasyMPDisplay, type EasyMPDisplayOptions } from "./easymp/display";
import { EasyMPMovie } from "./easymp/movie";

export interface EpsonProjectorOptions extends EasyMPDisplayOptions {
  controlPort?: number;
  movieServerPort?: number;
  ffmpegPath?: string;
}

export type ProjectorPowerState =
  | "standby"
  | "on"
  | "warming"
  | "cooling"
  | "unknown";

export interface ProjectorPowerStatus {
  code: string;
  state: ProjectorPowerState;
}

export type ProjectorAudioOutput = "internal" | "external" | "unknown";

export class EpsonProjector {
  readonly control: EscVpClient;
  readonly display: EasyMPDisplay;
  readonly movie: EasyMPMovie;
  readonly power: ProjectorPower;
  readonly status: ProjectorStatus;
  readonly audio: ProjectorAudio;

  constructor(readonly options: EpsonProjectorOptions) {
    this.control = new EscVpClient({
      host: options.host,
      port: options.controlPort,
      timeout: options.timeout,
      localAddress: options.localAddress,
    });
    this.display = new EasyMPDisplay(options);
    this.movie = new EasyMPMovie({
      ...options,
      serverPort: options.movieServerPort,
      ffmpegPath: options.ffmpegPath,
    });
    this.power = new ProjectorPower(this.control);
    this.status = new ProjectorStatus(this.control);
    this.audio = new ProjectorAudio(this.control);
  }

  powerOn(): Promise<void> {
    return this.power.on();
  }

  powerOff(): Promise<void> {
    return this.power.off();
  }

  async close(): Promise<void> {
    await this.movie.stop();
    await this.display.disconnect();
  }
}

export class ProjectorAudio {
  static readonly MIN_VOLUME = 0;
  static readonly MAX_VOLUME = 20;

  constructor(private readonly client: EscVpClient) {}

  async setVolume(level: number): Promise<void> {
    if (
      !Number.isInteger(level)
      || level < ProjectorAudio.MIN_VOLUME
      || level > ProjectorAudio.MAX_VOLUME
    ) {
      throw new RangeError(
        `EMP-1715 volume must be an integer from ${ProjectorAudio.MIN_VOLUME} to ${ProjectorAudio.MAX_VOLUME}`,
      );
    }

    await this.client.command(`VOL ${level}`);
  }

  async setOutput(output: Exclude<ProjectorAudioOutput, "unknown">): Promise<void> {
    if (output !== "internal" && output !== "external") {
      throw new TypeError(`Unsupported EMP-1715 audio output: ${String(output)}`);
    }
    await this.client.command(`AUDIO ${output === "internal" ? "01" : "02"}`);
  }

  async output(): Promise<ProjectorAudioOutput> {
    const value = await this.client.query("AUDIO");
    if (value === "01") return "internal";
    if (value === "02") return "external";
    return "unknown";
  }

  /** EMP-1715 exposes combined A/V mute rather than audio-only mute. */
  async mute(): Promise<void> {
    await this.client.command("MUTE ON");
  }

  async unmute(): Promise<void> {
    await this.client.command("MUTE OFF");
  }

  async muted(): Promise<boolean> {
    const value = await this.client.query("MUTE");
    if (value === "ON") return true;
    if (value === "OFF") return false;
    throw new Error(`Unexpected MUTE response: ${value}`);
  }
}

export class ProjectorPower {
  constructor(private readonly client: EscVpClient) {}

  async on(): Promise<void> {
    await this.client.command("PWR ON", 110_000);
  }

  async off(): Promise<void> {
    await this.client.command("PWR OFF", 20_000);
  }
}

export class ProjectorStatus {
  constructor(private readonly client: EscVpClient) {}

  async power(): Promise<ProjectorPowerStatus> {
    const code = await this.client.query("PWR");
    return { code, state: powerStateFromCode(code) };
  }

  async lampHours(): Promise<number> {
    const response = await this.client.query("LAMP");
    const match = /\d+/.exec(response);
    if (!match) {
      throw new Error(`Unexpected LAMP response: ${response}`);
    }
    return Number.parseInt(match[0], 10);
  }
}

export function powerStateFromCode(code: string): ProjectorPowerState {
  switch (code) {
    case "00": return "standby";
    case "01": return "on";
    case "02": return "warming";
    case "03": return "cooling";
    default: return "unknown";
  }
}
