import { EpsonProjector } from "../src";

const projector = new EpsonProjector({
  host: process.env.EASYMP_HOST ?? "192.168.1.82",
  localAddress: process.env.EASYMP_LOCAL_ADDRESS ?? "192.168.1.17",
});

if (process.argv[2] === "on") {
  await projector.power.on();
  console.log("Power-on command completed");
} else if (process.argv[2] === "off") {
  await projector.power.off();
  console.log("Power-off command completed");
} else {
  console.log(await projector.status.power());
}
