package api_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io/fs"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"pargar/backend/internal/api"
	"pargar/backend/internal/config"
	"pargar/backend/internal/db"
	"pargar/backend/internal/redisdb"
	"pargar/backend/internal/seed"
	"pargar/backend/internal/storage"
	"pargar/backend/internal/store"
)

var (
	adminURL      = testDatabaseURL("postgres")
	testURL       = testDatabaseURL("pargar_test")
	redisURL      = testRedisURL()
	integrationOK bool
)

func testRedisURL() string {
	if v := os.Getenv("REDIS_URL"); v != "" {
		return v
	}
	return "redis://localhost:6379"
}

func testDatabaseURL(database string) string {
	user := os.Getenv("POSTGRES_USER")
	if user == "" {
		user = "pargar"
	}
	password := os.Getenv("POSTGRES_PASSWORD")
	if password == "" {
		password = "pargar"
	}
	return "postgres://" + user + ":" + password + "@localhost:5432/" + database + "?sslmode=disable"
}

type testEnv struct {
	server *httptest.Server
	pool   *pgxpool.Pool
	rdb    *redis.Client
}

func TestMain(m *testing.M) {
	_ = os.Setenv("ADMIN_PASSWORD", "password123")
	// Local integration tests need captcha plaintext; production never sets this.
	_ = os.Setenv("CAPTCHA_EXPOSE_ANSWER", "true")
	_ = os.Setenv("DEV_MODE", "true")
	ctx := context.Background()
	root, err := pgxpool.New(ctx, adminURL)
	if err != nil {
		log.Printf("api integration tests disabled: %v", err)
		os.Exit(m.Run())
		return
	}
	_, _ = root.Exec(ctx, `DROP DATABASE IF EXISTS pargar_test`)
	if _, err := root.Exec(ctx, `CREATE DATABASE pargar_test`); err != nil {
		root.Close()
		log.Printf("api integration tests disabled: %v", err)
		os.Exit(m.Run())
		return
	}
	root.Close()
	integrationOK = true
	os.Exit(m.Run())
}

func setup(t *testing.T) *testEnv {
	t.Helper()
	if !integrationOK {
		t.Skip("postgres unavailable")
	}
	ctx := context.Background()
	pool, err := db.Connect(ctx, testURL)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	sub, _ := fs.Sub(db.MigrationFiles, "migrations")
	if err := db.Migrate(ctx, pool, sub); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	rdb, err := redisdb.Connect(ctx, redisURL)
	if err != nil {
		t.Fatalf("redis: %v", err)
	}
	if err := rdb.RDB().FlushDB(ctx).Err(); err != nil {
		t.Fatalf("flush redis: %v", err)
	}
	st := store.New(pool)
	if err := seed.Run(ctx, st, true); err != nil {
		t.Fatalf("seed: %v", err)
	}
	cfg := config.Load()
	srv := api.NewServer(cfg, st, rdb.RDB(), storage.NewLocal(t.TempDir(), "http://localhost:8080"))
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(func() {
		ts.Close()
		rdb.RDB().Close()
		_, _ = pool.Exec(ctx, `TRUNCATE users, lessons, chapters, mcq_questions, watch_heartbeats,
			watch_sessions, lesson_progress, quiz_attempts, xp_events, weekly_leaderboard, events,
			event_rsvps, challenges, challenge_progress, chat_messages, notifications, notification_prefs, video_assets,
			refresh_tokens, reminders_sent, certificates, certificate_physical_orders,
			unlock_requests, registration_ips, registration_invites, registration_phone_whitelist,
			registration_phone_blacklist, registration_blacklist_attempts, chat_export_tokens
			RESTART IDENTITY CASCADE`)
		_, _ = pool.Exec(ctx, `UPDATE app_settings SET value='false' WHERE key='registration_enabled'`)
		pool.Close()
	})
	return &testEnv{server: ts, pool: pool, rdb: rdb.RDB()}
}

func (e *testEnv) do(t *testing.T, method, path, token string, body any) (int, map[string]any) {
	t.Helper()
	return e.doHeaders(t, method, path, token, nil, body)
}

func (e *testEnv) doHeaders(t *testing.T, method, path, token string, headers map[string]string, body any) (int, map[string]any) {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req, _ := http.NewRequest(method, e.server.URL+path, &buf)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	defer resp.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out
}

const bootstrapAdminEmail = "admin@example.com"

