package server

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

func (s *Server) getState(w http.ResponseWriter, r *http.Request) error {
	var exists int
	if err := s.db.QueryRow("SELECT 1 FROM artifacts WHERE id=?", r.PathValue("id")).Scan(&exists); err != nil {
		return check(err)
	}
	state := State{0, json.RawMessage(`{}`)}
	var data string
	err := s.db.QueryRow("SELECT revision,data FROM states WHERE artifact_id=?", r.PathValue("id")).Scan(&state.Revision, &data)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if err == nil {
		state.Data = json.RawMessage(data)
	}
	respond(w, 200, state)
	return nil
}

func (s *Server) putState(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		Revision *int            `json:"revision"`
		Data     json.RawMessage `json:"data"`
	}
	if err := decode(w, r, &in); err != nil {
		return err
	}
	raw := strings.TrimSpace(string(in.Data))
	if in.Revision == nil || *in.Revision < 0 || len(raw) == 0 || (raw[0] != '{' && raw[0] != '[') {
		return fail(422, "data must be an object or array; revision is required and must be nonnegative")
	}
	if len(raw) > 200000 {
		return fail(413, "State exceeds 200 KB")
	}
	return s.write(w, r, in, 200, func(tx *sql.Tx) (any, error) {
		if _, err := artifactIn(tx, r.PathValue("id")); err != nil {
			return nil, err
		}
		current := 0
		err := tx.QueryRow("SELECT revision FROM states WHERE artifact_id=?", r.PathValue("id")).Scan(&current)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
		if err = revision(current, *in.Revision); err != nil {
			return nil, err
		}
		saved := State{Revision: current + 1, Data: in.Data}
		_, err = tx.Exec("INSERT INTO states VALUES (?,?,?) ON CONFLICT(artifact_id) DO UPDATE SET revision=excluded.revision,data=excluded.data", r.PathValue("id"), saved.Revision, raw)
		return saved, err
	})
}
