package server

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
)

type artifactInput struct {
	Title      string `json:"title"`
	Kind       string `json:"kind"`
	Collection string `json:"collection"`
	Content    string `json:"content"`
	Note       string `json:"note"`
}
type versionInput struct {
	Revision int     `json:"revision"`
	Content  *string `json:"content"`
	Note     string  `json:"note"`
}

func validateContent(kind, content string) error {
	if len(content) > 1000000 {
		return fail(413, "Content exceeds 1 MB")
	}
	switch kind {
	case "html", "markdown":
	case "json":
		if !json.Valid([]byte(content)) {
			return fail(422, "Invalid JSON artifact")
		}
	default:
		return fail(422, "kind must be html, markdown or json")
	}
	return nil
}

func artifactIn(tx *sql.Tx, ident string) (Artifact, error) {
	a, err := scanArtifact(tx.QueryRow("SELECT * FROM artifacts WHERE id=?", ident))
	return a, check(err)
}

func (s *Server) createArtifact(w http.ResponseWriter, r *http.Request) error {
	var in artifactInput
	if err := decode(w, r, &in); err != nil {
		return err
	}
	in.Title = strings.TrimSpace(in.Title)
	in.Collection = strings.TrimSpace(in.Collection)
	if in.Title == "" || len(in.Title) > 600 || len(in.Collection) > 300 || len(in.Note) > 3000 {
		return fail(422, "Title is required (max 600 bytes); collection max 300, note max 3000 bytes")
	}
	if err := validateContent(in.Kind, in.Content); err != nil {
		return err
	}
	return s.write(w, r, in, 201, func(tx *sql.Tx) (any, error) {
		a := Artifact{id(), in.Title, in.Kind, in.Collection, 1, stamp(), stamp()}
		if _, err := tx.Exec("INSERT INTO artifacts VALUES (?,?,?,?,?,?,?)", a.ID, a.Title, a.Kind, a.Collection, a.Revision, a.CreatedAt, a.UpdatedAt); err != nil {
			return nil, err
		}
		_, err := tx.Exec("INSERT INTO versions VALUES (?,?,?,?,?)", a.ID, 1, in.Content, in.Note, a.CreatedAt)
		return a, err
	})
}

func (s *Server) listArtifacts(w http.ResponseWriter, r *http.Request) error {
	limit, offset, err := pagination(r)
	if err != nil {
		return err
	}
	q := r.URL.Query()
	where := " WHERE (?='' OR instr(lower(title),lower(?))>0) AND (?='' OR collection=?) AND (?='' OR kind=?)"
	args := []any{q.Get("q"), q.Get("q"), q.Get("collection"), q.Get("collection"), q.Get("kind"), q.Get("kind")}
	var total int
	if err = s.db.QueryRow("SELECT count(*) FROM artifacts"+where, args...).Scan(&total); err != nil {
		return err
	}
	rows, err := s.db.Query("SELECT * FROM artifacts"+where+" ORDER BY updated_at DESC,id DESC LIMIT ? OFFSET ?", append(args, limit, offset)...)
	if err != nil {
		return err
	}
	defer rows.Close()
	items := []Artifact{}
	for rows.Next() {
		a, e := scanArtifact(rows)
		if e != nil {
			return e
		}
		items = append(items, a)
	}
	if err = rows.Err(); err != nil {
		return err
	}
	respond(w, 200, map[string]any{"items": items, "total": total, "limit": limit, "offset": offset})
	return nil
}

func (s *Server) getArtifact(w http.ResponseWriter, r *http.Request) error {
	// A read transaction keeps metadata and history consistent during concurrent writes.
	tx, err := s.db.BeginTx(r.Context(), &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return err
	}
	defer tx.Rollback()
	a, err := artifactIn(tx, r.PathValue("id"))
	if err != nil {
		return err
	}
	rows, err := tx.Query("SELECT version,note,created_at FROM versions WHERE artifact_id=? ORDER BY version DESC", a.ID)
	if err != nil {
		return err
	}
	versions := []map[string]any{}
	for rows.Next() {
		var v int
		var note, created string
		if err = rows.Scan(&v, &note, &created); err != nil {
			rows.Close()
			return err
		}
		versions = append(versions, map[string]any{"version": v, "note": note, "created_at": created})
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	var content string
	if err = tx.QueryRow("SELECT content FROM versions WHERE artifact_id=? AND version=?", a.ID, a.Revision).Scan(&content); err != nil {
		return err
	}
	// Release the single connection before a slow client starts reading the response.
	if err = tx.Commit(); err != nil {
		return err
	}
	respond(w, 200, struct {
		Artifact
		Content  string           `json:"content"`
		Versions []map[string]any `json:"versions"`
	}{a, content, versions})
	return nil
}

func (s *Server) getVersion(w http.ResponseWriter, r *http.Request) error {
	var v Version
	err := s.db.QueryRow("SELECT version,content,note,created_at FROM versions WHERE artifact_id=? AND version=?", r.PathValue("id"), r.PathValue("version")).Scan(&v.Version, &v.Content, &v.Note, &v.CreatedAt)
	if err != nil {
		return check(err)
	}
	respond(w, 200, v)
	return nil
}

func (s *Server) createVersion(w http.ResponseWriter, r *http.Request) error {
	var in versionInput
	if err := decode(w, r, &in); err != nil {
		return err
	}
	if in.Revision < 1 || in.Content == nil || len(in.Note) > 3000 {
		return fail(422, "revision must be positive, content is required; note max 3000 bytes")
	}
	return s.write(w, r, in, 201, func(tx *sql.Tx) (any, error) {
		a, err := artifactIn(tx, r.PathValue("id"))
		if err != nil {
			return nil, err
		}
		if err = revision(a.Revision, in.Revision); err != nil {
			return nil, err
		}
		if err = validateContent(a.Kind, *in.Content); err != nil {
			return nil, err
		}
		a.Revision++
		a.UpdatedAt = stamp()
		if _, err = tx.Exec("INSERT INTO versions VALUES (?,?,?,?,?)", a.ID, a.Revision, *in.Content, in.Note, a.UpdatedAt); err != nil {
			return nil, err
		}
		_, err = tx.Exec("UPDATE artifacts SET revision=?,updated_at=? WHERE id=?", a.Revision, a.UpdatedAt, a.ID)
		return a, err
	})
}
