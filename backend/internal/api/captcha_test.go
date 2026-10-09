package api_test

import (
	"context"
	"encoding/base64"
	"net/http"
	"testing"
	"time"
)

func TestCaptchaRequiredOnLogin(t *testing.T) {
	e := setup(t)
	code, body := e.do(t, "POST", "/api/auth/login", "", map[string]any{
		"email": bootstrapAdminEmail, "password": "password123",
	})
	if code != http.StatusBadRequest || body["error"] != "کد امنیتی الزامی است" {
		t.Fatalf("expected captcha required, got %d %v", code, body)
	}
}

func TestCaptchaImageChallenge(t *testing.T) {
	e := setup(t)
	code, body := e.do(t, "GET", "/api/auth/captcha", "", nil)
	if code != http.StatusOK {
		t.Fatalf("captcha: %d %v", code, body)
	}
	id, _ := body["challengeId"].(string)
	img, _ := body["imageBase64"].(string)
	answer, _ := body["answer"].(string)
	if id == "" || img == "" || answer == "" {
		t.Fatalf("captcha missing fields: %v", body)
	}
	exp, ok := body["expiresIn"].(float64)
	if !ok || exp < 60 || exp > 180 {
		t.Fatalf("expiresIn should be a short window: %v", body["expiresIn"])
	}
	if _, ok := body["question"]; ok {
		t.Fatalf("legacy question field should be gone: %v", body)
	}
	raw, err := base64.StdEncoding.DecodeString(img)
	if err != nil || len(raw) < 32 {
		t.Fatalf("imageBase64 not valid PNG payload: err=%v len=%d", err, len(raw))
	}
	if raw[0] != 0x89 || string(raw[1:4]) != "PNG" {
		t.Fatalf("imageBase64 is not a PNG")
	}
	if len(answer) < 4 || len(answer) > 5 {
		t.Fatalf("unexpected answer length: %q", answer)
	}
}

func TestCaptchaWrongRejected(t *testing.T) {
	e := setup(t)
	id, answer := fetchCaptcha(t, e)
	code, body := e.do(t, "POST", "/api/auth/login", "", map[string]any{
		"email": bootstrapAdminEmail, "password": "password123",
		"challengeId": id, "captchaAnswer": "ZZZZZ",
	})
	if code != http.StatusBadRequest || body["error"] != "پاسخ کد امنیتی نادرست یا منقضی است" {
		t.Fatalf("expected wrong captcha, got %d %v", code, body)
	}
	// Challenge is one-time: reuse must fail even with the correct answer later.
	code, body = e.do(t, "POST", "/api/auth/login", "", map[string]any{
		"email": bootstrapAdminEmail, "password": "password123",
		"challengeId": id, "captchaAnswer": answer,
	})
	if code != http.StatusBadRequest {
		t.Fatalf("reused challenge should fail, got %d %v", code, body)
	}
}

func TestRememberMeRefreshTTL(t *testing.T) {
	e := setup(t)
	ctx := context.Background()

	assertTTL := func(remember bool, wantMin, wantMax time.Duration) {
		t.Helper()
		body := loginBody(t, e, bootstrapAdminEmail, "password123")
		body["rememberMe"] = remember
		code, resp := e.do(t, "POST", "/api/auth/login", "", body)
		if code != http.StatusOK {
			t.Fatalf("login rememberMe=%v: %d %v", remember, code, resp)
		}
		var lifetime time.Duration
		err := e.pool.QueryRow(ctx, `
			SELECT expires_at - created_at
			FROM refresh_tokens
			WHERE revoked_at IS NULL
			ORDER BY id DESC
			LIMIT 1`).Scan(&lifetime)
		if err != nil {
			t.Fatalf("query refresh ttl: %v", err)
		}
		if lifetime < wantMin || lifetime > wantMax {
			t.Fatalf("rememberMe=%v: lifetime %v not in [%v, %v]", remember, lifetime, wantMin, wantMax)
		}
	}

	assertTTL(false, 23*time.Hour, 25*time.Hour)
	assertTTL(true, 29*24*time.Hour, 31*24*time.Hour)
}

func TestCaptchaCorrectLogin(t *testing.T) {
	e := setup(t)
	code, body := e.do(t, "POST", "/api/auth/login", "", loginBody(t, e, bootstrapAdminEmail, "password123"))
	if code != http.StatusOK {
		t.Fatalf("login with captcha: %d %v", code, body)
	}
	if body["accessToken"] == nil {
		t.Fatalf("missing access token: %v", body)
	}
}

func TestSuccessfulLoginClearsPenalty(t *testing.T) {
	e := setup(t)
	// Accumulate a few failures (wrong password with valid captcha).
	for i := 0; i < 4; i++ {
		code, _ := e.do(t, "POST", "/api/auth/login", "", loginBody(t, e, "missing@test.dev", "wrong"))
		if code != http.StatusUnauthorized {
			t.Fatalf("fail %d: %d", i+1, code)
		}
	}
	// Successful login should clear the fail counter for this IP.
	code, body := e.do(t, "POST", "/api/auth/login", "", loginBody(t, e, bootstrapAdminEmail, "password123"))
	if code != http.StatusOK {
		t.Fatalf("success login: %d %v", code, body)
	}
	// After clear, several more wrong attempts should still be allowed (not immediately locked to 2/min).
	for i := 0; i < 5; i++ {
		code, body := e.do(t, "POST", "/api/auth/login", "", loginBody(t, e, "missing@test.dev", "wrong"))
		if code == http.StatusTooManyRequests {
			t.Fatalf("should not be rate-limited so soon after successful login clear, attempt %d: %v", i+1, body)
		}
		if code != http.StatusUnauthorized {
			t.Fatalf("attempt %d: %d %v", i+1, code, body)
		}
	}
}
