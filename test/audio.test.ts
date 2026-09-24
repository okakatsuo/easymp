import { describe, expect, test } from "bun:test";

import { ProjectorAudio } from "../src";
import type { EscVpClient } from "../src";

class FakeControl {
  readonly commands: string[] = [];
  readonly responses = new Map<string, string>();

  async command(command: string): Promise<string> {
    this.commands.push(command);
    return "";
  }

  async query(command: string): Promise<string> {
    this.commands.push(`${command}?`);
    return this.responses.get(command) ?? "";
  }
}

function audioWith(control: FakeControl): ProjectorAudio {
  return new ProjectorAudio(control as unknown as EscVpClient);
}

describe("ProjectorAudio", () => {
  test("sets the EMP-1715 volume", async () => {
    const control = new FakeControl();
    const audio = audioWith(control);

    await audio.setVolume(0);
    await audio.setVolume(20);

    expect(control.commands).toEqual(["VOL 0", "VOL 20"]);
  });

  test.each([-1, 21, 1.5, Number.NaN])("rejects invalid volume %s", async (level) => {
    await expect(audioWith(new FakeControl()).setVolume(level)).rejects.toBeInstanceOf(RangeError);
  });

  test("selects and reads the audio output", async () => {
    const control = new FakeControl();
    const audio = audioWith(control);

    await audio.setOutput("internal");
    await audio.setOutput("external");
    control.responses.set("AUDIO", "02");

    expect(await audio.output()).toBe("external");
    expect(control.commands).toEqual(["AUDIO 01", "AUDIO 02", "AUDIO?"]);
  });

  test("rejects an unsupported audio output at runtime", async () => {
    const audio = audioWith(new FakeControl());
    await expect(audio.setOutput("bluetooth" as "internal")).rejects.toBeInstanceOf(TypeError);
  });

  test("controls the combined A/V mute", async () => {
    const control = new FakeControl();
    const audio = audioWith(control);

    await audio.mute();
    await audio.unmute();
    control.responses.set("MUTE", "ON");

    expect(await audio.muted()).toBe(true);
    expect(control.commands).toEqual(["MUTE ON", "MUTE OFF", "MUTE?"]);
  });

  test("rejects an unexpected mute response", async () => {
    const control = new FakeControl();
    control.responses.set("MUTE", "UNKNOWN");

    await expect(audioWith(control).muted()).rejects.toThrow("Unexpected MUTE response");
  });
});
