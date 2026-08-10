import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSlice02Route,
  HttpSlice02AnankeBinding,
  Slice02Relay,
  type Slice02RelayOptions,
} from "@horae/slice02-relay";

export const SLICE02_ROUTE_PATH = "/slice-02/governed-actions";
const LOCAL_R1_BIND_HOST = "127.0.0.1";
const DEFAULT_INSPECTION_TIMEOUT_MS = 1_000;
const DEFAULT_DISPATCH_TIMEOUT_MS = 1_000;

const EXPECTED_ORIGIN = Object.freeze({
  runtime: "moirae-code",
  instanceId: "moirae-live-origin-1",
  artifact: "moirae-slice02-live-origin",
});

export interface Slice02HostConfig {
  bindHost: typeof LOCAL_R1_BIND_HOST;
  port: number;
  anankeEndpoint: string;
  expectedAnankeEndpoint: string;
  expectedAnankeInstanceId: string;
  authorizationHeader?: string;
  inspectionTimeoutMs: number;
  dispatchTimeoutMs: number;
}

export type Slice02RouteHandler = ReturnType<typeof createSlice02Route>;

export function readSlice02HostConfig(env: NodeJS.ProcessEnv = process.env): Slice02HostConfig {
  const bindHost = required(env, "HORAE_BIND_HOST");
  if (bindHost !== LOCAL_R1_BIND_HOST) {
    throw new TypeError(`HORAE_BIND_HOST must be ${LOCAL_R1_BIND_HOST} for the R1 profile`);
  }
  const port = positivePort(required(env, "HORAE_PORT"), "HORAE_PORT");
  const anankeEndpoint = httpEndpoint(required(env, "ANANKE_ENDPOINT"), "ANANKE_ENDPOINT");
  const expectedAnankeEndpoint = httpEndpoint(
    required(env, "EXPECTED_ANANKE_ENDPOINT"),
    "EXPECTED_ANANKE_ENDPOINT",
  );
  const expectedAnankeInstanceId = required(env, "ANANKE_INSTANCE_ID");
  const authorizationHeader = env.ANANKE_AUTHORIZATION_HEADER;
  if (authorizationHeader !== undefined && authorizationHeader.length === 0) {
    throw new TypeError("ANANKE_AUTHORIZATION_HEADER must not be empty when supplied");
  }

  return {
    bindHost,
    port,
    anankeEndpoint,
    expectedAnankeEndpoint,
    expectedAnankeInstanceId,
    ...(authorizationHeader !== undefined ? { authorizationHeader } : {}),
    inspectionTimeoutMs: duration(
      env.HORAE_INSPECTION_TIMEOUT_MS ?? String(DEFAULT_INSPECTION_TIMEOUT_MS),
      "HORAE_INSPECTION_TIMEOUT_MS",
    ),
    dispatchTimeoutMs: duration(
      env.HORAE_DISPATCH_TIMEOUT_MS ?? String(DEFAULT_DISPATCH_TIMEOUT_MS),
      "HORAE_DISPATCH_TIMEOUT_MS",
    ),
  };
}

export function createConfiguredSlice02Host(config: Slice02HostConfig): Server {
  const relayOptions: Slice02RelayOptions = {
    binding: new HttpSlice02AnankeBinding(config.anankeEndpoint),
    expectedAnanke: {
      instanceId: config.expectedAnankeInstanceId,
      endpoint: config.expectedAnankeEndpoint,
    },
    expectedOrigin: EXPECTED_ORIGIN,
    ...(config.authorizationHeader !== undefined
      ? { authorizationHeader: config.authorizationHeader }
      : {}),
    inspectionTimeoutMs: config.inspectionTimeoutMs,
    timeoutMs: config.dispatchTimeoutMs,
  };
  const relay = new Slice02Relay(relayOptions);
  return createSlice02HostServer(createSlice02Route(relay), config.bindHost);
}

/**
 * A deliberately narrow Node HTTP adapter for the canonical Slice 02 route.
 * It accepts no caller-selected upstream, path, or action and delegates route
 * policy to the existing createSlice02Route/Slice02Relay implementation.
 */
export function createSlice02HostServer(
  route: Slice02RouteHandler,
  bindHost: typeof LOCAL_R1_BIND_HOST = LOCAL_R1_BIND_HOST,
): Server {
  if (bindHost !== LOCAL_R1_BIND_HOST) {
    throw new TypeError(`Slice 02 host may bind only to ${LOCAL_R1_BIND_HOST}`);
  }
  return createServer((incoming, outgoing) => {
    void handleIncoming(route, incoming, outgoing);
  });
}

async function handleIncoming(
  route: Slice02RouteHandler,
  incoming: IncomingMessage,
  outgoing: ServerResponse,
): Promise<void> {
  const path = requestPath(incoming.url);
  if (path !== SLICE02_ROUTE_PATH) {
    writeJson(outgoing, 404, { error: "not found" });
    return;
  }
  if (incoming.method !== "POST") {
    writeJson(outgoing, 405, { error: "method not allowed" }, { allow: "POST" });
    return;
  }

  try {
    const body = await readBody(incoming);
    const request = new Request(
      `http://${LOCAL_R1_BIND_HOST}${incoming.url ?? SLICE02_ROUTE_PATH}`,
      {
        method: "POST",
        headers: headersFromIncoming(incoming),
        body: body.length > 0 ? body.toString("utf8") : undefined,
      },
    );
    const response = await route(request);
    const responseBody = Buffer.from(await response.arrayBuffer());
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(responseBody);
  } catch {
    writeJson(outgoing, 500, { error: "Horae route failure" });
  }
}

function requestPath(url: string | undefined): string {
  try {
    return new URL(url ?? "/", "http://horae.local").pathname;
  } catch {
    return "";
  }
}

function headersFromIncoming(incoming: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(incoming.headers)) {
    if (typeof value === "string") headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(", "));
  }
  return headers;
}

async function readBody(incoming: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function writeJson(
  outgoing: ServerResponse,
  status: number,
  body: Record<string, string>,
  extraHeaders: Record<string, string> = {},
): void {
  outgoing.writeHead(status, { "content-type": "application/json", ...extraHeaders });
  outgoing.end(JSON.stringify(body));
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new TypeError(`${name} is required`);
  return value;
}

function positivePort(value: string, name: string): number {
  const port = duration(value, name);
  if (port > 65_535) throw new TypeError(`${name} must be between 1 and 65535`);
  return port;
}

function duration(value: string, name: string): number {
  if (!/^[0-9]+$/.test(value)) throw new TypeError(`${name} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return parsed;
}

function httpEndpoint(value: string, name: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError(`${name} must be an absolute HTTP(S) URL`);
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password
  ) {
    throw new TypeError(`${name} must be an absolute HTTP(S) URL without embedded credentials`);
  }
  return parsed.toString().replace(/\/$/, "");
}

async function start(): Promise<void> {
  const config = readSlice02HostConfig();
  const server = createConfiguredSlice02Host(config);
  server.once("error", () => (process.exitCode = 1));
  server.listen(config.port, config.bindHost, () => {
    console.log(
      JSON.stringify({
        event: "HORAE_SLICE02_HOST_READY",
        bindHost: config.bindHost,
        port: config.port,
        route: SLICE02_ROUTE_PATH,
      }),
    );
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void start().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Horae host configuration failed");
    process.exitCode = 1;
  });
}
