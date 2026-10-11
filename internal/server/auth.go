package server

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"net/http"
	"strconv"
	"strings"
	"time"
)

func equal(a, b string) bool {
	x, y := sha256.Sum256([]byte(a)), sha256.Sum256([]byte(b))
	return subtle.ConstantTimeCompare(x[:], y[:]) == 1
}

func (s *Server) signature(value string) string {
	m := hmac.New(sha256.New, []byte(s.cfg.SessionSecret+s.cfg.Password))
	m.Write([]byte(value))
	return base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}

func (s *Server) authenticated(r *http.Request) bool {
	if token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer "); ok {
		return equal(token, s.cfg.APIKey)
	}
	c, err := r.Cookie("arvlet_session")
	if err != nil {
		return false
	}
	value, sig, ok := strings.Cut(c.Value, ".")
	if !ok || !equal(sig, s.signature(value)) {
		return false
	}
	expiry, err := strconv.ParseInt(value, 10, 64)
	return err == nil && time.Now().Unix() < expiry
}

func (s *Server) protected(f endpoint) http.HandlerFunc {
	return wrap(func(w http.ResponseWriter, r *http.Request) error {
		if !s.authenticated(r) {
			return fail(401, "Authentication required")
		}
		if r.Method != "GET" && r.Method != "HEAD" && !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") && r.Header.Get("Origin") != s.cfg.Origin {
			return fail(403, "Origin rejected")
		}
		return f(w, r)
	})
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) error {
	if origin := r.Header.Get("Origin"); origin != "" && origin != s.cfg.Origin {
		return fail(403, "Origin rejected")
	}
	var body struct {
		Password string `json:"password"`
	}
	if err := decode(w, r, &body); err != nil {
		return err
	}
	s.loginMu.Lock()
	recent := s.attempts[:0]
	for _, t := range s.attempts {
		if time.Since(t) < time.Minute {
			recent = append(recent, t)
		}
	}
	s.attempts = recent
	if len(recent) >= 20 {
		s.loginMu.Unlock()
		return fail(429, "Too many login attempts; retry in one minute")
	}
	s.attempts = append(s.attempts, time.Now())
	s.loginMu.Unlock()
	if !equal(body.Password, s.cfg.Password) {
		return fail(401, "Incorrect password")
	}
	value := strconv.FormatInt(time.Now().Add(24*time.Hour).Unix(), 10)
	http.SetCookie(w, &http.Cookie{Name: "arvlet_session", Value: value + "." + s.signature(value), Path: "/", HttpOnly: true, Secure: strings.HasPrefix(s.cfg.Origin, "https:"), SameSite: http.SameSiteStrictMode, MaxAge: 86400})
	respond(w, 200, map[string]bool{"authenticated": true})
	return nil
}
