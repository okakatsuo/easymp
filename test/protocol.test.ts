import { describe, expect, test } from "bun:test";

import {
  createConnectPacket,
  createControlPacket,
  createEprdPacket,
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
  test("patches the local address into the known-good EMP-1715 connect packet", () => {
    const packet = createConnectPacket("10.20.30.40");
    expect(packet.subarray(0, 8).toString("ascii")).toBe("EEMP0100");
    expect(packet.subarray(8, 12)).toEqual(Buffer.from([10, 20, 30, 40]));
    expect(packet[12]).toBe(4);
  });

  test("creates keepalive and disconnect control packets", () => {
    expect(createControlPacket("192.168.1.17", 0x0a).toString("hex"))
      .toBe("45454d5030313030c0a801110a00000000000000");
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
