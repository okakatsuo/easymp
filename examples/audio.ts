import { EpsonProjector } from "../src";

const host = process.env.EASYMP_HOST ?? "192.168.1.82";
const localAddress = process.env.EASYMP_LOCAL_ADDRESS;
const [action, value] = process.argv.slice(2);

const projector = new EpsonProjector({ host, localAddress });

switch (action) {
  case undefined:
  case "status":
    console.log({
      output: await projector.audio.output(),
      muted: await projector.audio.muted(),
    });
    break;
  case "volume":
    if (value === undefined) throw new Error("Usage: audio.ts volume <0-20>");
    await projector.audio.setVolume(Number(value));
    break;
  case "output":
    if (value !== "internal" && value !== "external") {
      throw new Error("Usage: audio.ts output <internal|external>");
    }
    await projector.audio.setOutput(value);
    break;
  case "mute":
    await projector.audio.mute();
    break;
  case "unmute":
    await projector.audio.unmute();
    break;
  default:
    throw new Error(
      "Usage: audio.ts [status|volume <0-20>|output <internal|external>|mute|unmute]",
    );
}
