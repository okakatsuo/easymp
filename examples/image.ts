import { EpsonProjector } from "../src";

const projector = new EpsonProjector({
  host: process.env.EASYMP_HOST ?? "192.168.1.82",
  localAddress: process.env.EASYMP_LOCAL_ADDRESS ?? "192.168.1.17",
});

await projector.display.connect();

try {
  await projector.display.show(process.argv[2] ?? "./dashboard.png");
  await new Promise((resolve) => setTimeout(resolve, 10_000));
} finally {
  await projector.close();
}
