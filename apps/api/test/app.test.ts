import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import { test } from "node:test";
import type { ApiErrorResponse, HealthResponse, ReadinessResponse } from "@mvp-transporte/contracts";
import { createApp } from "../src/app.ts";

async function withServer(
  app: ReturnType<typeof createApp>,
  callback: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = (server as Server).address();
  assert.ok(address && typeof address !== "string");

  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test("health reports a minimal live response with a request id", async () => {
  await withServer(createApp(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/health`, {
      headers: { connection: "close" },
    });
    const body = (await response.json()) as HealthResponse;

    assert.equal(response.status, 200);
    assert.equal(body.status, "ok");
    assert.equal(body.service, "api");
    assert.ok(Number.isFinite(Date.parse(body.timestamp)));
    assert.match(response.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/u);
  });
});

test("readiness confirms a successful database check", async () => {
  const app = createApp({ checkDatabase: async () => undefined });
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/ready`, {
      headers: { connection: "close" },
    });
    const body = (await response.json()) as ReadinessResponse;

    assert.equal(response.status, 200);
    assert.deepEqual(body, { status: "ready" });
  });
});

test("readiness hides dependency errors from the response", async () => {
  const app = createApp({
    checkDatabase: async () => {
      throw new Error("password=do-not-expose");
    },
  });
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/ready`, {
      headers: { connection: "close" },
    });
    const body = (await response.json()) as ApiErrorResponse;

    assert.equal(response.status, 503);
    assert.equal(body.error.code, "SERVICE_NOT_READY");
    assert.equal(body.error.message, "Servicio temporalmente no disponible.");
    assert.doesNotMatch(JSON.stringify(body), /do-not-expose/u);
    assert.match(body.error.requestId, /^[0-9a-f-]{36}$/u);
  });
});
