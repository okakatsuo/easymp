import { EpsonProjector } from "../src";

const projector = new EpsonProjector({
  host: process.env.EASYMP_HOST ?? "192.168.1.82",
  localAddress: process.env.EASYMP_LOCAL_ADDRESS ?? "192.168.1.17",
});

console.log(await projector.status.power());

if (process.argv[2] === "on") await projector.power.on();
if (process.argv[2] === "off") await projector.power.off();
