package server

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"strconv"
)

type problem struct {
	Status  int
	Message string
}

func (e problem) Error() string         { return e.Message }
func fail(status int, msg string) error { return problem{status, msg} }
func check(err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return fail(404, "Not found")
	}
	return err
}

func respond(w http.ResponseWriter, status int, data any) {
	body, err := json.Marshal(data)
	if err != nil {
		slog.Error("encode response", "error", err)
		status = http.StatusInternalServerError
		body = []byte(`{"error":"Internal server error"}`)
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if _, err := w.Write(append(body, '\n')); err != nil {
		slog.Debug("write response", "error", err)
	}
}

func errorResponse(w http.ResponseWriter, err error) {
	var p problem
	if errors.As(err, &p) {
		respond(w, p.Status, map[string]string{"error": p.Message})
		return
	}
	slog.Error("request failed", "error", err)
	respond(w, 500, map[string]string{"error": "Internal server error"})
}

type endpoint func(http.ResponseWriter, *http.Request) error

func wrap(f endpoint) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := f(w, r); err != nil {
			errorResponse(w, err)
		}
	}
}

func decode(w http.ResponseWriter, r *http.Request, v any) error {
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		return fail(415, "Content-Type must be application/json")
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1500000)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		var limit *http.MaxBytesError
		if errors.As(err, &limit) {
			return fail(413, "Request exceeds 1.5 MB")
		}
		return fail(400, "Invalid JSON: "+err.Error())
	}
	if err := dec.Decode(new(any)); err != io.EOF {
		return fail(400, "Expected one JSON value")
	}
	return nil
}

func revision(current, expected int) error {
	if current != expected {
		return fail(409, fmt.Sprintf("Revision conflict: expected %d, current %d. Reload before retrying.", expected, current))
	}
	return nil
}

func pagination(r *http.Request) (int, int, error) {
	limit, offset := 50, 0
	var err error
	if v := r.URL.Query().Get("limit"); v != "" {
		limit, err = strconv.Atoi(v)
		if err != nil || limit < 1 || limit > 200 {
			return 0, 0, fail(400, "limit must be 1..200")
		}
	}
	if v := r.URL.Query().Get("offset"); v != "" {
		offset, err = strconv.Atoi(v)
		if err != nil || offset < 0 {
			return 0, 0, fail(400, "offset must be nonnegative")
		}
	}
	return limit, offset, nil
}
