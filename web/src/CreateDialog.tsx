import { useEffect, useRef, useState } from "react";
import { api, messageOf, type Artifact, type ArtifactDetail } from "./api";
import { kindLabels } from "./artifactKinds";

export function CreateDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (artifact: ArtifactDetail) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [kind, setKind] = useState("markdown");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      aria-labelledby="create-title"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          setBusy(true);
          setError("");
          api<Artifact>("/api/v1/artifacts", "POST", {
            title: form.get("title"),
            kind,
            collection: form.get("collection"),
            content: form.get("content"),
          })
            .then((artifact) =>
              onCreated({
                ...artifact,
                content: String(form.get("content") ?? ""),
                versions: [
                  { version: 1, note: "", created_at: artifact.created_at },
                ],
              }),
            )
            .catch((error: unknown) => setError(messageOf(error)))
            .finally(() => setBusy(false));
        }}
      >
        <div className="dialog-heading">
          <h2 id="create-title">New artifact</h2>
          <button
            type="button"
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <label>
          Name
          <input
            name="title"
            disabled={busy}
            required
            maxLength={200}
            placeholder="Give this artifact a name"
            autoFocus
          />
        </label>
        <div className="form-row">
          <label>
            Type
            <select
              value={kind}
              disabled={busy}
              onChange={(event) => setKind(event.target.value)}
            >
              {Object.entries(kindLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Collection
            <input
              name="collection"
              disabled={busy}
              placeholder="Optional, e.g. Personal tools"
              maxLength={100}
            />
          </label>
        </div>
        <label>
          Initial content
          <textarea
            key={kind}
            name="content"
            disabled={busy}
            className="initial-content"
            defaultValue={
              kind === "json"
                ? "{}"
                : kind === "html"
                  ? "<h1>Hello, Arvlet.</h1>\n<p>Start your interactive artifact here.</p>"
                  : "# A new idea\n\nStart here."
            }
            spellCheck={false}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy ? "Creating…" : "Create artifact"}
        </button>
      </form>
    </dialog>
  );
}
