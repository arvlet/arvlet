package server

import (
	"encoding/base64"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestPreviewListenerDoesNotExposeWorkspace(t *testing.T) {
	s := newTestServer(t)
	for _, path := range []string{"/api/v1/artifacts", "/api/v1/export", "/api/session", "/s/anything/state", "/"} {
		r := httptest.NewRequest("GET", "http://localhost:3092"+path, nil)
		r.Header.Set("Authorization", "Bearer "+testSecret)
		w := httptest.NewRecorder()
		s.PreviewHandler().ServeHTTP(w, r)
		requireStatus(t, w, 404)
	}
	a := createTestArtifact(t, s)
	w := request(s, "GET", "/preview/"+a.ID+"/1?channel=0123456789abcdef", "", "")
	var config struct {
		URL string `json:"url"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &config); err != nil {
		t.Fatal(err)
	}
	for _, url := range []string{config.URL + "tampered", strings.Replace(config.URL, "localhost:3092", "localhost:3090", 1)} {
		w = httptest.NewRecorder()
		s.PreviewHandler().ServeHTTP(w, httptest.NewRequest("GET", url, nil))
		requireStatus(t, w, 403)
	}
	grant := previewGrant{ID: a.ID, Version: "1", Channel: "0123456789abcdef", Parent: s.cfg.Origin, Origin: s.cfg.PreviewOrigin, Expires: time.Now().Add(-time.Minute).Unix()}
	raw, _ := json.Marshal(grant)
	value := base64.RawURLEncoding.EncodeToString(raw)
	w = httptest.NewRecorder()
	s.PreviewHandler().ServeHTTP(w, httptest.NewRequest("GET", s.cfg.PreviewOrigin+"/preview/"+value+"."+s.previewSignature(value), nil))
	requireStatus(t, w, 403)
}

func TestPreviewRejectsWorkbenchOrigin(t *testing.T) {
	_, err := New(Config{Origin: "http://localhost:3090", PreviewOrigin: "http://localhost:3090", APIKey: testSecret, Password: testSecret, SessionSecret: testSecret})
	if err == nil {
		t.Fatal("same-origin preview configuration accepted")
	}
}
