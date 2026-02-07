import type { Result } from "@future-diary/core";

export type OpenAiResponsesError =
  | { type: "OPENAI_HTTP_ERROR"; status: number; body: string }
  | { type: "OPENAI_TIMEOUT" }
  | { type: "OPENAI_NETWORK_ERROR"; message: string }
  | { type: "OPENAI_INVALID_RESPONSE"; message: string }
  | { type: "OPENAI_INCOMPLETE"; reason?: string }
  | { type: "OPENAI_REFUSAL"; refusal: string };

type OpenAiResponsesCreateRequest = {
  model: string;
  store?: boolean;
  max_output_tokens?: number;
  temperature?: number;
  safety_identifier?: string;
  input: Array<{ role: "system" | "user"; content: string }>;
  text: {
    format: {
      type: "json_schema";
      name: string;
      strict: boolean;
      schema: unknown;
    };
  };
};

type OpenAiResponsesCreateResponse = {
  status?: string;
  incomplete_details?: { reason?: string };
  output?: Array<{
    content?: Array<
      | { type: "output_text"; text: string }
      | { type: "refusal"; refusal: string }
      | { type: string }
    >;
  }>;
};

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : typeof error === "string" ? error : "unknown error";

const isRefusalContent = (value: unknown): value is { type: "refusal"; refusal: string } =>
  typeof value === "object" &&
  value !== null &&
  "type" in value &&
  (value as { type?: unknown }).type === "refusal" &&
  "refusal" in value &&
  typeof (value as { refusal?: unknown }).refusal === "string";

const isOutputTextContent = (value: unknown): value is { type: "output_text"; text: string } =>
  typeof value === "object" &&
  value !== null &&
  "type" in value &&
  (value as { type?: unknown }).type === "output_text" &&
  "text" in value &&
  typeof (value as { text?: unknown }).text === "string";

export const requestOpenAiStructuredOutputText = async (params: {
  fetcher: typeof fetch;
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  jsonSchemaName: string;
  jsonSchema: unknown;
  timeoutMs: number;
  maxOutputTokens: number;
  temperature: number;
  safetyIdentifier?: string;
}): Promise<Result<string, OpenAiResponsesError>> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), params.timeoutMs);

  const baseUrl = params.baseUrl.replace(/\/+$/, "");
  const url = `${baseUrl}/responses`;

  const body: OpenAiResponsesCreateRequest = {
    model: params.model,
    store: false,
    max_output_tokens: params.maxOutputTokens,
    temperature: params.temperature,
    safety_identifier: params.safetyIdentifier,
    input: [
      { role: "system", content: params.systemPrompt },
      { role: "user", content: params.userPrompt },
    ],
    text: {
      format: {
        type: "json_schema",
        name: params.jsonSchemaName,
        strict: true,
        schema: params.jsonSchema,
      },
    },
  };

  try {
    const response = await params.fetcher.call(globalThis, url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${params.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const responseBody = await response.text().catch(() => "");
      return {
        ok: false,
        error: { type: "OPENAI_HTTP_ERROR", status: response.status, body: responseBody },
      };
    }

    const json = (await response.json().catch(() => null)) as OpenAiResponsesCreateResponse | null;
    if (!json) {
      return {
        ok: false,
        error: { type: "OPENAI_INVALID_RESPONSE", message: "Response JSON was null" },
      };
    }

    if (json.status === "incomplete") {
      return {
        ok: false,
        error: { type: "OPENAI_INCOMPLETE", reason: json.incomplete_details?.reason },
      };
    }

    const output = json.output;
    if (!Array.isArray(output)) {
      return {
        ok: false,
        error: { type: "OPENAI_INVALID_RESPONSE", message: "Missing output array" },
      };
    }

    for (const item of output) {
      if (!item || !Array.isArray(item.content)) {
        continue;
      }

      for (const content of item.content) {
        if (isRefusalContent(content)) {
          return { ok: false, error: { type: "OPENAI_REFUSAL", refusal: content.refusal } };
        }

        if (isOutputTextContent(content)) {
          return { ok: true, value: content.text };
        }
      }
    }

    return {
      ok: false,
      error: { type: "OPENAI_INVALID_RESPONSE", message: "No output_text content found" },
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { ok: false, error: { type: "OPENAI_TIMEOUT" } };
    }

    return { ok: false, error: { type: "OPENAI_NETWORK_ERROR", message: toErrorMessage(error) } };
  } finally {
    clearTimeout(timeoutId);
  }
};
