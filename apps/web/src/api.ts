export interface HealthResponse {
  ok: boolean;
  env: string;
  service: string;
}

export const fetchHealth = async (baseUrl: string): Promise<HealthResponse> => {
  const response = await fetch(`${baseUrl}/health`);

  if (!response.ok) {
    throw new Error(`Failed to fetch health: ${response.status}`);
  }

  return (await response.json()) as HealthResponse;
};
