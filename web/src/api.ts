import type { components } from "./schema";

export type Artifact = components["schemas"]["Artifact"];
export type ArtifactDetail = components["schemas"]["ArtifactDetail"];
export type Entry = components["schemas"]["Entry"];
export type ArtifactState = components["schemas"]["State"];
export type Page<T> = {
  items: T[];
  total: number;
  offset: number;
  limit: number;
};

export class APIError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// Keep the key after a network failure: repeating a logical write is safe.
const pendingWrites = new Map<string, string>();
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const serialized = body === undefined ? undefined : JSON.stringify(body);
  const fingerprint = `${method}:${path}:${serialized}`;
  const headers: Record<string, string> = {};
  if (serialized !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET") {
    if (!pendingWrites.has(fingerprint))
      pendingWrites.set(fingerprint, crypto.randomUUID());
    headers["Idempotency-Key"] = pendingWrites.get(fingerprint)!;
  }
  const response = await fetch(path, {
    method,
    headers,
    body: serialized,
    credentials: "same-origin",
  });
  const text = await response.text();
  let result: unknown;
  try {
    result = JSON.parse(text);
  } catch {
    // A proxy may return HTML or an empty body while the service is restarting.
    // Preserve the retry key: the upstream mutation may already have committed.
    throw new APIError(
      response.status,
      `The server returned an invalid response (HTTP ${response.status}). Please try again.`,
    );
  }
  if (response.ok || response.status < 500) pendingWrites.delete(fingerprint);
  if (!response.ok)
    throw new APIError(
      response.status,
      result &&
        typeof result === "object" &&
        "error" in result &&
        typeof result.error === "string"
        ? result.error
        : `Request failed (HTTP ${response.status})`,
    );
  return result as T;
}

export const messageOf = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
