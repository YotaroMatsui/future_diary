type AcquireRequest = {
  ttlMs?: number;
};

type AcquireResponse =
  | { ok: true; acquired: true; lockedUntilMs: number }
  | { ok: true; acquired: false; lockedUntilMs: number };

type ReleaseResponse = { ok: true };

const jsonResponse = (value: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json; charset=utf-8" },
    ...init,
  });

export class DraftGenerationLock {
  readonly #state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.#state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/acquire") {
      const payload = (await request.json().catch(() => null)) as AcquireRequest | null;
      const ttlMs = typeof payload?.ttlMs === "number" && payload.ttlMs > 0 ? Math.floor(payload.ttlMs) : 10 * 60_000;

      return await this.#state.blockConcurrencyWhile(async () => {
        const now = Date.now();
        const lockedUntilMs = ((await this.#state.storage.get<number>("lockedUntilMs")) ?? 0) as number;

        if (lockedUntilMs > now) {
          const body: AcquireResponse = { ok: true, acquired: false, lockedUntilMs };
          return jsonResponse(body, { status: 200 });
        }

        const nextLockedUntilMs = now + ttlMs;
        await this.#state.storage.put("lockedUntilMs", nextLockedUntilMs);
        const body: AcquireResponse = { ok: true, acquired: true, lockedUntilMs: nextLockedUntilMs };
        return jsonResponse(body, { status: 200 });
      });
    }

    if (request.method === "POST" && url.pathname === "/release") {
      await this.#state.storage.put("lockedUntilMs", 0);
      const body: ReleaseResponse = { ok: true };
      return jsonResponse(body, { status: 200 });
    }

    return jsonResponse({ ok: false, error: { type: "NOT_FOUND", message: "Unknown lock endpoint" } }, { status: 404 });
  }
}

export type DraftGenerationLockBindings = {
  GENERATION_LOCK?: DurableObjectNamespace;
};

export const acquireDraftGenerationLock = async (params: {
  env: DraftGenerationLockBindings;
  key: string;
  ttlMs: number;
}): Promise<{ ok: true; acquired: boolean; lockedUntilMs: number } | { ok: false; message: string }> => {
  const namespace = params.env.GENERATION_LOCK;
  if (!namespace) {
    return { ok: true, acquired: true, lockedUntilMs: Date.now() + params.ttlMs };
  }

  try {
    const id = namespace.idFromName(params.key);
    const stub = namespace.get(id);
    const response = await stub.fetch("https://draft-generation-lock/acquire", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ttlMs: params.ttlMs }),
    });

    if (!response.ok) {
      return { ok: false, message: `Lock acquire failed: ${response.status}` };
    }

    const json = (await response.json().catch(() => null)) as AcquireResponse | null;
    if (!json || json.ok !== true) {
      return { ok: false, message: "Lock acquire returned invalid JSON" };
    }

    return { ok: true, acquired: json.acquired, lockedUntilMs: json.lockedUntilMs };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
};

export const releaseDraftGenerationLock = async (params: {
  env: DraftGenerationLockBindings;
  key: string;
}): Promise<void> => {
  const namespace = params.env.GENERATION_LOCK;
  if (!namespace) {
    return;
  }

  try {
    const id = namespace.idFromName(params.key);
    const stub = namespace.get(id);
    await stub.fetch("https://draft-generation-lock/release", { method: "POST" });
  } catch {
    // best-effort
  }
};
