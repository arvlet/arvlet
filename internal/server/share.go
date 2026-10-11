package server

import (
	"crypto/sha256"
	"database/sql"
	_ "embed"
	"encoding/hex"
	"net/http"
	"strconv"
	"strings"
)

//go:embed share.js
var shareScript []byte

func shareHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// A share grants only access to one pinned HTML version and its mutable app data.
func (s *Server) createShare(w http.ResponseWriter, r *http.Request) error {
	return s.write(w, r, struct{}{}, 201, func(tx *sql.Tx) (any, error) {
		a, err := artifactIn(tx, r.PathValue("id"))
		if err != nil {
			return nil, err
		}
		if a.Kind != "html" {
			return nil, fail(422, "Only interactive HTML artifacts can be shared")
		}
		token := id() + id()
		_, err = tx.Exec("INSERT INTO shares VALUES (?,?,?,?)", shareHash(token), a.ID, a.Revision, stamp())
		return map[string]string{"path": "/s/" + token}, err
	})
}

func (s *Server) revokeShares(w http.ResponseWriter, r *http.Request) error {
	_, err := s.db.Exec("DELETE FROM shares WHERE artifact_id=?", r.PathValue("id"))
	if err != nil {
		return err
	}
	respond(w, 200, map[string]bool{"revoked": true})
	return nil
}

func (s *Server) shared(f endpoint) http.HandlerFunc {
	return wrap(func(w http.ResponseWriter, r *http.Request) error {
		token := r.PathValue("token")
		if len(token) != 64 {
			return fail(404, "Share not found or revoked")
		}
		var artifact string
		var version int
		err := s.db.QueryRow("SELECT artifact_id,version FROM shares WHERE token_hash=?", shareHash(token)).Scan(&artifact, &version)
		if err != nil {
			return check(err)
		}
		r.SetPathValue("id", artifact)
		r.SetPathValue("version", strconv.Itoa(version))
		// Share tokens are capabilities, never workspace authentication. No cookie fallback.
		if r.Method == "PUT" {
			if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
				return fail(415, "JSON required")
			}
			if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
				return fail(403, "Cross-site write rejected")
			}
			r.Header.Del("Idempotency-Key") // Keep public mutations out of the workspace retry namespace.
		}
		return f(w, r)
	})
}

func (s *Server) sharePage(w http.ResponseWriter, r *http.Request) error {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, err := w.Write([]byte(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Arvlet</title><style>html,body{margin:0;height:100%;background:#f7f8f4}iframe{display:block;width:100%;height:100%;border:0}#error{padding:24px;font:16px system-ui}</style><script src="/share.js" defer></script></head><body><div id="error" role="status"></div><iframe title="Shared artifact" sandbox="allow-scripts" hidden></iframe></body></html>`))
	return err
}
