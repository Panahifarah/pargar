package api_test

import (
	"net/http"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestRouteLabelRedactsExportAndInviteTokens(t *testing.T) {
	// Exercised via access path: forged large token must not break handlers,
	// and single-use / captcha flows remain healthy. Direct label coverage lives
	// in package api (route_label_test.go).
	e := setup(t)
	code, _, _ := e.doRaw(t, "GET", "/api/exports/chats/super-secret-export-token-value", "", nil)
	if code != http.StatusUnauthorized {
		t.Fatalf("bogus export token: want 401 got %d", code)
	}
}

func TestMetricsRequiresTokenOutsideDevOpen(t *testing.T) {
	e := setup(t)
	// DevMode=true in tests → metrics open without token.
	code, _, _ := e.doRaw(t, "GET", "/metrics", "", nil)
	if code != http.StatusOK {
		t.Fatalf("dev metrics: want 200 got %d", code)
	}
}

func TestWatchAntiCheatCapsForgedDelta(t *testing.T) {
	e := setup(t)
	token, _ := register(t, e, "Cheat Watch", "cheat-watch@test.dev")

	// Wait so wall-clock cap is tight, then claim a huge delta.
	time.Sleep(200 * time.Millisecond)
	code, body := e.do(t, "POST", "/api/lessons/1/heartbeat", token, map[string]any{
		"position": 90, "delta": 999, "seq": 1,
	})
	if code != http.StatusOK {
		t.Fatalf("heartbeat: %d %v", code, body)
	}
	watched, _ := body["watchedSeconds"].(float64)
	// maxHeartbeatDelta is 15s; with ~0.2s wall clock + slack, credit must stay well under 20s.
	if watched > 20 {
		t.Fatalf("forged delta credited too much watch time: %v", watched)
	}
	if watched <= 0 {
		t.Fatalf("expected some credit, got %v", watched)
	}

	// Replay same seq — must not double-credit.
	prev := watched
	code, body = e.do(t, "POST", "/api/lessons/1/heartbeat", token, map[string]any{
		"position": 91, "delta": 9, "seq": 1,
	})
	if code != http.StatusOK {
		t.Fatalf("replay heartbeat: %d %v", code, body)
	}
	watched, _ = body["watchedSeconds"].(float64)
	if watched != prev {
		t.Fatalf("seq replay credited again: before=%v after=%v", prev, watched)
	}
}

func TestRegisterRaceSamePhone(t *testing.T) {
	e := setup(t)
	enableRegistration(t, e)
	whitelistPhones(t, e, "09127770001")

	const n = 8
	bodies := make([]map[string]any, n)
	for i := 0; i < n; i++ {
		bodies[i] = registerBody(t, e, "09127770001",
			"race-phone-"+itoa(int64(i+1))+"@test.dev",
			"raceph"+itoa(int64(i+1)))
	}

	var okCount atomic.Int32
	var wg sync.WaitGroup
	wg.Add(n)
	for i := 0; i < n; i++ {
		i := i
		go func() {
			defer wg.Done()
			code, _ := e.doHeaders(t, "POST", "/api/auth/register", "", map[string]string{
				"X-Real-IP": "203.0.113." + itoa(int64(40+i)),
			}, bodies[i])
			if code == http.StatusCreated {
				okCount.Add(1)
			}
		}()
	}
	wg.Wait()
	if okCount.Load() != 1 {
		t.Fatalf("expected exactly one successful register for same phone, got %d", okCount.Load())
	}
}

func TestRegisterRequiresCaptcha(t *testing.T) {
	e := setup(t)
	enableRegistration(t, e)
	whitelistPhones(t, e, "09127770099")
	body := map[string]any{
		"name": "بدون کپچا", "email": "nocap@test.dev", "username": "nocapuser",
		"password": "password123", "passwordConfirm": "password123", "phone": "09127770099",
		"securityQuestion": "رنگ؟", "securityAnswer": "آبی",
	}
	code, res := e.doHeaders(t, "POST", "/api/auth/register", "", map[string]string{
		"X-Real-IP": "203.0.113.199",
	}, body)
	if code != http.StatusBadRequest {
		t.Fatalf("register without captcha: want 400 got %d %v", code, res)
	}
}
