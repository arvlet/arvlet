package server

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
)

type connectionCheckingWriter struct {
	*httptest.ResponseRecorder
	server *Server
	test   *testing.T
}

func (w connectionCheckingWriter) Write(body []byte) (int, error) {
	if count := w.server.db.Stats().InUse; count != 0 {
		w.test.Errorf("response starts while %d database connections remain occupied", count)
	}
	return w.ResponseRecorder.Write(body)
}

func TestResponsesReleaseDatabaseBeforeNetworkWrite(t *testing.T) {
	s := newTestServer(t)
	a := createTestArtifact(t, s)
	for _, path := range []string{"/api/v1/artifacts/" + a.ID, "/api/v1/export"} {
		t.Run(path, func(t *testing.T) {
			r := httptest.NewRequest("GET", path, nil)
			r.Header.Set("Authorization", "Bearer "+testSecret)
			w := connectionCheckingWriter{httptest.NewRecorder(), s, t}
			s.Handler().ServeHTTP(w, r)
			requireStatus(t, w.ResponseRecorder, 200)
		})
	}
}

func TestStateRequiresExplicitRevision(t *testing.T) {
	s := newTestServer(t)
	a := createTestArtifact(t, s)
	path := "/api/v1/artifacts/" + a.ID + "/state"
	for _, body := range []string{`{"data":{}}`, `{"revision":null,"data":{}}`, `{"revision":-1,"data":{}}`} {
		requireStatus(t, request(s, "PUT", path, body, ""), 422)
	}
	requireStatus(t, request(s, "PUT", path, `{"revision":0,"data":{}}`, ""), 200)
}

func TestReplacementConnectionsRetainForeignKeys(t *testing.T) {
	s := newTestServer(t)
	// Returning the sole connection with no idle capacity forces the next query to reconnect.
	conn, err := s.db.Conn(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	s.db.SetMaxIdleConns(0)
	if err = conn.Close(); err != nil {
		t.Fatal(err)
	}
	_, err = s.db.Exec("INSERT INTO entries VALUES ('bad','missing','message','agent','now')")
	if err == nil {
		t.Fatal("replacement connection accepted a broken foreign key")
	}
}

func TestDatabasePathEscaping(t *testing.T) {
	path := filepath.Join(t.TempDir(), "work #一.db")
	db, err := openDB(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err = os.Stat(path); err != nil {
		t.Fatal(err)
	}
}

const testSecret = "test-only-secret-at-least-32-characters"

func newTestServer(t *testing.T) *Server {
	t.Helper()
	s, err := New(Config{DBPath: filepath.Join(t.TempDir(), "arvlet.db"), APIKey: testSecret, Password: testSecret, SessionSecret: testSecret, Origin: "http://localhost:3090"})
	if err != nil {
		t.Fatal(err)
	}
	s.cfg.Assets = http.FS(fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("<!doctype html><title>Arvlet</title>")}})
	t.Cleanup(func() {
		if err := s.Close(); err != nil {
			t.Error(err)
		}
	})
	return s
}

func request(s *Server, method, path, body, key string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.Header.Set("Authorization", "Bearer "+testSecret)
	r.Header.Set("Content-Type", "application/json")
	if key != "" {
		r.Header.Set("Idempotency-Key", key)
	}
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	return w
}

func requireStatus(t *testing.T, w *httptest.ResponseRecorder, status int) {
	t.Helper()
	if w.Code != status {
		t.Fatalf("status %d, want %d: %s", w.Code, status, w.Body.String())
	}
}

func createTestArtifact(t *testing.T, s *Server) Artifact {
	t.Helper()
	w := request(s, "POST", "/api/v1/artifacts", `{"title":"Budget","kind":"html","content":"<h1>Version one</h1>"}`, "")
	requireStatus(t, w, 201)
	var artifact Artifact
	if err := json.Unmarshal(w.Body.Bytes(), &artifact); err != nil {
		t.Fatal(err)
	}
	return artifact
}

func TestEntriesDoNotRequireArtifacts(t *testing.T) {
	s := newTestServer(t)
	w := request(s, "POST", "/api/v1/entries", `{"message":"Research completed","agent":"Research agent"}`, "entry-1")
	requireStatus(t, w, 201)
	var entry Entry
	if err := json.Unmarshal(w.Body.Bytes(), &entry); err != nil {
		t.Fatal(err)
	}
	if entry.ArtifactID != nil {
		t.Fatal("standalone entry unexpectedly linked")
	}
	requireStatus(t, request(s, "POST", "/api/v1/entries", `{"artifact_id":"missing","message":"Invalid link"}`, ""), 404)
	requireStatus(t, request(s, "PATCH", "/api/v1/entries/"+entry.ID, `{"message":"Rewrite history"}`, ""), 404)
}

