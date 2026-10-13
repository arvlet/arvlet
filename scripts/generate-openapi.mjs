import { writeFileSync } from "node:fs";

const string = { type: "string" };
const integer = { type: "integer", minimum: 1 };
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const object = (properties, required = Object.keys(properties)) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required,
});
const artifact = object({
  id: string,
  title: string,
  kind: { enum: ["html", "markdown", "json"] },
  collection: string,
  revision: integer,
  created_at: string,
  updated_at: string,
});
const version = object({
  version: integer,
  content: string,
  note: string,
  created_at: string,
});
const schemas = {
  Share: object({ path: string }),
  Preview: object({ url: string, origin: string }),
  Revocation: object({ revoked: { type: "boolean" } }),
  Artifact: artifact,
  ArtifactDetail: object({
    ...artifact.properties,
    content: string,
    versions: {
      type: "array",
      items: object({ version: integer, note: string, created_at: string }),
    },
  }),
  ArtifactInput: object(
    {
      title: { ...string, minLength: 1, description: "Max 600 UTF-8 bytes." },
      kind: artifact.properties.kind,
      collection: { ...string, default: "" },
      content: {
        ...string,
        default: "",
        description: "Max 1 MB UTF-8; JSON kind must contain valid JSON.",
      },
      note: { ...string, default: "" },
    },
    ["title", "kind"],
  ),
  Version: version,
  VersionInput: object(
    { revision: integer, content: string, note: { ...string, default: "" } },
    ["revision", "content"],
  ),
  State: object({
    revision: { type: "integer", minimum: 0 },
    data: {
      oneOf: [
        { type: "object", additionalProperties: true },
        { type: "array", items: {} },
      ],
      description: "Max 200 KB serialized JSON.",
    },
  }),
  Entry: object({
    id: string,
    artifact_id: { type: ["string", "null"] },
    message: string,
    agent: string,
    created_at: string,
  }),
  EntryInput: object(
    {
      artifact_id: { type: ["string", "null"] },
      message: {
        ...string,
        minLength: 1,
        description: "Max 20000 UTF-8 bytes.",
      },
      agent: { ...string, default: "Human" },
    },
    ["message"],
  ),
  Error: object({ error: string }),
};
for (const name of ["Artifact", "Entry"]) {
  schemas[`${name}Page`] = object({
    items: { type: "array", items: ref(name) },
    total: { type: "integer" },
    offset: { type: "integer" },
    limit: integer,
  });
}
const paths = {};
function route(path, method, summary, output, input, query = []) {
  const status = method === "post" ? "201" : "200";
  const parameters = [...path.matchAll(/\{(\w+)\}/g)].map((match) => ({
    name: match[1],
    in: "path",
    required: true,
    schema: string,
  }));
  for (const name of query)
    parameters.push({
      name,
      in: "query",
      schema:
        name === "limit"
          ? { type: "integer", minimum: 1, maximum: 200, default: 50 }
          : name === "offset"
            ? { type: "integer", minimum: 0, default: 0 }
            : string,
    });
  if (input)
    parameters.push({
      name: "Idempotency-Key",
      in: "header",
      schema: { ...string, maxLength: 200 },
      description:
        "Unique per logical write. Same key and input replays the committed result; different input returns 409. Keys do not expire in v0.1.",
    });
  const response = (schema, description) => ({
    description,
    content: { "application/json": { schema } },
  });
  (paths[path] ??= {})[method] = {
    summary,
    operationId: `${method}${summary.replace(/[^a-zA-Z]/g, "")}`,
    parameters,
    ...(input
      ? {
          requestBody: {
            required: true,
            content: { "application/json": { schema: ref(input) } },
          },
        }
      : {}),
    responses: {
      [status]: response(ref(output), "Success"),
      400: response(ref("Error"), "Invalid input"),
      401: response(ref("Error"), "Authentication required"),
      403: response(ref("Error"), "Origin rejected"),
      404: response(ref("Error"), "Not found"),
      409: response(ref("Error"), "Revision or idempotency conflict"),
      413: response(ref("Error"), "Size limit exceeded"),
      415: response(ref("Error"), "Unsupported media type"),
      422: response(ref("Error"), "Validation failed"),
    },
  };
}
route("/api/v1/artifacts", "get", "List artifacts", "ArtifactPage", null, [
  "q",
  "kind",
  "collection",
  "limit",
  "offset",
]);
route(
  "/api/v1/artifacts",
  "post",
  "Create artifact",
  "Artifact",
  "ArtifactInput",
);
route("/api/v1/artifacts/{id}", "get", "Get artifact", "ArtifactDetail");
route(
  "/api/v1/artifacts/{id}/versions/{version}",
  "get",
  "Get version",
  "Version",
);
route(
  "/api/v1/artifacts/{id}/versions",
  "post",
  "Create version",
  "Artifact",
  "VersionInput",
);
route("/api/v1/artifacts/{id}/state", "get", "Get state", "State");
route("/api/v1/artifacts/{id}/state", "put", "Update state", "State", "State");
route(
  "/api/v1/artifacts/{id}/shares",
  "post",
  "Create editable share",
  "Share",
);
route(
  "/api/v1/artifacts/{id}/shares",
  "delete",
  "Revoke all artifact shares",
  "Revocation",
);
route("/s/{token}/state", "get", "Read shared artifact state", "State");
route(
  "/s/{token}/state",
  "put",
  "Update shared artifact state",
  "State",
  "State",
);
for (const method of ["get", "put"]) {
  const operation = paths["/s/{token}/state"][method];
  operation.security = [];
  operation.description =
    "The unguessable path token authorizes access to one artifact. No workspace cookie or API key is needed. Revoked tokens return 404.";
  operation.parameters = operation.parameters.filter(
    (p) => p.name !== "Idempotency-Key",
  );
}
route("/api/v1/entries", "get", "List entries", "EntryPage", null, [
  "artifact_id",
  "limit",
  "offset",
]);
route("/api/v1/entries", "post", "Append entry", "Entry", "EntryInput");
route(
  "/preview/{id}/{version}",
  "get",
  "Create workbench preview ticket",
  "Preview",
  null,
  ["channel"],
);
route(
  "/s/{token}/preview",
  "get",
  "Create shared preview ticket",
  "Preview",
  null,
  ["channel"],
);
paths["/s/{token}/preview"].get.security = [];
const spec = {
  openapi: "3.1.0",
  info: {
    title: "Arvlet Agent API",
    version: "0.1.0",
    description:
      "Artifacts and append-only records. No task prerequisite. Single-owner workspace; Bearer token has full workspace access. Content versions and interaction state are independent. Reload on revision conflict; do not blindly overwrite.",
  },
  security: [{ bearerAuth: [] }],
  paths,
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
    schemas,
  },
};
writeFileSync(
  new URL("../internal/server/openapi.json", import.meta.url),
  JSON.stringify(spec, null, 2) + "\n",
);
