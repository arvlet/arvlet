package server

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

// write stores the mutation and its retry response in the same transaction.
// Commit before responding: a slow or disconnected client must not hold a DB lock.
func (s *Server) write(w http.ResponseWriter, r *http.Request, input any, status int, action func(*sql.Tx) (any, error)) error {
	reply, err := s.mutate(r, input, action)
	if err != nil {
		return err
	}
	respond(w, status, reply)
	return nil
}

func (s *Server) mutate(r *http.Request, input any, action func(*sql.Tx) (any, error)) (json.RawMessage, error) {
	key := r.Header.Get("Idempotency-Key")
	if len(key) > 200 || (key != "" && strings.TrimSpace(key) == "") {
		return nil, fail(400, "Invalid Idempotency-Key")
	}
	raw, err := json.Marshal(input)
	if err != nil {
		return nil, err
	}
	hash := sha256.Sum256(append([]byte(r.Method+r.URL.Path), raw...))
	fingerprint := hex.EncodeToString(hash[:])
	s.mu.Lock()
	defer s.mu.Unlock()
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if key != "" {
		var old, reply string
		err = tx.QueryRow("SELECT fingerprint,response FROM requests WHERE key=?", key).Scan(&old, &reply)
		if err == nil {
			if old != fingerprint {
				return nil, fail(409, "Idempotency key reused with different input")
			}
			return json.RawMessage(reply), nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
	}
	result, err := action(tx)
	if err != nil {
		return nil, err
	}
	reply, err := json.Marshal(result)
	if err != nil {
		return nil, err
	}
	if key != "" {
		if _, err = tx.Exec("INSERT INTO requests VALUES (?,?,?)", key, fingerprint, string(reply)); err != nil {
			return nil, err
		}
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return json.RawMessage(reply), nil
}
