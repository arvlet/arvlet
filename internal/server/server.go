package server

import (
	"database/sql"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// Config supplies all deployment settings without reading process-global environment.
type Config struct {
	DBPath             string
	APIKey             string
	Password           string
	SessionSecret      string
	Origin             string
	PreviewOrigin      string
	ShareOrigin        string
	SharePreviewOrigin string
	Assets             http.FileSystem
}

// Server owns a single-workspace database and its HTTP handlers.
type Server struct {
	db       *sql.DB
	cfg      Config
	mu       sync.Mutex
	loginMu  sync.Mutex
	attempts []time.Time
}

// New validates configuration and applies storage migrations before serving requests.
func New(cfg Config) (*Server, error) {
	if cfg.PreviewOrigin == "" {
		cfg.PreviewOrigin = "http://localhost:3092"
	}
	if cfg.ShareOrigin == "" {
		cfg.ShareOrigin = "http://localhost:3091"
	}
	if cfg.SharePreviewOrigin == "" {
		cfg.SharePreviewOrigin = cfg.PreviewOrigin
	}
	for _, origin := range []string{cfg.PreviewOrigin, cfg.ShareOrigin, cfg.SharePreviewOrigin} {
		u, err := url.Parse(origin)
		if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
			return nil, errors.New("invalid preview or share origin")
		}
	}
	for _, origin := range []string{cfg.PreviewOrigin, cfg.SharePreviewOrigin} {
		if sameOrigin(origin, cfg.Origin) || sameOrigin(origin, cfg.ShareOrigin) {
			return nil, errors.New("preview must use a different origin from workbench and shares")
		}
	}
	for _, v := range []string{cfg.APIKey, cfg.Password, cfg.SessionSecret} {
		if len(v) < 24 {
			return nil, errors.New("API key, password and session secret must each contain at least 24 characters")
		}
	}
	u, err := url.Parse(cfg.Origin)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
		return nil, errors.New("origin must be an http(s) origin without a trailing slash")
	}
	db, err := openDB(cfg.DBPath)
	if err != nil {
		return nil, err
	}
	return &Server{db: db, cfg: cfg}, nil
}

func sameOrigin(a, b string) bool {
	x, err := url.Parse(a)
	if err != nil {
		return false
	}
	y, err := url.Parse(b)
	if err != nil {
		return false
	}
	port := func(u *url.URL) string {
		if u.Port() != "" {
			return u.Port()
		}
		if u.Scheme == "https" {
			return "443"
		}
		return "80"
	}
	return strings.EqualFold(x.Scheme, y.Scheme) && strings.EqualFold(x.Hostname(), y.Hostname()) && port(x) == port(y)
}

// Close releases the database after HTTP requests have drained.
func (s *Server) Close() error { return s.db.Close() }

// Handler returns the API, authenticated preview routes and embedded workbench.
func (s *Server) Handler() http.Handler {
	m := http.NewServeMux()
	m.HandleFunc("GET /health", wrap(func(w http.ResponseWriter, r *http.Request) error {
		if err := s.db.PingContext(r.Context()); err != nil {
			return err
		}
		respond(w, 200, map[string]string{"status": "ok"})
		return nil
	}))
	m.HandleFunc("POST /api/session", wrap(s.login))
	m.HandleFunc("DELETE /api/session", s.protected(func(w http.ResponseWriter, r *http.Request) error {
		http.SetCookie(w, &http.Cookie{Name: "arvlet_session", Path: "/", Value: "", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteStrictMode})
		respond(w, 200, map[string]bool{"authenticated": false})
		return nil
	}))
	m.HandleFunc("GET /api/v1/me", s.protected(func(w http.ResponseWriter, r *http.Request) error {
		respond(w, 200, map[string]string{"version": "0.1.0"})
		return nil
	}))
	m.HandleFunc("GET /api/v1/artifacts", s.protected(s.listArtifacts))
	m.HandleFunc("POST /api/v1/artifacts", s.protected(s.createArtifact))
	m.HandleFunc("GET /api/v1/artifacts/{id}", s.protected(s.getArtifact))
	m.HandleFunc("GET /api/v1/artifacts/{id}/versions/{version}", s.protected(s.getVersion))
	m.HandleFunc("POST /api/v1/artifacts/{id}/versions", s.protected(s.createVersion))
	m.HandleFunc("GET /api/v1/artifacts/{id}/state", s.protected(s.getState))
	m.HandleFunc("PUT /api/v1/artifacts/{id}/state", s.protected(s.putState))
	m.HandleFunc("GET /api/v1/entries", s.protected(s.listEntries))
	m.HandleFunc("POST /api/v1/entries", s.protected(s.createEntry))
	m.HandleFunc("GET /api/v1/export", s.protected(s.export))
	m.HandleFunc("GET /preview/{id}/{version}", s.protected(s.preview))
	m.HandleFunc("POST /api/v1/artifacts/{id}/shares", s.protected(s.createShare))
	m.HandleFunc("DELETE /api/v1/artifacts/{id}/shares", s.protected(s.revokeShares))
	m.HandleFunc("GET /s/{token}", s.shared(s.sharePage))
	m.HandleFunc("GET /s/{token}/preview", s.shared(s.preview))
	m.HandleFunc("GET /s/{token}/state", s.shared(s.getState))
	m.HandleFunc("PUT /s/{token}/state", s.shared(s.putState))
	m.HandleFunc("GET /share.js", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
		w.Write(shareScript)
	})
	m.HandleFunc("GET /api/openapi.json", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write(openAPI)
	})
	m.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		respond(w, 404, map[string]string{"error": "Unknown endpoint"})
	})
	if s.cfg.Assets != nil {
		files := http.FileServer(s.cfg.Assets)
		m.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodGet && r.Method != http.MethodHead {
				w.Header().Set("Allow", "GET, HEAD")
				respond(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
				return
			}
			files.ServeHTTP(w, r)
		})
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src "+s.cfg.PreviewOrigin+" "+s.cfg.SharePreviewOrigin+"; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
		m.ServeHTTP(w, r)
	})
}
