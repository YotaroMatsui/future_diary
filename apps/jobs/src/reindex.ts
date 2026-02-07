interface ReindexPayload {
  indexName: string;
  triggeredAt: string;
  reason: "manual" | "scheduled";
}

const buildReindexPayload = (reason: ReindexPayload["reason"]): ReindexPayload => ({
  indexName: "future-diary-index",
  triggeredAt: new Date().toISOString(),
  reason,
});

const payload = buildReindexPayload("manual");

console.log(JSON.stringify({ ok: true, payload }, null, 2));

export { buildReindexPayload };
