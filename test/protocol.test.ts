import { describe, expect, test } from "bun:test";

import {
  createConnectPacket,
  createControlPacket,
  createDiscoveryPacket,
  createEasyMPFfmpegArgs,
  createEprdPacket,
  createMovieStartPacket,
  createTile,
  encodeEasyMPLength,
  ipv4ToBuffer,
  parseEscVpResponse,
  powerStateFromCode,
  sameSubnet,
} from "../src/testing";

describe("IPv4 encoding", () => {
  test("encodes dotted IPv4", () => {
    expect(ipv4ToBuffer("192.168.1.17")).toEqual(Buffer.from([192, 168, 1, 17]));
  });

  test.each(["", "1.2.3", "1.2.3.256", "1.2.3.-1", "1.2.3.4.5", " 1.2.3.4"])(
    "rejects %s",
    (address) => expect(() => ipv4ToBuffer(address)).toThrow(),
  );

  test("matches addresses using the interface netmask", () => {
    expect(sameSubnet(
      ipv4ToBuffer("192.168.1.82"),
      ipv4ToBuffer("192.168.1.17"),
      ipv4ToBuffer("255.255.255.0"),
    )).toBe(true);
    expect(sameSubnet(
      ipv4ToBuffer("192.168.2.82"),
      ipv4ToBuffer("192.168.1.17"),
      ipv4ToBuffer("255.255.255.0"),
    )).toBe(false);
  });
});

describe("EasyMP length encoding", () => {
  test.each([
    [0, "90808000"],
    [1, "90818000"],
    [127, "90ff8000"],
    [128, "90808100"],
    [0x1fffff, "90ffff7f"],
  ] as const)("encodes %d", (length, hex) => {
    expect(encodeEasyMPLength(length).toString("hex")).toBe(hex);
  });

  test.each([-1, 0x200000, 1.5, Number.NaN])("rejects %s", (length) => {
    expect(() => encodeEasyMPLength(length)).toThrow(RangeError);
  });
});

describe("EasyMP packets", () => {
  test("patches both addresses into the captured EMP-1715 connect packet", () => {
    const packet = createConnectPacket(
      "10.20.30.40",
      "10.20.30.82",
      Buffer.from("01020304", "hex"),
    );
    expect(packet.length).toBe(94);
    expect(packet.subarray(0, 8).toString("ascii")).toBe("EEMP0100");
    expect(packet.subarray(8, 12)).toEqual(Buffer.from([10, 20, 30, 40]));
    expect(packet[12]).toBe(4);
    expect(packet.readUInt32LE(16)).toBe(packet.length - 20);
    expect(packet.subarray(70, 74)).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(packet.subarray(-4)).toEqual(Buffer.from([10, 20, 30, 82]));
  });

  test("rejects an invalid EasyMP projector ID", () => {
    expect(() => createConnectPacket(
      "10.20.30.40",
      "10.20.30.82",
      Buffer.alloc(3),
    )).toThrow(RangeError);
  });

  test("creates keepalive and disconnect control packets", () => {
    expect(createControlPacket("192.168.1.17", 0x0a).toString("hex"))
      .toBe("45454d5030313030c0a801110a00000000000000");
  });

  test("creates the captured broadcast and direct discovery packets", () => {
    const broadcast = createDiscoveryPacket("192.168.1.17");
    const direct = createDiscoveryPacket("192.168.1.17", true);
    expect(broadcast.length).toBe(68);
    expect(broadcast[12]).toBe(0x01);
    expect(direct[12]).toBe(0x02);
    expect(broadcast.readUInt32LE(16)).toBe(48);
    expect(broadcast.subarray(20)).toEqual(Buffer.alloc(48));
  });

  test("creates the captured movie playback start packet", () => {
    const packet = createMovieStartPacket("192.168.1.17", 50_020);
    expect(packet.length).toBe(68);
    expect(packet.subarray(0, 30).toString("hex")).toBe(
      "45454d5030313030c0a80111130000003000000000000000c0a80111c364",
    );
    expect(packet.subarray(30)).toEqual(Buffer.alloc(38));
  });

  test("encodes a tile and EPRD envelope", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const tile = createTile({ x: 104, y: 104, width: 128, height: 128, jpeg });
    expect(tile.subarray(0, 12).toString("hex")).toBe("006800680080008000000007");
    expect(tile.subarray(12, 16).toString("hex")).toBe("90848000");

    const packet = createEprdPacket("192.168.1.17", [
      { x: 104, y: 104, width: 128, height: 128, jpeg },
    ]);
    expect(packet.subarray(0, 8).toString("ascii")).toBe("EPRD0600");
    expect(packet.readUInt32BE(20)).toBe(1);
  });

  test("rejects invalid tiles and empty packets", () => {
    expect(() => createEprdPacket("192.168.1.17", [])).toThrow();
    expect(() => createTile({ x: -1, y: 0, width: 1, height: 1, jpeg: Buffer.from([1]) })).toThrow();
  });
});

describe("EasyMP movie transcoding", () => {
  test("matches the EMP-1715 MPEG-TS profile", () => {
    const args = createEasyMPFfmpegArgs("movie.mpg");
    const option = (name: string) => args[args.indexOf(name) + 1];

    expect(option("-i")).toBe("movie.mpg");
    expect(option("-vf")).toContain("scale=320:240");
    expect(option("-c:v")).toBe("mpeg2video");
    expect(option("-level:v")).toBe("4");
    expect(option("-c:a")).toBe("mp2");
    expect(option("-ar")).toBe("48000");
    expect(option("-streamid")).toBe("0:68");
    expect(option("-mpegts_pmt_start_pid")).toBe("66");
    expect(option("-mpegts_transport_stream_id")).toBe("25946");
    expect(args.at(-1)).toBe("pipe:1");
  });
});

describe("ESC/VP parsing", () => {
  test("removes CR and prompt", () => {
    expect(parseEscVpResponse(Buffer.from("PWR=01\r:"))).toBe("PWR=01");
    expect(parseEscVpResponse(Buffer.from(":"))).toBe("");
  });

  test("maps known power states", () => {
    expect(powerStateFromCode("00")).toBe("standby");
    expect(powerStateFromCode("01")).toBe("on");
    expect(powerStateFromCode("ff")).toBe("unknown");
  });
});
