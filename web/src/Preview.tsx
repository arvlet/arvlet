import { useEffect, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { api, messageOf, type ArtifactDetail, type ArtifactState } from "./api";

type Props = { artifact: ArtifactDetail; version: number; content: string };

export function Preview({ artifact, version, content }: Props) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const [channel] = useState(() => crypto.randomUUID());
  const [allowWrite, setAllowWrite] = useState(false);
  const writePermission = useRef(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let mounted = true;
    let inFlight = false;
    const receive = async (event: MessageEvent) => {
      const request = event.data;
      const frameWindow = iframe.current?.contentWindow;
      if (
        event.source !== frameWindow ||
        event.origin !== "null" ||
        !request ||
        request.type !== "arvlet:request" ||
        request.channel !== channel ||
        typeof request.id !== "string" ||
        request.id.length > 100
      )
        return;
      const reply = (result?: ArtifactState, error?: string) => {
        if (mounted)
          frameWindow?.postMessage(
            { type: "arvlet:reply", channel, id: request.id, result, error },
            "*",
          );
      };
      if (inFlight) {
        reply(undefined, "Another request is in progress");
        return;
      }
      inFlight = true;
      try {
        const path = `/api/v1/artifacts/${artifact.id}/state`;
        if (request.op === "state.get") reply(await api<ArtifactState>(path));
        else if (request.op === "state.put") {
          if (!writePermission.current)
            throw new Error(
              "Allow this artifact to save data using the control above the preview first.",
            );
          const payload = request.payload;
          if (
            !payload ||
            !Number.isInteger(payload.revision) ||
            payload.revision < 0 ||
            !payload.data ||
            typeof payload.data !== "object" ||
            JSON.stringify(payload.data).length > 200000
          )
            throw new Error("Invalid state payload");
          const saved = await api<ArtifactState>(path, "PUT", {
            revision: payload.revision,
            data: payload.data,
          });
          reply(saved);
          if (mounted) setNotice("App data saved to the server");
        } else throw new Error("Unsupported operation");
      } catch (error) {
        reply(undefined, messageOf(error));
      } finally {
        inFlight = false;
      }
    };
    window.addEventListener("message", receive);
    return () => {
      mounted = false;
      window.removeEventListener("message", receive);
    };
  }, [artifact.id, channel]);

  if (artifact.kind === "markdown") {
    const html = DOMPurify.sanitize(marked.parse(content, { async: false }), {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ["style", "form", "input", "button"],
      FORBID_ATTR: ["style"],
    });
    return (
      <article
        className="document"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  if (artifact.kind === "json")
    return (
      <pre className="json-preview">
        {JSON.stringify(JSON.parse(content), null, 2)}
      </pre>
    );
  return (
    <div className="live-preview">
      <div className="preview-permission">
        <label>
          <input
            type="checkbox"
            checked={allowWrite}
            onChange={(event) => {
              writePermission.current = event.target.checked;
              setAllowWrite(event.target.checked);
            }}
          />
          Allow this artifact to save its data
        </label>
        <span role="status">
          {notice || "Sandboxed preview · No access to the parent page"}
        </span>
      </div>
      <iframe
        ref={iframe}
        title={artifact.title}
        sandbox="allow-scripts"
        src={`/preview/${artifact.id}/${version}?channel=${channel}`}
      />
    </div>
  );
}
