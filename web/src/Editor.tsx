import { useEffect, useState } from "react";
import {
  api,
  messageOf,
  type Artifact,
  type ArtifactDetail,
  type ArtifactState,
  type Entry,
  type Page,
} from "./api";
import { Preview } from "./Preview";

type Props = {
  artifact: ArtifactDetail;
  onChanged: (artifact: ArtifactDetail) => void;
  onClose: () => void;
};

export function Editor({ artifact, onChanged, onClose }: Props) {
  const [tab, setTab] = useState("preview");
  const [version, setVersion] = useState(artifact.revision);
  const [content, setContent] = useState(artifact.content);
  const [original, setOriginal] = useState(artifact.content);
  const [note, setNote] = useState("");
  const [state, setState] = useState<ArtifactState>();
  const [stateText, setStateText] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [entry, setEntry] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const dirty =
    content !== original ||
    note !== "" ||
    entry !== "" ||
    (state && stateText !== JSON.stringify(state.data, null, 2));

  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);

  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  const loadEntries = async () => {
    const page = await api<Page<Entry>>(
      `/api/v1/entries?artifact_id=${artifact.id}&limit=200`,
    );
    setEntries(page.items);
  };

  async function changeTab(next: string) {
    await perform(async () => {
      if (next === "data" && !state) {
        const saved = await api<ArtifactState>(
          `/api/v1/artifacts/${artifact.id}/state`,
        );
        setState(saved);
        setStateText(JSON.stringify(saved.data, null, 2));
      }
      if (next === "entries") await loadEntries();
      setTab(next);
    });
  }

  async function saveContent() {
    await perform(async () => {
      const saved = await api<Artifact>(
        `/api/v1/artifacts/${artifact.id}/versions`,
        "POST",
        {
          revision: artifact.revision,
          content,
          note,
        },
      );
      setOriginal(content);
      setVersion(saved.revision);
      setNote("");
      onChanged({
        ...saved,
        content,
        versions: [
          { version: saved.revision, note, created_at: saved.updated_at },
          ...artifact.versions,
        ],
      });
    });
  }

  return (
    <section className="workspace" aria-label="Artifact workspace">
      <header className="workspace-heading">
        <button
          className="text-button"
          disabled={busy}
          onClick={() => {
            if (!dirty || confirm("You have unsaved changes. Close anyway?"))
              onClose();
          }}
        >
          ← Artifacts
        </button>
        <div>
          <span className="eyebrow">
            {artifact.collection || "Uncategorized"} /{" "}
            {artifact.kind.toUpperCase()}
          </span>
          <h1>{artifact.title}</h1>
        </div>
        <label className="version-select">
          Version history
          <select
            disabled={busy}
            value={version}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (
                content !== original &&
                !confirm(
                  "Switching versions will discard unsaved content. Continue?",
                )
              )
                return;
              void perform(async () => {
                const saved = await api<{ content: string }>(
                  `/api/v1/artifacts/${artifact.id}/versions/${next}`,
                );
                setVersion(next);
                setContent(saved.content);
                setOriginal(saved.content);
              });
            }}
          >
            {artifact.versions.map((item) => (
              <option key={item.version} value={item.version}>
                v{item.version}
                {item.version === artifact.revision ? " · Latest" : ""}
              </option>
            ))}
          </select>
        </label>
      </header>
      <div className="workspace-tools">
        <nav aria-label="Artifact views">
          {[
            ["preview", "Preview"],
            ["edit", "Edit content"],
            ["data", "App data"],
            ["entries", "Related entries"],
          ].map(([key, label]) => (
            <button
              key={key}
              disabled={busy}
              aria-current={tab === key ? "page" : undefined}
              onClick={() => void changeTab(key)}
            >
              {label}
            </button>
          ))}
        </nav>
        <span className="muted">
          Content v{version} · App data saved separately
        </span>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}{" "}
          {error.includes("Revision conflict") &&
            "A newer version exists on the server. Copy your changes, then reopen the artifact to compare."}
        </p>
      )}
      {version !== artifact.revision && (
        <div className="notice">
          You are viewing a previous version. Saving creates a new version and
          preserves the history.
        </div>
      )}
      {tab === "preview" && (
        <Preview
          key={`${artifact.id}-${version}`}
          artifact={artifact}
          version={version}
          content={original}
        />
      )}
      {tab === "edit" && (
        <div className="editor-pane">
          <label className="sr-only" htmlFor="content">
            Artifact source
          </label>
          <textarea
            id="content"
            className="code-editor"
            spellCheck={false}
            disabled={busy}
            value={content}
            onChange={(event) => setContent(event.target.value)}
          />
          <div className="save-bar">
            <input
              aria-label="Version note"
              disabled={busy}
              placeholder="Describe this change (optional)"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            <span>
              {content !== original
                ? "Unsaved changes"
                : "Matches the selected version"}
            </span>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void saveContent()}
            >
              Save new version
            </button>
          </div>
        </div>
      )}
      {tab === "data" && state && (
        <div className="editor-pane">
          <p className="notice">
            Edit app data independently of the artifact source. Current data
            revision: r{state.revision}.
          </p>
          <textarea
            className="code-editor"
            aria-label="App data JSON"
            disabled={busy}
            value={stateText}
            onChange={(event) => setStateText(event.target.value)}
            spellCheck={false}
          />
          <div className="save-bar">
            <button
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  if (
                    stateText !== JSON.stringify(state.data, null, 2) &&
                    !confirm(
                      "Reloading will discard unsaved data changes. Continue?",
                    )
                  )
                    return;
                  const saved = await api<ArtifactState>(
                    `/api/v1/artifacts/${artifact.id}/state`,
                  );
                  setState(saved);
                  setStateText(JSON.stringify(saved.data, null, 2));
                })
              }
            >
              Reload
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  const saved = await api<ArtifactState>(
                    `/api/v1/artifacts/${artifact.id}/state`,
                    "PUT",
                    { revision: state.revision, data: JSON.parse(stateText) },
                  );
                  setState(saved);
                  setStateText(JSON.stringify(saved.data, null, 2));
                })
              }
            >
              Save data
            </button>
          </div>
        </div>
      )}
      {tab === "entries" && (
        <div className="record-pane">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void perform(async () => {
                await api("/api/v1/entries", "POST", {
                  artifact_id: artifact.id,
                  message: entry,
                  agent: "Human",
                });
                setEntry("");
                await loadEntries();
              });
            }}
          >
            <label htmlFor="related-entry">
              Add an entry for this artifact
            </label>
            <textarea
              id="related-entry"
              disabled={busy}
              required
              value={entry}
              onChange={(event) => setEntry(event.target.value)}
            />
            <button className="primary" disabled={busy}>
              Add entry
            </button>
          </form>
          <EntryList entries={entries} />
        </div>
      )}
    </section>
  );
}

export function EntryList({ entries }: { entries: Entry[] }) {
  return (
    <div className="timeline">
      {entries.length === 0 ? (
        <p className="muted">
          No entries yet. Add an observation, change note, or result.
        </p>
      ) : (
        entries.map((entry) => (
          <article key={entry.id}>
            <div className="entry-meta">
              <strong>{entry.agent}</strong>
              <time>{new Date(entry.created_at).toLocaleString("en-US")}</time>
              {entry.artifact_id && <span>Linked artifact</span>}
            </div>
            <p>{entry.message}</p>
          </article>
        ))
      )}
    </div>
  );
}
