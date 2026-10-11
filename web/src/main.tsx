import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  api,
  APIError,
  messageOf,
  type Artifact,
  type ArtifactDetail,
  type Entry,
  type Page,
} from "./api";
import { Editor, EntryList } from "./Editor";
import "./style.css";
import { CreateDialog } from "./CreateDialog";
import { kindLabels, kindMarks } from "./artifactKinds";

function App() {
  const [authenticated, setAuthenticated] = useState<boolean>();
  const [password, setPassword] = useState("");
  const [view, setView] = useState("artifacts");
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState<ArtifactDetail>();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [entry, setEntry] = useState("");

  useEffect(() => {
    api("/api/v1/me")
      .then(() => setAuthenticated(true))
      .catch((error: unknown) => {
        setAuthenticated(false);
        if (!(error instanceof APIError && error.status === 401))
          setError(messageOf(error));
      });
  }, []);

  useEffect(() => {
    if (!authenticated || selected || view === "api") return;
    let active = true;
    setBusy(true);
    const path =
      view === "artifacts"
        ? `/api/v1/artifacts?limit=24&offset=${offset}&q=${encodeURIComponent(query)}&kind=${kind}`
        : `/api/v1/entries?limit=24&offset=${offset}`;
    api<Page<Artifact> | Page<Entry>>(path)
      .then((page) => {
        if (!active) return;
        if (view === "artifacts") setArtifacts(page.items as Artifact[]);
        else setEntries(page.items as Entry[]);
        setTotal(page.total);
        setError("");
      })
      .catch((error: unknown) => {
        if (active) setError(messageOf(error));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [authenticated, query, kind, view, offset, selected]);

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

  if (authenticated === undefined)
    return (
      <main className="login">
        <p role="status">正在打开 Arvlet…</p>
      </main>
    );
  if (!authenticated)
    return (
      <main className="login">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void perform(async () => {
              await api("/api/session", "POST", { password });
              setPassword("");
              setAuthenticated(true);
            });
          }}
        >
          <div className="brand">
            <span className="brand-mark">a</span>arvlet
            <span className="release">0.1</span>
          </div>
          <h1>让成果留在这里。</h1>
          <p className="muted">你的产物、记录，以及下一次灵感。</p>
          <label htmlFor="password">工作区密码</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "正在登录…" : "进入工作区 →"}
          </button>
          <small>密码保存在部署目录的 .env 文件中。</small>
        </form>
      </main>
    );

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">a</span>arvlet
        </div>
        <p className="eyebrow sidebar-caption">个人工作区</p>
        <nav aria-label="主导航">
          {[
            ["artifacts", "◫", "产物库"],
            ["entries", "≡", "记录"],
            ["api", "↗", "Agent 接入"],
          ].map(([key, icon, label]) => (
            <button
              key={key}
              disabled={!!selected || busy}
              aria-current={view === key ? "page" : undefined}
              onClick={() => {
                setView(key);
                setOffset(0);
                setQuery("");
              }}
            >
              <span>{icon}</span>
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="connection">
            <i />
            本地工作区
          </span>
          <p>为人和 Agent 留下成果。</p>
          <button
            className="text-button"
            disabled={!!selected || busy}
            onClick={() =>
              void perform(async () => {
                await api("/api/session", "DELETE");
                setAuthenticated(false);
              })
            }
          >
            退出登录
          </button>
          <small>ARVLET / 0.1.0</small>
        </div>
      </aside>
      <main className="main">
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {selected ? (
          <Editor
            key={selected.id}
            artifact={selected}
            onClose={() => setSelected(undefined)}
            onChanged={setSelected}
          />
        ) : (
          <>
            <header className="page-heading">
              <div>
                <p className="eyebrow">
                  {view === "artifacts"
                    ? "ARTIFACTS"
                    : view === "entries"
                      ? "JOURNAL"
                      : "FOR AGENTS"}
                </p>
                <h1>
                  {view === "artifacts"
                    ? "成果，有处可循。"
                    : view === "entries"
                      ? "每一次发现，都值得留下。"
                      : "从一个 API 请求开始。"}
                </h1>
                <p className="muted">
                  {view === "artifacts"
                    ? "打开、使用、继续打磨。让每个产物都活起来。"
                    : view === "entries"
                      ? "记录观察、修改和执行结果，串起工作的来路。"
                      : "直接创建产物和追加记录，无需安装专用 Skill。"}
                </p>
              </div>
              {view === "artifacts" && (
                <button className="primary" onClick={() => setShowCreate(true)}>
                  ＋ 新建产物
                </button>
              )}
            </header>
            {view === "artifacts" && (
              <>
                <div className="library-tools">
                  <div className="filters">
                    {[
                      ["", "全部"],
                      ["html", "交互应用"],
                      ["markdown", "文档"],
                      ["json", "数据"],
                    ].map(([key, label]) => (
                      <button
                        key={key}
                        aria-pressed={kind === key}
                        onClick={() => {
                          setKind(key);
                          setOffset(0);
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <input
                    aria-label="搜索产物"
                    placeholder="搜索产物…"
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setOffset(0);
                    }}
                  />
                </div>
                <div className="section-label">
                  <span>{query ? "搜索结果" : "最近更新"}</span>
                  <span>{total} 个产物</span>
                </div>
                <div className="artifact-grid" aria-busy={busy}>
                  {artifacts.map((artifact) => (
                    <button
                      className="artifact-card"
                      key={artifact.id}
                      disabled={busy}
                      onClick={() =>
                        void perform(async () =>
                          setSelected(
                            await api<ArtifactDetail>(
                              `/api/v1/artifacts/${artifact.id}`,
                            ),
                          ),
                        )
                      }
                    >
                      <div className={`card-preview ${artifact.kind}`}>
                        <span className="card-type">
                          {kindLabels[artifact.kind]}
                        </span>
                        <span className="kind-mark">
                          {kindMarks[artifact.kind]}
                        </span>
                        <span className="preview-line" />
                        <span className="preview-line short" />
                      </div>
                      <div className="card-info">
                        <div>
                          <h2>{artifact.title}</h2>
                          <span>↗</span>
                        </div>
                        <p>
                          {artifact.collection || "未归档"}
                          <span>
                            v{artifact.revision} ·{" "}
                            {new Date(artifact.updated_at).toLocaleDateString(
                              "zh-CN",
                            )}
                          </span>
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
                {!busy && artifacts.length === 0 && (
                  <div className="empty">
                    <h2>
                      {query || kind
                        ? "没有匹配的产物"
                        : "第一个产物，从这里开始"}
                    </h2>
                    <p>
                      创建一份文档、一个交互页面，或让 Agent 通过 API 写入。
                    </p>
                  </div>
                )}
              </>
            )}
            {view === "entries" && (
              <div className="journal">
                <form
                  className="entry-composer"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void perform(async () => {
                      await api("/api/v1/entries", "POST", {
                        message: entry,
                        agent: "Human",
                      });
                      setEntry("");
                      const page = await api<Page<Entry>>(
                        "/api/v1/entries?limit=24",
                      );
                      setEntries(page.items);
                      setTotal(page.total);
                      setOffset(0);
                    });
                  }}
                >
                  <label htmlFor="entry">留下一条记录</label>
                  <textarea
                    id="entry"
                    required
                    placeholder="发生了什么？有什么值得记住？"
                    value={entry}
                    onChange={(event) => setEntry(event.target.value)}
                  />
                  <button disabled={busy} className="primary">
                    追加记录
                  </button>
                </form>
                <EntryList entries={entries} />
              </div>
            )}
            {view !== "api" && total > 24 && (
              <div className="pagination">
                <button
                  disabled={busy || offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - 24))}
                >
                  上一页
                </button>
                <span>
                  {offset + 1}–{Math.min(offset + 24, total)} / {total}
                </span>
                <button
                  disabled={busy || offset + 24 >= total}
                  onClick={() => setOffset(offset + 24)}
                >
                  下一页
                </button>
              </div>
            )}
            {view === "api" && (
              <div className="api-guide">
                <h2>一个工作区，一套标准接口。</h2>
                <p>
                  Base URL：<code>{location.origin}/api/v1</code>
                </p>
                <p>
                  从部署目录的 <code>.env</code> 获取{" "}
                  <code>ARVLET_API_KEY</code>，交给受信任的 Agent。API Key
                  可以访问整个工作区。
                </p>
                <pre>{`curl ${location.origin}/api/v1/artifacts \\\n  -H "Authorization: Bearer $ARVLET_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -H "Idempotency-Key: report-001" \\\n  -d '{"title":"Research notes","kind":"markdown","content":"# Findings\\nHello, Arvlet."}'`}</pre>
                <p>
                  编辑内容时提交当前 revision，保存为新版本。记录通过{" "}
                  <code>POST /api/v1/entries</code> 追加，可选关联 artifact_id。
                </p>
                <a href="/api/openapi.json" target="_blank" rel="noreferrer">
                  查看 OpenAPI 契约 ↗
                </a>
                <h2>你的数据始终属于你。</h2>
                <p>
                  导出包含产物、所有内容版本、交互数据和记录。数据库备份与恢复步骤见项目文档。
                </p>
                <a className="button-link" href="/api/v1/export" download>
                  导出工作区 JSON ↓
                </a>
              </div>
            )}
          </>
        )}
        {showCreate && (
          <CreateDialog
            onClose={() => setShowCreate(false)}
            onCreated={(artifact) => {
              setSelected(artifact);
              setShowCreate(false);
            }}
          />
        )}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
