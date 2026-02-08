interface ReindexCursor {
  userId: string;
  date: string;
}

interface ReindexRequest {
  userId?: string;
  cursor?: ReindexCursor;
  limit: number;
  dryRun: boolean;
}

const buildReindexRequest = (overrides: Partial<ReindexRequest> = {}): ReindexRequest => ({
  limit: 50,
  dryRun: false,
  ...overrides,
});

const request = buildReindexRequest({ dryRun: true });

console.log(
  JSON.stringify(
    {
      ok: true,
      request,
      usage: {
        endpoint: "/v1/vector/reindex",
        requiredHeaders: ["content-type: application/json", "x-jobs-token: <JOBS_TOKEN>"],
      },
    },
    null,
    2,
  ),
);

export { buildReindexRequest };
