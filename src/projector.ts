import { EscVpClient } from "./control/escvp";
import { EasyMPDisplay, type EasyMPDisplayOptions } from "./easymp/display";

export interface EpsonProjectorOptions extends EasyMPDisplayOptions {
  controlPort?: number;
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

export class EpsonProjector {
  readonly control: EscVpClient;
  readonly display: EasyMPDisplay;
  readonly power: ProjectorPower;
  readonly status: ProjectorStatus;

  constructor(readonly options: EpsonProjectorOptions) {
    this.control = new EscVpClient({
      host: options.host,
      port: options.controlPort,
      timeout: options.timeout,
    });
    this.display = new EasyMPDisplay(options);
    this.power = new ProjectorPower(this.control);
    this.status = new ProjectorStatus(this.control);
  }

  powerOn(): Promise<void> {
    return this.power.on();
  }

  powerOff(): Promise<void> {
    return this.power.off();
  }

  async close(): Promise<void> {
    await this.display.disconnect();
  }
}

export class ProjectorPower {
  constructor(private readonly client: EscVpClient) {}

  async on(): Promise<void> {
    await this.client.command("PWR ON");
  }

  async off(): Promise<void> {
    await this.client.command("PWR OFF");
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