func TestIdempotencyReplaysAndRejectsDifferentInput(t *testing.T) {
	s := newTestServer(t)
	body := `{"title":"Notes","kind":"markdown","content":"  Preserve whitespace\n"}`
	first := request(s, "POST", "/api/v1/artifacts", body, "create-1")
	requireStatus(t, first, 201)
	second := request(s, "POST", "/api/v1/artifacts", body, "create-1")
	requireStatus(t, second, 201)
	if !bytes.Equal(first.Body.Bytes(), second.Body.Bytes()) {
		t.Fatal("retry did not replay committed response")
	}
	requireStatus(t, request(s, "POST", "/api/v1/artifacts", `{"title":"Other","kind":"markdown"}`, "create-1"), 409)
	var count int
	if err := s.db.QueryRow("SELECT count(*) FROM artifacts").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("retry created %d artifacts", count)
	}
}

func TestVersionConflictAndStateIndependence(t *testing.T) {
	s := newTestServer(t)
	a := createTestArtifact(t, s)
	base := "/api/v1/artifacts/" + a.ID
	requireStatus(t, request(s, "PUT", base+"/state", `{"revision":0,"data":{"budget":250}}`, "state-1"), 200)
	requireStatus(t, request(s, "POST", base+"/versions", `{"revision":1,"content":"<h1>Version two</h1>"}`, "version-2"), 201)
	requireStatus(t, request(s, "POST", base+"/versions", `{"revision":1,"content":"stale"}`, ""), 409)
	requireStatus(t, request(s, "PUT", base+"/state", `{"revision":0,"data":{}}`, ""), 409)
	state := request(s, "GET", base+"/state", "", "")
	if !strings.Contains(state.Body.String(), `"budget":250`) {
		t.Fatalf("content update lost data: %s", state.Body)
	}
	history := request(s, "GET", base+"/versions/1", "", "")
	var v Version
	if err := json.Unmarshal(history.Body.Bytes(), &v); err != nil {
		t.Fatal(err)
	}
	if v.Content != "<h1>Version one</h1>" {
		t.Fatal("history was overwritten")
	}
}

func TestConcurrentEditsOnlyOneWins(t *testing.T) {
	s := newTestServer(t)
	a := createTestArtifact(t, s)
	var wg sync.WaitGroup
	statuses := make(chan int, 8)
	for i := 0; i < 8; i++ {
		wg.Go(func() {
			w := request(s, "POST", "/api/v1/artifacts/"+a.ID+"/versions", `{"revision":1,"content":"update"}`, "")
			statuses <- w.Code
		})
	}
	wg.Wait()
	close(statuses)
	wins, conflicts := 0, 0
	for code := range statuses {
		switch code {
		case 201:
			wins++
		case 409:
			conflicts++
		default:
			t.Errorf("unexpected status %d", code)
		}
	}
	if wins != 1 || conflicts != 7 {
		t.Fatalf("wins=%d conflicts=%d", wins, conflicts)
	}
}

func TestCookieWritesRequireOriginAndBearerDoesNot(t *testing.T) {
	s := newTestServer(t)
	r := httptest.NewRequest("POST", "/api/session", strings.NewReader(fmt.Sprintf(`{"password":%q}`, testSecret)))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	requireStatus(t, w, 200)
	cookies := w.Result().Cookies()
	if len(cookies) != 1 || !cookies[0].HttpOnly || cookies[0].SameSite != http.SameSiteStrictMode {
		t.Fatal("unsafe session cookie")
	}
	for _, origin := range []string{"", "null", "https://evil.example", "http://localhost:3090"} {
		r = httptest.NewRequest("POST", "/api/v1/entries", strings.NewReader(`{"message":"test"}`))
		r.AddCookie(cookies[0])
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Origin", origin)
		w = httptest.NewRecorder()
		s.Handler().ServeHTTP(w, r)
		want := 403
		if origin == s.cfg.Origin {
			want = 201
		}
		requireStatus(t, w, want)
	}
	r = httptest.NewRequest("GET", "/api/v1/artifacts", nil)
	w = httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	requireStatus(t, w, 401)
	requireStatus(t, request(s, "POST", "/api/v1/entries", `{"message":"agent call"}`, ""), 201)
}

func TestPreviewIsOpaqueAndHasNoNetworkAccess(t *testing.T) {
	s := newTestServer(t)
	a := createTestArtifact(t, s)
	w := request(s, "GET", "/preview/"+a.ID+"/1?channel=0123456789abcdef", "", "")
	requireStatus(t, w, 200)
	csp := w.Header().Get("Content-Security-Policy")
	for _, policy := range []string{"sandbox allow-scripts;", "connect-src 'none'", "form-action 'none'", "base-uri 'none'"} {
		if !strings.Contains(csp, policy) {
			t.Errorf("missing policy %s", policy)
		}
	}
	if strings.Contains(csp, "allow-same-origin") || strings.Contains(w.Body.String(), testSecret) {
		t.Fatal("preview exposes credentials or origin")
	}
	requireStatus(t, request(s, "GET", "/preview/"+a.ID+"/1?channel=%3Cscript%3E", "", ""), 400)
}

