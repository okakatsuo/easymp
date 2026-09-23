import { EpsonProjector } from "../src";

const HOST = "192.168.1.82";
const LOCAL = "192.168.1.17";

const projector = new EpsonProjector({
  host: HOST,
  localAddress: LOCAL,
});

console.log("Connecting EasyMP display...");
await projector.display.connect();

try {
  await projector.display.rectangle({
    x: 104,
    y: 104,
    width: 128,
    height: 128,
    color: "#ff0000",
  });
  console.log("Red square sent!");
  await new Promise((resolve) => setTimeout(resolve, 10_000));
} finally {
  await projector.close();
}
