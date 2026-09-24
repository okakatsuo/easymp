import {
  EpsonProjector,
  ProjectorAudio,
  type EpsonProjectorOptions,
  type ProjectorAudioOutput,
  type ProjectorPowerStatus,
} from "easymp";

const options: EpsonProjectorOptions = {
  host: "192.0.2.1",
  localAddress: "192.0.2.2",
};

const projector = new EpsonProjector(options);
const status: Promise<ProjectorPowerStatus> = projector.status.power();
const audio: ProjectorAudio = projector.audio;
const output: Promise<ProjectorAudioOutput> = audio.output();

void status;
void output;
