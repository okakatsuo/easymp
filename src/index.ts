export {
  ESCVP_HANDSHAKE,
  ESCVP_PORT,
  EscVpClient,
  EscVpError,
  parseEscVpResponse,
  type EscVpClientOptions,
} from "./control/escvp";
export {
  EasyMPDisplay,
  type EasyMPDisplayOptions,
  type RectangleOptions,
} from "./easymp/display";
export {
  encodeEasyMPLength,
} from "./easymp/length";
export {
  createEprdPacket,
  createTile,
  type Tile,
} from "./easymp/packet";
export {
  EASYMP_CONTROL_PORT,
  EasyMPSession,
  createConnectPacket,
  createControlPacket,
  type EasyMPSessionOptions,
} from "./easymp/session";
export {
  EASYMP_VIDEO_PORT,
  EasyMPVideo,
  type EasyMPVideoOptions,
} from "./easymp/video";
export {
  parseHexColor,
  rawRgbToJpeg,
  solidJpeg,
  type RgbColor,
} from "./image/encoder";
export {
  encodeFrame,
  type EasyMPImageInput,
  type EncodedFrame,
  type FrameOptions,
} from "./image/frame";
export {
  EpsonProjector,
  ProjectorPower,
  ProjectorStatus,
  powerStateFromCode,
  type EpsonProjectorOptions,
  type ProjectorPowerState,
  type ProjectorPowerStatus,
} from "./projector";
export { resolveLocalAddress } from "./utils/network";
