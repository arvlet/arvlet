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
          <h2 id="create-title">新建产物</h2>
          <button
            type="button"
            aria-label="关闭"
            disabled={busy}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <label>
          名称
          <input
            name="title"
            disabled={busy}
            required
            maxLength={200}
            placeholder="给这个成果一个名字"
            autoFocus
          />
        </label>
        <div className="form-row">
          <label>
            类型
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
            归档到
            <input
              name="collection"
              disabled={busy}
              placeholder="可选，例如：个人工具"
              maxLength={100}
            />
          </label>
        </div>
        <label>
          初始内容
          <textarea
            key={kind}
            name="content"
            disabled={busy}
            className="initial-content"
            defaultValue={
              kind === "json"
                ? "{}"
                : kind === "html"
                  ? "<h1>Hello, Arvlet.</h1>\n<p>从这里开始你的交互产物。</p>"
                  : "# 新的想法\n\n从这里开始。"
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
          {busy ? "正在创建…" : "创建产物"}
        </button>
      </form>
    </dialog>
  );
}
