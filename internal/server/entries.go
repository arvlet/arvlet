package server

import (
	"database/sql"
	"net/http"
	"strings"
)

func (s *Server) createEntry(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		ArtifactID *string `json:"artifact_id"`
		Message    string  `json:"message"`
		Agent      string  `json:"agent"`
	}
	if err := decode(w, r, &in); err != nil {
		return err
	}
	in.Message = strings.TrimSpace(in.Message)
	in.Agent = strings.TrimSpace(in.Agent)
	if in.Message == "" || len(in.Message) > 20000 || len(in.Agent) > 300 {
		return fail(422, "message required (max 20000 bytes); agent max 300 bytes")
	}
	if in.Agent == "" {
		in.Agent = "Human"
	}
	return s.write(w, r, in, 201, func(tx *sql.Tx) (any, error) {
		if in.ArtifactID != nil {
			if _, err := artifactIn(tx, *in.ArtifactID); err != nil {
				return nil, err
			}
		}
		e := Entry{id(), in.ArtifactID, in.Message, in.Agent, stamp()}
		_, err := tx.Exec("INSERT INTO entries VALUES (?,?,?,?,?)", e.ID, e.ArtifactID, e.Message, e.Agent, e.CreatedAt)
		return e, err
	})
}

func (s *Server) listEntries(w http.ResponseWriter, r *http.Request) error {
	limit, offset, err := pagination(r)
	if err != nil {
		return err
	}
	ident := r.URL.Query().Get("artifact_id")
	var total int
	if err = s.db.QueryRow("SELECT count(*) FROM entries WHERE (?='' OR artifact_id=?)", ident, ident).Scan(&total); err != nil {
		return err
	}
	rows, err := s.db.Query("SELECT * FROM entries WHERE (?='' OR artifact_id=?) ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?", ident, ident, limit, offset)
	if err != nil {
		return err
	}
	defer rows.Close()
	items := []Entry{}
	for rows.Next() {
		var e Entry
		if err = rows.Scan(&e.ID, &e.ArtifactID, &e.Message, &e.Agent, &e.CreatedAt); err != nil {
			return err
		}
		items = append(items, e)
	}
	if err = rows.Err(); err != nil {
		return err
	}
	respond(w, 200, map[string]any{"items": items, "total": total, "limit": limit, "offset": offset})
	return nil
}