func TestValidationAndRollback(t *testing.T) {
	s := newTestServer(t)
	for _, body := range []string{`{"title":"x","kind":"json","content":"invalid"}`, `{"title":" ","kind":"html"}`, `{"title":"x","kind":"executable"}`} {
		requireStatus(t, request(s, "POST", "/api/v1/artifacts", body, ""), 422)
	}
	requireStatus(t, request(s, "POST", "/api/v1/artifacts", `{"title":"x","kind":"html","unknown":true}`, ""), 400)
	body := `{"title":"x","kind":"html","content":"` + strings.Repeat("x", 1500000) + `"}`
	requireStatus(t, request(s, "POST", "/api/v1/artifacts", body, ""), 413)
	a := createTestArtifact(t, s)
	requireStatus(t, request(s, "POST", "/api/v1/artifacts/"+a.ID+"/versions", `{"revision":1}`, ""), 422)
	_, err := s.mutate(httptest.NewRequest("POST", "/rollback", nil), nil, func(tx *sql.Tx) (any, error) {
		_, err := tx.Exec("INSERT INTO entries VALUES ('rollback',NULL,'not committed','test','now')")
		if err != nil {
			return nil, err
		}
		return nil, fail(422, "deliberate failure")
	})
	if err == nil {
		t.Fatal("expected failure")
	}
	var count int
	if err = s.db.QueryRow("SELECT count(*) FROM entries WHERE id='rollback'").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatal("partial mutation committed")
	}
}

func TestDataAndIdempotencySurviveReopen(t *testing.T) {
	config := Config{
		DBPath: filepath.Join(t.TempDir(), "persistent.db"),
		APIKey: testSecret, Password: testSecret, SessionSecret: testSecret,
		Origin: "http://localhost:3090",
	}
	s, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	body := `{"title":"Persistent","kind":"markdown","content":"  keep leading spaces\n"}`
	first := request(s, "POST", "/api/v1/artifacts", body, "survives-restart")
	requireStatus(t, first, 201)
	var artifact Artifact
	if err := json.Unmarshal(first.Body.Bytes(), &artifact); err != nil {
		t.Fatal(err)
	}
	path := "/api/v1/artifacts/" + artifact.ID
	requireStatus(t, request(s, "PUT", path+"/state", `{"revision":0,"data":{"count":7}}`, ""), 200)
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}

	s, err = New(config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := s.Close(); err != nil {
			t.Error(err)
		}
	})
	replayed := request(s, "POST", "/api/v1/artifacts", body, "survives-restart")
	requireStatus(t, replayed, 201)
	if !bytes.Equal(first.Body.Bytes(), replayed.Body.Bytes()) {
		t.Fatal("retry ledger did not persist")
	}
	var state State
	if err := json.Unmarshal(request(s, "GET", path+"/state", "", "").Body.Bytes(), &state); err != nil {
		t.Fatal(err)
	}
	if state.Revision != 1 || !bytes.Contains(state.Data, []byte(`"count":7`)) {
		t.Fatalf("state lost: %+v", state)
	}
	var version Version
	if err := json.Unmarshal(request(s, "GET", path+"/versions/1", "", "").Body.Bytes(), &version); err != nil {
		t.Fatal(err)
	}
	if version.Content != "  keep leading spaces\n" {
		t.Fatal("artifact content changed during persistence")
	}
}

func TestExportDoesNotIncludeCredentials(t *testing.T) {
	s := newTestServer(t)
	createTestArtifact(t, s)
	w := request(s, "GET", "/api/v1/export", "", "")
	requireStatus(t, w, 200)
	var result struct {
		SchemaVersion int                        `json:"schema_version"`
		Tables        map[string]json.RawMessage `json:"tables"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.SchemaVersion != 1 || len(result.Tables) != 4 {
		t.Fatalf("invalid export: %s", w.Body)
	}
	if strings.Contains(w.Body.String(), testSecret) {
		t.Fatal("credentials leaked into export")
	}
}

func TestStaticAssetsAndUnknownRoutes(t *testing.T) {
	s := newTestServer(t)
	requireStatus(t, request(s, "GET", "/", "", ""), 200)
	requireStatus(t, request(s, "POST", "/", `{}`, ""), 405)
	requireStatus(t, request(s, "GET", "/api/v1/missing", "", ""), 404)
	r := httptest.NewRequest("POST", "/api/v1/artifacts", strings.NewReader(`{"title":"x","kind":"html"}`))
	r.Header.Set("Authorization", "Bearer "+testSecret)
	r.Header.Set("Content-Type", "application/json-invalid")
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	requireStatus(t, w, 415)
}
