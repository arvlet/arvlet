package server

import (
	"crypto/hmac"
	"crypto/sha256"
	_ "embed"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

//go:embed bridge.js
var previewBridge string
var channelPattern = regexp.MustCompile("^[a-zA-Z0-9-]{16,64}$")

type previewGrant struct {
	ID        string
	Version   string
	Channel   string
	Parent    string
	Origin    string
	ShareHash string
	Expires   int64
}

func (s *Server) previewSignature(value string) string {
	mac := hmac.New(sha256.New, []byte(s.cfg.SessionSecret))
	mac.Write([]byte("preview:" + value))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// preview issues a short-lived render-only capability. It never serves artifact HTML.
func (s *Server) preview(w http.ResponseWriter, r *http.Request) error {
	channel := r.URL.Query().Get("channel")
	if !channelPattern.MatchString(channel) {
		return fail(400, "Invalid preview channel")
	}
	var kind string
	if err := s.db.QueryRow("SELECT kind FROM artifacts JOIN versions ON artifacts.id=versions.artifact_id WHERE artifacts.id=? AND version=?", r.PathValue("id"), r.PathValue("version")).Scan(&kind); err != nil {
		return check(err)
	}
	if kind != "html" {
		return fail(400, "Only HTML artifacts have a preview")
	}
	parent, origin := s.cfg.Origin, s.cfg.PreviewOrigin
	hash := ""
	if token := r.PathValue("token"); token != "" {
		hash = shareHash(token)
		if r.Host != strings.TrimPrefix(strings.TrimPrefix(s.cfg.Origin, "https://"), "http://") {
			parent, origin = s.cfg.ShareOrigin, s.cfg.SharePreviewOrigin
		}
	}
	grant := previewGrant{r.PathValue("id"), r.PathValue("version"), channel, parent, origin, hash, time.Now().Add(15 * time.Minute).Unix()}
	raw, _ := json.Marshal(grant)
	value := base64.RawURLEncoding.EncodeToString(raw)
	respond(w, 200, map[string]string{"url": origin + "/preview/" + value + "." + s.previewSignature(value), "origin": origin})
	return nil
}

// PreviewHandler must run on a separate listener. No session, API or state routes exist here.
func (s *Server) PreviewHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /preview/{ticket}", wrap(s.renderPreview))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		mux.ServeHTTP(w, r)
	})
}

func (s *Server) renderPreview(w http.ResponseWriter, r *http.Request) error {
	value, sig, ok := strings.Cut(r.PathValue("ticket"), ".")
	if !ok || len(value) > 4096 || !equal(sig, s.previewSignature(value)) {
		return fail(403, "Invalid preview ticket")
	}
	raw, err := base64.RawURLEncoding.DecodeString(value)
	var grant previewGrant
	if err != nil || json.Unmarshal(raw, &grant) != nil || grant.Expires <= time.Now().Unix() {
		return fail(403, "Preview expired; reopen the artifact")
	}
	host := strings.TrimPrefix(strings.TrimPrefix(grant.Origin, "https://"), "http://")
	if r.Host != host {
		return fail(403, "Preview origin rejected")
	}
	if grant.ShareHash != "" {
		var version int
		if err := s.db.QueryRow("SELECT version FROM shares WHERE token_hash=? AND artifact_id=?", grant.ShareHash, grant.ID).Scan(&version); err != nil {
			return check(err)
		}
		if strconv.Itoa(version) != grant.Version {
			return fail(403, "Preview version rejected")
		}
	}
	var content string
	if err := s.db.QueryRow("SELECT content FROM versions WHERE artifact_id=? AND version=?", grant.ID, grant.Version).Scan(&content); err != nil {
		return check(err)
	}
	channel, _ := json.Marshal(grant.Channel)
	parent, _ := json.Marshal(grant.Parent)
	bridge := strings.Replace(previewBridge, "__ARVLET_CHANNEL__", string(channel), 1)
	bridge = strings.Replace(bridge, "__ARVLET_PARENT__", string(parent), 1)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Security-Policy", "sandbox allow-scripts allow-same-origin; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors "+grant.Parent)
	w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), document-domain=()")
	_, err = w.Write([]byte("<!doctype html><script>" + bridge + "</script>" + content))
	return err
}
