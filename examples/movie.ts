import { EpsonProjector } from "../src";

const input = process.argv[2];
if (!input) {
  throw new Error("Usage: bun run example:movie -- ./movie.mpg");
}

const projector = new EpsonProjector({
  host: process.env.EASYMP_HOST ?? "192.168.1.82",
  localAddress: process.env.EASYMP_LOCAL_ADDRESS,
});

await projector.movie.play(input, {
  ffmpegPath: process.env.FFMPEG_PATH,
});