// register creates a fresh student via the admin-only endpoint, then logs in.
func register(t *testing.T, e *testEnv, name, email string) (string, int64) {
	t.Helper()
	admin := login(t, e, bootstrapAdminEmail)
	username := strings.Split(email, "@")[0]
	code, body := e.do(t, "POST", "/api/admin/users", admin, map[string]any{
		"name": name, "email": email, "username": username, "password": "password123", "role": "student",
		"phone": "", "securityQuestion": "نام حیوان خانگی؟", "securityAnswer": "rex",
	})
	if code != http.StatusCreated {
		t.Fatalf("admin create user: %d %v", code, body)
	}
	uid := int64(body["user"].(map[string]any)["id"].(float64))
	token := login(t, e, email)
	return token, uid
}

func fetchCaptcha(t *testing.T, e *testEnv) (challengeID, answer string) {
	t.Helper()
	code, body := e.do(t, "GET", "/api/auth/captcha", "", nil)
	if code != http.StatusOK {
		t.Fatalf("captcha: %d %v", code, body)
	}
	id, _ := body["challengeId"].(string)
	img, _ := body["imageBase64"].(string)
	answer, _ = body["answer"].(string)
	if id == "" || img == "" || answer == "" {
		t.Fatalf("captcha missing fields: %v", body)
	}
	return id, answer
}

func loginBody(t *testing.T, e *testEnv, identity, password string) map[string]any {
	t.Helper()
	id, answer := fetchCaptcha(t, e)
	body := map[string]any{
		"password":      password,
		"challengeId":   id,
		"captchaAnswer": answer,
	}
	if strings.Contains(identity, "@") {
		body["email"] = identity
	} else {
		body["username"] = identity
	}
	return body
}

func login(t *testing.T, e *testEnv, email string) string {
	t.Helper()
	code, body := e.do(t, "POST", "/api/auth/login", "", loginBody(t, e, email, "password123"))
	if code != http.StatusOK {
		t.Fatalf("login %s: %d %v", email, code, body)
	}
	return body["accessToken"].(string)
}

func TestAuthRateLimit(t *testing.T) {
	e := setup(t)
	hitLimit := false
	for i := 0; i < 40; i++ {
		code, body := e.do(t, "POST", "/api/auth/login", "", loginBody(t, e, "missing@test.dev", "wrong"))
		if code == http.StatusTooManyRequests {
			if body["error"] != "تعداد تلاش‌ها بیش از حد مجاز است؛ کمی بعد دوباره تلاش کنید" {
				t.Fatalf("unexpected rate limit message: %v", body)
			}
			hitLimit = true
			break
		}
		if code != http.StatusUnauthorized {
			t.Fatalf("request %d expected unauthorized or rate limit, got %d %v", i+1, code, body)
		}
	}
	if !hitLimit {
		t.Fatal("expected adaptive rate limit after repeated failed logins")
	}
}

// watchToUnlock pumps heartbeats until the quiz unlocks.
// Wall-clock anti-cheat caps delta by real elapsed time, so each pulse first
// rewinds the session heartbeat timestamp (tests only).
func watchToUnlock(t *testing.T, e *testEnv, token string, lesson int64) {
	t.Helper()
	for i := 1; i <= 6; i++ {
		rewindWatchSession(t, e, token, lesson)
		code, body := e.do(t, "POST", "/api/lessons/"+itoa(lesson)+"/heartbeat", token,
			map[string]any{"position": float64(i * 9), "delta": 9, "seq": i})
		if code != http.StatusOK {
			t.Fatalf("heartbeat: %d %v", code, body)
		}
		if body["quizUnlocked"] == true {
			return
		}
	}
}

func rewindWatchSession(t *testing.T, e *testEnv, token string, lesson int64) {
	t.Helper()
	code, me := e.do(t, "GET", "/api/auth/me", token, nil)
	if code != http.StatusOK {
		t.Fatalf("auth/me for rewind: %d %v", code, me)
	}
	u, _ := me["user"].(map[string]any)
	id, _ := u["id"].(float64)
	if id < 1 {
		t.Fatalf("auth/me missing user id: %v", me)
	}
	_, err := e.pool.Exec(context.Background(), `
		INSERT INTO watch_sessions (user_id, lesson_id, started_at, last_heartbeat_at, last_position)
		VALUES ($1, $2, now() - interval '30 seconds', now() - interval '30 seconds', 0)
		ON CONFLICT (user_id, lesson_id) DO UPDATE
		SET last_heartbeat_at = now() - interval '30 seconds'`, int64(id), lesson)
	if err != nil {
		t.Fatalf("rewind session: %v", err)
	}
}

func itoa(v int64) string {
	if v == 0 {
		return "0"
	}
	neg := v < 0
	if neg {
		v = -v
	}
	var buf [20]byte
	i := len(buf)
	for v > 0 {
		i--
		buf[i] = byte('0' + v%10)
		v /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
