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
    <section className="workspace" aria-label="产物工作区">
      <header className="workspace-heading">
        <button
          className="text-button"
          disabled={busy}
          onClick={() => {
            if (!dirty || confirm("有未保存的修改，仍要关闭吗？")) onClose();
          }}
        >
          ← 产物库
        </button>
        <div>
          <span className="eyebrow">
            {artifact.collection || "未归档"} / {artifact.kind.toUpperCase()}
          </span>
          <h1>{artifact.title}</h1>
        </div>
        <label className="version-select">
          历史版本
          <select
            disabled={busy}
            value={version}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (
                content !== original &&
                !confirm("切换版本会放弃未保存的内容，继续吗？")
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
                {item.version === artifact.revision ? " · 最新" : ""}
              </option>
            ))}
          </select>
        </label>
      </header>
      <div className="workspace-tools">
        <nav aria-label="产物视图">
          {[
            ["preview", "预览"],
            ["edit", "编辑内容"],
            ["data", "交互数据"],
            ["entries", "相关记录"],
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
        <span className="muted">内容 v{version} · 数据独立保存</span>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}{" "}
          {error.includes("Revision conflict") &&
            "服务端已有新版本。请先复制保留当前修改，再重新打开产物核对。"}
        </p>
      )}
      {version !== artifact.revision && (
        <div className="notice">
          正在查看历史版本。保存会创建新版本，不会覆盖历史内容。
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
            产物源代码
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
              aria-label="版本说明"
              disabled={busy}
              placeholder="简短说明这次改动（可选）"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            <span>
              {content !== original ? "有未保存的修改" : "与所选版本一致"}
            </span>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void saveContent()}
            >
              保存为新版本
            </button>
          </div>
        </div>
      )}
      {tab === "data" && state && (
        <div className="editor-pane">
          <p className="notice">
            编辑产物的业务数据，不会修改产物代码。当前数据版本 r{state.revision}
            。
          </p>
          <textarea
            className="code-editor"
            aria-label="交互数据 JSON"
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
                    !confirm("重新读取会放弃未保存的数据修改，继续吗？")
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
              重新读取
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
              保存数据
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
            <label htmlFor="related-entry">为这个产物留一条记录</label>
            <textarea
              id="related-entry"
              disabled={busy}
              required
              value={entry}
              onChange={(event) => setEntry(event.target.value)}
            />
            <button className="primary" disabled={busy}>
              追加记录
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
        <p className="muted">还没有记录。留下一次观察、修改说明或执行结果。</p>
      ) : (
        entries.map((entry) => (
          <article key={entry.id}>
            <div className="entry-meta">
              <strong>{entry.agent}</strong>
              <time>{new Date(entry.created_at).toLocaleString("zh-CN")}</time>
              {entry.artifact_id && <span>关联产物</span>}
            </div>
            <p>{entry.message}</p>
          </article>
        ))
      )}
    </div>
  );
}
