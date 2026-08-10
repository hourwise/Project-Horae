import { createServer, type Server } from "node:http";
import { describe, expect, it } from "vitest";
import {
  createSlice02HostServer,
  readSlice02HostConfig,
  SLICE02_ROUTE_PATH,
  type Slice02HostConfig,
} from "./index.js";

const VALID_ENV = {
  HORAE_BIND_HOST: "127.0.0.1",
  HORAE_PORT: "34104",
  ANANKE_ENDPOINT: "http://127.0.0.1:34102",
  EXPECTED_ANANKE_ENDPOINT: "http://127.0.0.1:34102/api",
  ANANKE_INSTANCE_ID: "ananke-instance-1",
};

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("test server did not expose an address");
  return address.port;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

async function request(port: number, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${path}`, init);
}

describe("tracked Slice 02 Horae host", () => {
  it("requires explicit local host configuration and rejects malformed values", () => {
    expect(readSlice02HostConfig(VALID_ENV)).toMatchObject({
      bindHost: "127.0.0.1",
      port: 34104,
      anankeEndpoint: "http://127.0.0.1:34102",
      expectedAnankeEndpoint: "http://127.0.0.1:34102/api",
    });
    expect(() => readSlice02HostConfig({ ...VALID_ENV, HORAE_BIND_HOST: "0.0.0.0" })).toThrow(
      "HORAE_BIND_HOST",
    );
    expect(() => readSlice02HostConfig({ ...VALID_ENV, HORAE_PORT: "not-a-port" })).toThrow(
      "HORAE_PORT",
    );
    expect(() => readSlice02HostConfig({ ...VALID_ENV, ANANKE_ENDPOINT: "not-a-url" })).toThrow(
      "ANANKE_ENDPOINT",
    );
    expect(() =>
      readSlice02HostConfig({ ...VALID_ENV, ANANKE_ENDPOINT: "http://user:pass@127.0.0.1" }),
    ).toThrow("ANANKE_ENDPOINT");
  });

  it("delegates the exact route to the supplied canonical relay handler", async () => {
    let calls = 0;
    let receivedPath = "";
    const server = createSlice02HostServer(async (incoming: Request) => {
      calls += 1;
      receivedPath = new URL(incoming.url).pathname;
      return new Response(JSON.stringify({ delegated: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const port = await listen(server);
    try {
      const response = await request(port, SLICE02_ROUTE_PATH, {
        method: "POST",
        body: JSON.stringify({ action: "fixed" }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ delegated: true });
      expect(calls).toBe(1);
      expect(receivedPath).toBe(SLICE02_ROUTE_PATH);
    } finally {
      await close(server);
    }
  });

  it("rejects unknown paths, unsupported methods, and proxy-shaped paths without invoking the relay", async () => {
    let calls = 0;
    const server = createSlice02HostServer(async () => {
      calls += 1;
      return new Response("unexpected", { status: 200 });
    });
    const port = await listen(server);
    try {
      expect((await request(port, "/unknown")).status).toBe(404);
      expect((await request(port, "/api/execute?target=http://example.invalid")).status).toBe(404);
      expect((await request(port, SLICE02_ROUTE_PATH, { method: "GET" })).status).toBe(405);
      expect(calls).toBe(0);
    } finally {
      await close(server);
    }
  });

  it("supports deterministic normal shutdown and cleanup", async () => {
    const server = createSlice02HostServer(async () => new Response("ok"));
    const port = await listen(server);
    expect(port).toBeGreaterThan(0);
    await close(server);
    expect(server.listening).toBe(false);
  });
});
