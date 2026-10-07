package main

import (
	"context"
	"io/fs"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"pargar/backend/internal/api"
	"pargar/backend/internal/config"
	"pargar/backend/internal/db"
	"pargar/backend/internal/observability"
	"pargar/backend/internal/redisdb"
	"pargar/backend/internal/seed"
	"pargar/backend/internal/storage"
	"pargar/backend/internal/store"
)

func main() {
	observability.SetupJSONLogger()
	cfg := config.Load()
	if err := cfg.Validate(); err != nil {
		observability.L().Error("configuration", "error", err)
		os.Exit(1)
	}

	ctx := context.Background()

	otelShutdown, err := observability.SetupTracing(ctx, observability.Config{
		ServiceName:  cfg.OTELServiceName,
		OTLPEndpoint: cfg.OTELEndpoint,
	})
	if err != nil {
		observability.L().Error("otel setup", "error", err)
		os.Exit(1)
	}
	defer func() { _ = otelShutdown(context.Background()) }()

	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		observability.L().Error("database", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	sub, _ := fs.Sub(db.MigrationFiles, "migrations")
	if err := db.Migrate(ctx, pool, sub); err != nil {
		observability.L().Error("migrate", "error", err)
		os.Exit(1)
	}

	rdb, err := redisdb.Connect(ctx, cfg.RedisURL)
	if err != nil {
		observability.L().Error("redis", "error", err)
		os.Exit(1)
	}
	defer rdb.RDB().Close()

	st := store.New(pool)
	if err := seed.Run(ctx, st, cfg.SeedCurriculum); err != nil {
		observability.L().Error("seed", "error", err)
		os.Exit(1)
	}

	var stg storage.Storage
	if cfg.StorageDriver == "s3" {
		stg, err = storage.NewS3(ctx, cfg.StorageEndpoint, cfg.StorageRegion, cfg.StorageAccess, cfg.StorageSecret, cfg.StorageBucket, cfg.PublicURL)
		if err != nil {
			observability.L().Error("storage", "error", err)
			os.Exit(1)
		}
	} else {
		stg = storage.NewLocal(cfg.StorageDir, cfg.PublicURL)
	}
	if err := storage.EnsureSampleMP4(stg, storage.DefaultSampleCandidates()...); err != nil {
		observability.L().Warn("sample media", "error", err)
	}

	srv := api.NewServer(cfg, st, rdb.RDB(), stg)

	scheduler := api.NewScheduler(srv, st, cfg)
	go scheduler.Run()

	httpSrv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	go func() {
		observability.L().Info("pargar backend listening", "port", cfg.Port)
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			observability.L().Error("server", "error", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	scheduler.Stop()
	shutdownCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	_ = httpSrv.Shutdown(shutdownCtx)
	observability.L().Info("shutdown complete")
}
