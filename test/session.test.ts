import { describe, expect, test } from "bun:test";
import dgram from "node:dgram";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { once } from "node:events";

import { EasyMPSession, createControlPacket } from "../src";

const client = "127.0.0.1";
const projector = "127.0.0.2";

describe("EasyMPSession", () => {
  test("stops discovery on reply and handles fragmented greetings and delayed disconnect replies", async () => {
    const udp = dgram.createSocket("udp4");
    udp.bind(0, projector);
    await once(udp, "listening");
    const port = udp.address().port;
    const session = new EasyMPSession({ host: projector, localAddress: client, port, timeout: 1_500 });
    const projectorId = Buffer.from([1, 2, 3, 4]);
    const discovery = Buffer.alloc(74);
    projectorId.copy(discovery, 50);
    let discoveryCount = 0;
    let connectId: Buffer | undefined;
    let acknowledgementSent = false;
    const status = createControlPacket(client, 0x0a, Buffer.alloc(20));
    let control: net.Socket | undefined;
    let otherPeer: net.Socket | undefined;

    udp.on("message", (packet) => {
      if (packet[12] === 0x02) {
        discoveryCount += 1;
        udp.send(createControlPacket(client, 0x03, discovery), port, client);
      } else if (packet[12] === 0x04) {
        connectId = packet.subarray(70, 74);
        // Only a callback from the configured projector may claim the session.
        otherPeer = net.createConnection({ host: client, port, localAddress: client });
        otherPeer.on("error", () => {});
        otherPeer.once("connect", () => {
          const socket = net.createConnection({ host: client, port, localAddress: projector });
          control = socket;
          socket.on("error", () => {});
          socket.once("connect", async () => {
            const greeting = createControlPacket(client, 0x05, discovery);
            socket.write(greeting.subarray(0, 5));
            await delay(20);
            socket.write(greeting.subarray(5, 33));
            await delay(20);
            socket.write(Buffer.concat([greeting.subarray(33), status.subarray(0, 26)]));
          });
          let pending = Buffer.alloc(0);
          socket.on("data", async (chunk: Buffer) => {
            pending = Buffer.concat([pending, chunk]);
            while (pending.length >= 20) {
              const type = pending[12];
              pending = pending.subarray(20);
              if (type !== 0x06) continue;
              await delay(160);
              acknowledgementSent = true;
              socket.write(Buffer.concat([
                status.subarray(26),
                createControlPacket(client, 0x07),
              ]));
            }
          });
        });
      }
    });

    try {
      await Promise.all([session.connect(), session.connect()]);
      expect(session.connected).toBe(true);
      expect(discoveryCount).toBe(1);
      expect(connectId).toEqual(projectorId);
      const disconnectStarted = performance.now();
      await session.disconnect();
      expect(acknowledgementSent).toBe(true);
      expect(performance.now() - disconnectStarted).toBeLessThan(900);
      expect(session.connected).toBe(false);
    } finally {
      await session.disconnect();
      control?.destroy();
      otherPeer?.destroy();
      udp.close();
    }
  });
});
