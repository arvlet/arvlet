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
import { kindLabels } from "./artifactKinds";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import {
  Folder,
  NotebookPen,
  Plug,
  LogOut,
  Plus,
  Search,
  ArrowUpRight,
  FileText,
  Code2,
  Braces,
  Moon,
  Sun,
} from "lucide-react";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Badge } from "./components/ui/badge";
import { Skeleton } from "./components/ui/skeleton";
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  SidebarInset,
  SidebarTrigger,
  SidebarRail,
} from "./components/ui/sidebar";

function App() {
  const [authenticated, setAuthenticated] = useState<boolean>();
  const [password, setPassword] = useState("");
  const [view, setView] = useState("artifacts");
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState<ArtifactDetail>();
  const [openingLink, setOpeningLink] = useState(() =>
    new URLSearchParams(location.search).has("artifact"),
  );
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [entry, setEntry] = useState("");
  const [dark, setDark] = useState(
    () => localStorage.getItem("arvlet-theme") === "dark",
  );

  useEffect(() => {
    if (!authenticated) return;
    const id = new URLSearchParams(location.search).get("artifact");
    if (!id) {
      setOpeningLink(false);
      return;
    }
    let active = true;
    setBusy(true);
    api<ArtifactDetail>(`/api/v1/artifacts/${encodeURIComponent(id)}`)
      .then((artifact) => {
        if (active) setSelected(artifact);
      })
      .catch((error: unknown) => {
        if (active) setError(messageOf(error));
      })
      .finally(() => {
        if (active) {
          setBusy(false);
          setOpeningLink(false);
        }
      });
    return () => {
      active = false;
    };
  }, [authenticated]);

  useEffect(() => {
    if (!selected) return;
    const url = new URL(location.href);
    url.searchParams.set("artifact", selected.id);
    history.replaceState(null, "", url);
  }, [selected?.id]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("arvlet-theme", dark ? "dark" : "light");
  }, [dark]);

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
    if (!authenticated || openingLink || selected || view === "api") return;
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
  }, [authenticated, openingLink, query, kind, view, offset, selected]);

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
        <p role="status">Opening Arvlet…</p>
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
          <h1>Your work belongs here.</h1>
          <p className="muted">Your artifacts, notes, and next great idea.</p>
          <label htmlFor="password">Workspace password</label>
          <Input
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
          <Button className="primary" disabled={busy}>
            {busy ? "Signing in…" : "Sign in →"}
          </Button>
          <small>
            Find your password in the deployment directory’s .env file.
          </small>
        </form>
      </main>
    );

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="brand">
            <span className="brand-mark">a</span>arvlet
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Personal workspace</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu aria-label="Main navigation">
                {[
                  { key: "artifacts", Icon: Folder, label: "Artifacts" },
                  { key: "entries", Icon: NotebookPen, label: "Activity" },
                  { key: "api", Icon: Plug, label: "Agent API" },
                ].map(({ key, Icon, label }) => (
                  <SidebarMenuItem key={key}>
                    <SidebarMenuButton
                      key={key}
                      tooltip={label}
                      isActive={view === key}
                      disabled={!!selected || busy}
                      aria-current={view === key ? "page" : undefined}
                      onClick={() => {
                        setView(key);
                        setOffset(0);
                        setQuery("");
                      }}
                    >
                      <Icon />
                      <span>{label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <div className="sidebar-bottom">
            <span className="connection">
              <i />
              Local workspace
            </span>
            <p>A home for human and agent work.</p>
          </div>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                disabled={!!selected || busy}
                onClick={() =>
                  void perform(async () => {
                    await api("/api/session", "DELETE");
                    setAuthenticated(false);
                  })
                }
              >
                <LogOut />
                <span>Sign out</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        <header className="app-header">
          <SidebarTrigger aria-label="Toggle sidebar" />
          <span className="header-divider" />
          <span className="breadcrumb">Workspace</span>
          <span className="breadcrumb-separator">/</span>
          <span>
            {selected
              ? selected.title
              : view === "artifacts"
                ? "Artifacts"
                : view === "entries"
                  ? "Activity"
                  : "Agent API"}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="theme-toggle"
            aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
            onClick={() => setDark(!dark)}
          >
            {dark ? <Sun /> : <Moon />}
          </Button>
          <span className="user-avatar" aria-label="Local user">
            A
          </span>
        </header>
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
              onClose={() => {
                const url = new URL(location.href);
                url.searchParams.delete("artifact");
                history.replaceState(null, "", url);
                setSelected(undefined);
              }}
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
                      ? "Artifacts"
                      : view === "entries"
                        ? "Activity"
                        : "Agent API"}
                  </h1>
                  <p className="muted">
                    {view === "artifacts"
                      ? "Open, use, and refine the work you create."
                      : view === "entries"
                        ? "Keep a record of observations, changes, and results."
                        : "Create artifacts and append entries through a standard API."}
                  </p>
                </div>
                {view === "artifacts" && (
                  <Button onClick={() => setShowCreate(true)}>
                    <Plus /> New artifact
                  </Button>
                )}
              </header>
              {view === "artifacts" && (
                <>
                  <div className="library-tools">
                    <div className="filters">
                      {[
                        ["", "All"],
                        ["html", "Apps"],
                        ["markdown", "Documents"],
                        ["json", "Data"],
                      ].map(([key, label]) => (
                        <Button
                          variant={kind === key ? "secondary" : "ghost"}
                          size="sm"
                          key={key}
                          aria-pressed={kind === key}
                          onClick={() => {
                            setKind(key);
                            setOffset(0);
                          }}
                        >
                          {label}
                        </Button>
                      ))}
                    </div>
                    <div className="search-field">
                      <Search aria-hidden="true" />
                      <Input
                        aria-label="Search artifacts"
                        placeholder="Search artifacts…"
                        value={query}
                        onChange={(event) => {
                          setQuery(event.target.value);
                          setOffset(0);
                        }}
                      />
                    </div>
                  </div>
                  <div className="section-label">
                    <span>{query ? "Search results" : "Recently updated"}</span>
                    <span>
                      {total} {total === 1 ? "artifact" : "artifacts"}
                    </span>
                  </div>
                  <div className="artifact-table-wrap" aria-busy={busy}>
                    <table className="artifact-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Type</th>
                          <th>Collection</th>
                          <th>Version</th>
                          <th>Updated</th>
                          <th>
                            <span className="sr-only">Open </span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {busy && artifacts.length === 0
                          ? Array.from({ length: 3 }, (_, index) => (
                              <tr key={index}>
                                <td colSpan={6}>
                                  <Skeleton className="h-9 w-full" />
                                </td>
                              </tr>
                            ))
                          : artifacts.map((artifact) => (
                              <tr key={artifact.id}>
                                <td>
                                  <button
                                    className="artifact-name"
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
                                    <span className="artifact-icon">
                                      {artifact.kind === "html" ? (
                                        <Code2 />
                                      ) : artifact.kind === "markdown" ? (
                                        <FileText />
                                      ) : (
                                        <Braces />
                                      )}
                                    </span>
                                    <span>{artifact.title}</span>
                                  </button>
                                </td>
                                <td>
                                  <Badge variant="outline">
                                    {kindLabels[artifact.kind]}
                                  </Badge>
                                </td>
                                <td className="muted">
                                  {artifact.collection || "Uncategorized"}
                                </td>
                                <td>
                                  <Badge variant="secondary">
                                    v{artifact.revision}
                                  </Badge>
                                </td>
                                <td className="muted">
                                  {new Date(
                                    artifact.updated_at,
                                  ).toLocaleDateString("en-US")}
                                </td>
                                <td>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label={`Open ${artifact.title}`}
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
                                    <ArrowUpRight />
                                  </Button>
                                </td>
                              </tr>
                            ))}
                      </tbody>
                    </table>
                  </div>
                  {!busy && artifacts.length === 0 && (
                    <div className="empty">
                      <h2>
                        {query || kind
                          ? "No matching artifacts"
                          : "Create your first artifact"}
                      </h2>
                      <p>
                        Create a document or interactive app, or let an agent
                        use the API.
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
                    <label htmlFor="entry">Add an entry</label>
                    <textarea
                      id="entry"
                      required
                      placeholder="What happened? What is worth remembering?"
                      value={entry}
                      onChange={(event) => setEntry(event.target.value)}
                    />
                    <button disabled={busy} className="primary">
                      Add entry
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
                    Previous
                  </button>
                  <span>
                    {offset + 1}–{Math.min(offset + 24, total)} / {total}
                  </span>
                  <button
                    disabled={busy || offset + 24 >= total}
                    onClick={() => setOffset(offset + 24)}
                  >
                    Next
                  </button>
                </div>
              )}
              {view === "api" && (
                <div className="api-guide">
                  <h2>One workspace. One API.</h2>
                  <p>
                    Base URL: <code>{location.origin}/api/v1</code>
                  </p>
                  <p>
                    Find <code>.env</code> in the deployment directory to
                    retrieve <code>ARVLET_API_KEY</code> and share it with a
                    trusted agent. The API key grants access to the entire
                    workspace.
                  </p>
                  <pre>{`curl ${location.origin}/api/v1/artifacts \\\n  -H "Authorization: Bearer $ARVLET_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -H "Idempotency-Key: report-001" \\\n  -d '{"title":"Research notes","kind":"markdown","content":"# Findings\\nHello, Arvlet."}'`}</pre>
                  <p>
                    Include the current revision when saving content as a new
                    version. Append entries with{" "}
                    <code>POST /api/v1/entries</code>, optionally linking an
                    artifact_id.
                  </p>
                  <a href="/api/openapi.json" target="_blank" rel="noreferrer">
                    View OpenAPI specification ↗
                  </a>
                  <h2>Your data stays yours.</h2>
                  <p>
                    Exports include artifacts, all content versions, app data,
                    and activity entries. See the project documentation for
                    database backup and recovery.
                  </p>
                  <a className="button-link" href="/api/v1/export" download>
                    Export workspace JSON ↓
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
      </SidebarInset>
    </SidebarProvider>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
