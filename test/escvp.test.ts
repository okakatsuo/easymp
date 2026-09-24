import { afterEach, describe, expect, test } from "bun:test";
import net from "node:net";

import { ESCVP_HANDSHAKE, EscVpClient } from "../src";

const servers: net.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => (
    new Promise<void>((resolve) => server.close(() => resolve()))
  )));
});

describe("EscVpClient", () => {
  test("performs the handshake and parses a command response", async () => {
    const received: Buffer[] = [];
    const server = net.createServer((socket) => {
      let stage = 0;
      socket.on("data", (data) => {
        received.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
        if (stage === 0) {
          stage += 1;
          socket.write(Buffer.concat([
            Buffer.from("ESC/VP.net", "ascii"),
            Buffer.from([0x10, 0x03, 0x00, 0x00, 0x20, 0x00]),
          ]));
        } else {
          socket.write("PWR=01\r:", "ascii");
        }
      });
    });
    servers.push(server);

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test server port");

    const client = new EscVpClient({
      host: "127.0.0.1",
      port: address.port,
      timeout: 1_000,
      localAddress: "127.0.0.1",
    });

    expect(await client.query("PWR")).toBe("01");
    expect(client.localAddress).toBe("127.0.0.1");
    expect(received[0]).toEqual(ESCVP_HANDSHAKE);
    expect(received[1]?.toString("ascii")).toBe("PWR?\r");
  });
});
