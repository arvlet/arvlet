package server

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestShareScopePersistenceAndRevocation(t *testing.T) {
	s := newTestServer(t)
	a := createTestArtifact(t, s)
	created := request(s, "POST", "/api/v1/artifacts/"+a.ID+"/shares", "{}", "")
	requireStatus(t, created, 201)
	var link struct {
		Path string `json:"path"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &link); err != nil {
		t.Fatal(err)
	}
	public := func(method, path, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, r)
		return w
	}
	requireStatus(t, public("GET", link.Path, ""), 200)
	requireStatus(t, public("GET", "/api/v1/artifacts/"+a.ID, ""), 401)
	requireStatus(t, public("GET", "/s/"+strings.Repeat("0", 64), ""), 404)
	for _, tc := range []struct {
		contentType string
		site        string
		status      int
	}{{"text/plain", "same-origin", 415}, {"application/json", "cross-site", 403}} {
		r := httptest.NewRequest("PUT", link.Path+"/state", strings.NewReader(`{"revision":0,"data":{}}`))
		r.Header.Set("Content-Type", tc.contentType)
		r.Header.Set("Sec-Fetch-Site", tc.site)
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, r)
		requireStatus(t, w, tc.status)
	}
	requireStatus(t, public("PUT", link.Path+"/state", `{"revision":0,"data":{"value":42}}`), 200)
	requireStatus(t, public("PUT", link.Path+"/state", `{"revision":0,"data":{}}`), 409)
	saved := request(s, "GET", "/api/v1/artifacts/"+a.ID+"/state", "", "")
	if !strings.Contains(saved.Body.String(), `"value":42`) {
		t.Fatal("share write did not persist to artifact")
	}
	requireStatus(t, request(s, "POST", "/api/v1/artifacts/"+a.ID+"/versions", `{"revision":1,"content":"new code"}`, ""), 201)
	preview := public("GET", link.Path+"/preview?channel=abcdefghijklmnop", "")
	requireStatus(t, preview, 200)
	if !strings.Contains(preview.Body.String(), "Version one") {
		t.Fatal("share should pin published code")
	}
	requireStatus(t, request(s, "DELETE", "/api/v1/artifacts/"+a.ID+"/shares", "", ""), 200)
	requireStatus(t, public("GET", link.Path, ""), 404)
	requireStatus(t, public("PUT", link.Path+"/state", `{"revision":1,"data":{}}`), 404)
}
