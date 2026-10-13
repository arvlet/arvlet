package main

import (
	"context"
	"embed"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/arvlet/arvlet/internal/server"
)

//go:embed web/dist
var assets embed.FS

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func main() {
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		client := http.Client{Timeout: 3 * time.Second}
		r, e := client.Get("http://127.0.0.1:8090/health")
		if e != nil {
			os.Exit(1)
		}
		defer r.Body.Close()
		if r.StatusCode != 200 {
			os.Exit(1)
		}
		return
	}
	files, err := fs.Sub(assets, "web/dist")
	if err != nil {
		slog.Error("assets", "error", err)
		os.Exit(1)
	}
	app, err := server.New(server.Config{
		DBPath:             env("ARVLET_DB", "data/arvlet.db"),
		APIKey:             os.Getenv("ARVLET_API_KEY"),
		Password:           os.Getenv("ARVLET_PASSWORD"),
		SessionSecret:      os.Getenv("ARVLET_SESSION_SECRET"),
		Origin:             env("ARVLET_ORIGIN", "http://localhost:3090"),
		PreviewOrigin:      env("ARVLET_PREVIEW_ORIGIN", "http://localhost:3092"),
		ShareOrigin:        env("ARVLET_SHARE_ORIGIN", "http://localhost:3091"),
		SharePreviewOrigin: env("ARVLET_SHARE_PREVIEW_ORIGIN", "http://localhost:3092"),
		Assets:             http.FS(files),
	})
	if err != nil {
		slog.Error("startup failed", "error", err)
		os.Exit(1)
	}
	defer func() {
		if err := app.Close(); err != nil {
			slog.Error("close database", "error", err)
		}
	}()
	srv := &http.Server{
		Addr:              env("ARVLET_ADDR", ":8090"),
		Handler:           app.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       20 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16384,
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	previewSrv := &http.Server{
		Addr: env("ARVLET_PREVIEW_ADDR", ":8091"), Handler: app.PreviewHandler(),
		ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 20 * time.Second,
		WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16384,
	}
	defer stop()
	go func() {
		if err := previewSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("preview server failed", "error", err)
			stop()
		}
	}()
	drained := make(chan struct{})
	go func() {
		defer close(drained)
		<-ctx.Done()
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			slog.Error("graceful shutdown timed out", "error", err)
			if err := srv.Close(); err != nil {
				slog.Error("force close HTTP server", "error", err)
			}
		}
		if err := previewSrv.Shutdown(ctx); err != nil {
			previewSrv.Close()
		}
	}()
	slog.Info("Arvlet listening", "address", srv.Addr)
	if err = srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		slog.Error("server failed", "error", err)
		os.Exit(1)
	}
	// ListenAndServe returns as soon as shutdown starts; wait before closing SQLite.
	<-drained
}
