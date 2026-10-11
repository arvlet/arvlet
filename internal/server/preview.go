package server

import (
	_ "embed"
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
)

//go:embed bridge.js
var previewBridge string

var channelPattern = regexp.MustCompile(`^[a-zA-Z0-9-]{16,64}$`)

func (s *Server) preview(w http.ResponseWriter, r *http.Request) error {
	channel := r.URL.Query().Get("channel")
	if !channelPattern.MatchString(channel) {
		return fail(400, "Invalid preview channel")
	}
	var content, kind string
	err := s.db.QueryRow("SELECT content,kind FROM versions JOIN artifacts ON artifacts.id=versions.artifact_id WHERE artifact_id=? AND version=?", r.PathValue("id"), r.PathValue("version")).Scan(&content, &kind)
	if err != nil {
		return check(err)
	}
	if kind != "html" {
		return fail(400, "Only HTML artifacts run in the sandbox")
	}
	encoded, _ := json.Marshal(channel)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Security-Policy", "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'")
	// The opaque iframe receives no credentials. The host grants only this artifact's state capability.
	bridge := strings.Replace(previewBridge, "__ARVLET_CHANNEL__", string(encoded), 1)
	_, err = w.Write([]byte("<!doctype html><script>" + bridge + "</script>" + content))
	return err
}
