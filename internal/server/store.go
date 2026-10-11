package server

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite"
)

// Artifact describes the current content revision, separate from interaction state.
type Artifact struct {
	ID         string `json:"id"`
	Title      string `json:"title"`
	Kind       string `json:"kind"`
	Collection string `json:"collection"`
	Revision   int    `json:"revision"`
	CreatedAt  string `json:"created_at"`
	UpdatedAt  string `json:"updated_at"`
}

// Version is an immutable content snapshot.
type Version struct {
	Version   int    `json:"version"`
	Content   string `json:"content"`
	Note      string `json:"note"`
	CreatedAt string `json:"created_at"`
}

// Entry is an append-only record with an optional artifact association.
type Entry struct {
	ID         string  `json:"id"`
	ArtifactID *string `json:"artifact_id"`
	Message    string  `json:"message"`
	Agent      string  `json:"agent"`
	CreatedAt  string  `json:"created_at"`
}

// State holds mutable interaction data with an independent revision.
type State struct {
	Revision int             `json:"revision"`
	Data     json.RawMessage `json:"data"`
}
type scanner interface{ Scan(...any) error }

func scanArtifact(row scanner) (Artifact, error) {
	var a Artifact
	err := row.Scan(&a.ID, &a.Title, &a.Kind, &a.Collection, &a.Revision, &a.CreatedAt, &a.UpdatedAt)
	return a, err
}

func openDB(path string) (*sql.DB, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	absPath, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	uriPath := filepath.ToSlash(absPath)
	if !strings.HasPrefix(uriPath, "/") {
		uriPath = "/" + uriPath // Windows drive paths in file URIs.
	}
	uri := url.URL{Scheme: "file", Path: uriPath}
	// Connection-local pragmas must also apply if database/sql replaces a connection.
	uri.RawQuery = url.Values{"_pragma": {"foreign_keys(1)", "busy_timeout(5000)"}}.Encode()
	db, err := sql.Open("sqlite", uri.String())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	for _, stmt := range []string{"PRAGMA journal_mode=WAL"} {
		if _, err = db.Exec(stmt); err != nil {
			db.Close()
			return nil, err
		}
	}
	var version int
	if err = db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		db.Close()
		return nil, err
	}
	if version > 2 {
		db.Close()
		return nil, errors.New("database schema is newer than this application")
	}
	if version == 0 {
		tx, e := db.Begin()
		if e != nil {
			db.Close()
			return nil, e
		}
		_, err = tx.Exec(`
CREATE TABLE artifacts(id TEXT PRIMARY KEY,title TEXT NOT NULL,kind TEXT NOT NULL,collection TEXT NOT NULL,revision INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE versions(artifact_id TEXT NOT NULL REFERENCES artifacts(id),version INTEGER NOT NULL,content TEXT NOT NULL,note TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(artifact_id,version));
CREATE TABLE states(artifact_id TEXT PRIMARY KEY REFERENCES artifacts(id),revision INTEGER NOT NULL,data TEXT NOT NULL);
CREATE TABLE entries(id TEXT PRIMARY KEY,artifact_id TEXT REFERENCES artifacts(id),message TEXT NOT NULL,agent TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX entries_artifact ON entries(artifact_id,created_at);
CREATE INDEX artifacts_updated ON artifacts(updated_at);
CREATE TABLE requests(key TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,response TEXT NOT NULL);
PRAGMA user_version=1;`)
		if err != nil {
			tx.Rollback()
			db.Close()
			return nil, err
		}
		if err = tx.Commit(); err != nil {
			db.Close()
			return nil, err
		}
	}
	if version < 2 {
		_, err = db.Exec(`BEGIN; CREATE TABLE shares(token_hash TEXT PRIMARY KEY,artifact_id TEXT NOT NULL REFERENCES artifacts(id),version INTEGER NOT NULL,created_at TEXT NOT NULL); PRAGMA user_version=2; COMMIT;`)
		if err != nil {
			db.Close()
			return nil, err
		}
	}
	return db, nil
}
