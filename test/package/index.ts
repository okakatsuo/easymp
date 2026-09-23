import {
  EpsonProjector,
  type EpsonProjectorOptions,
  type ProjectorPowerStatus,
} from "easymp";

const options: EpsonProjectorOptions = {
  host: "192.0.2.1",
  localAddress: "192.0.2.2",
};

const projector = new EpsonProjector(options);
const status: Promise<ProjectorPowerStatus> = projector.status.power();

void status;
