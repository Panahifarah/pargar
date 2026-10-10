package db

import (
	"context"
	"fmt"
	"io/fs"
	"os"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestMigrateFromV013Schema(t *testing.T) {
	user := os.Getenv("POSTGRES_USER")
	password := os.Getenv("POSTGRES_PASSWORD")
	if user == "" || password == "" {
		t.Skip("postgres env not set")
	}
	host := "127.0.0.1"
	port := "5432"
	adminURL := fmt.Sprintf("postgres://%s:%s@%s:%s/postgres?sslmode=disable", user, password, host, port)
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, adminURL)
	if err != nil {
		t.Skipf("postgres unavailable: %v", err)
	}
	defer admin.Close()
	if err := admin.Ping(ctx); err != nil {
		t.Skipf("postgres unavailable: %v", err)
	}

	const name = "pargar_upgrade_test"
	_, _ = admin.Exec(ctx, `DROP DATABASE IF EXISTS `+name+` WITH (FORCE)`)
	if _, err := admin.Exec(ctx, `CREATE DATABASE `+name); err != nil {
		t.Fatalf("create database: %v", err)
	}
	t.Cleanup(func() {
		_, _ = admin.Exec(context.Background(), `DROP DATABASE IF EXISTS `+name+` WITH (FORCE)`)
	})

	url := fmt.Sprintf("postgres://%s:%s@%s:%s/%s?sslmode=disable", user, password, host, port, name)
	pool, err := Connect(ctx, url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer pool.Close()

	sub, err := fs.Sub(MigrationFiles, "migrations")
	if err != nil {
		t.Fatal(err)
	}
	legacy := fstest.MapFS{}
	entries, err := fs.ReadDir(sub, ".")
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") || entry.Name() >= "0023" {
			continue
		}
		body, err := fs.ReadFile(sub, entry.Name())
		if err != nil {
			t.Fatal(err)
		}
		legacy[entry.Name()] = &fstest.MapFile{Data: body}
	}
	if len(legacy) == 0 {
		t.Fatal("no v0.1.3 migrations")
	}
	if err := Migrate(ctx, pool, legacy); err != nil {
		t.Fatalf("migrate through 0022: %v", err)
	}

	if _, err := pool.Exec(ctx, `
		INSERT INTO users (name, email, username, password_hash, role, hearts)
		VALUES ('legacy', 'legacy@example.com', 'legacy', 'x', 'student', 3)`); err != nil {
		t.Fatalf("seed hearts=3: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO users (name, email, username, password_hash, role, hearts)
		VALUES ('over', 'over@example.com', 'over', 'x', 'student', 5)`); err == nil {
		t.Fatal("hearts=5 was accepted on the v0.1.3 constraint")
	}

	if err := Migrate(ctx, pool, sub); err != nil {
		t.Fatalf("upgrade 0023-0028: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO users (name, email, username, password_hash, role, hearts)
		VALUES ('over', 'over@example.com', 'over', 'x', 'student', 5)`); err != nil {
		t.Fatalf("hearts=5 after upgrade: %v", err)
	}

	var hearts int
	var locked bool
	if err := pool.QueryRow(ctx, `SELECT hearts, is_locked FROM users WHERE email='legacy@example.com'`).Scan(&hearts, &locked); err != nil {
		t.Fatal(err)
	}
	if hearts != 3 || locked {
		t.Fatalf("legacy account changed: hearts=%d locked=%v", hearts, locked)
	}

	var constraint string
	if err := pool.QueryRow(ctx, `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='users_hearts_max'`).Scan(&constraint); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(constraint, "5") {
		t.Fatalf("hearts constraint: %s", constraint)
	}

	var labels string
	if err := pool.QueryRow(ctx, `
		SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder)
		FROM pg_enum e
		JOIN pg_type t ON t.oid = e.enumtypid
		WHERE t.typname = 'notif_category'`).Scan(&labels); err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"urgent", "curriculum", "community", "system"} {
		if !strings.Contains(labels, want) {
			t.Fatalf("enum %s missing from %s", want, labels)
		}
	}

	var cols int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM information_schema.columns
		WHERE table_name='users' AND column_name IN ('last_seen_at','username_change_count','frozen_at','closed_at')`).Scan(&cols); err != nil {
		t.Fatal(err)
	}
	if cols != 4 {
		t.Fatalf("user columns: %d", cols)
	}
	var attachments bool
	if err := pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM information_schema.columns
			WHERE table_name='chat_messages' AND column_name='attachments'
		)`).Scan(&attachments); err != nil {
		t.Fatal(err)
	}
	if !attachments {
		t.Fatal("chat attachments column missing")
	}
	var botCols int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM information_schema.columns
		WHERE table_name='bot_tokens' AND column_name IN ('request_count','revoked_at')`).Scan(&botCols); err != nil {
		t.Fatal(err)
	}
	if botCols != 2 {
		t.Fatalf("bot token columns: %d", botCols)
	}

	var before int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM schema_migrations`).Scan(&before); err != nil {
		t.Fatal(err)
	}
	if err := Migrate(ctx, pool, sub); err != nil {
		t.Fatalf("second migrate: %v", err)
	}
	var after int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM schema_migrations`).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if before != after {
		t.Fatalf("repeat migrate wrote rows: %d -> %d", before, after)
	}

	lockCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	var wg sync.WaitGroup
	errCh := make(chan error, 2)
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errCh <- Migrate(lockCtx, pool, sub)
		}()
	}
	wg.Wait()
	close(errCh)
	for err := range errCh {
		if err != nil {
			t.Fatalf("parallel migrate: %v", err)
		}
	}
}
