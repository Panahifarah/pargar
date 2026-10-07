package api_test

import (
	"encoding/json"
	"net/http"
	"testing"

	"pargar/backend/internal/api"
)

func TestGlobalAPIRateLimit(t *testing.T) {
	e := setup(t)
	prev := api.SetAPIGlobalLimitForTest(5)
	t.Cleanup(func() { api.SetAPIGlobalLimitForTest(prev) })

	hitLimit := false
	var retryAfter string
	for i := 0; i < 12; i++ {
		req, _ := http.NewRequest("GET", e.server.URL+"/api/auth/register-status", nil)
		req.Header.Set("X-Forwarded-For", "198.51.100.50")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("request: %v", err)
		}
		var body map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&body)
		_ = resp.Body.Close()

		if resp.StatusCode == http.StatusTooManyRequests {
			if body["error"] != "تعداد درخواست‌ها زیاد است؛ لطفاً کمی صبر کنید" {
				t.Fatalf("unexpected message: %v", body)
			}
			retryAfter = resp.Header.Get("Retry-After")
			if retryAfter == "" {
				t.Fatal("expected Retry-After header")
			}
			hitLimit = true
			break
		}
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("request %d: expected 200 or 429, got %d %v", i+1, resp.StatusCode, body)
		}
	}
	if !hitLimit {
		t.Fatal("expected global API rate limit")
	}

	// Health must stay excluded from the global bucket (docker probes).
	for i := 0; i < 20; i++ {
		req, _ := http.NewRequest("GET", e.server.URL+"/api/health", nil)
		req.Header.Set("X-Forwarded-For", "198.51.100.50")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("health: %v", err)
		}
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("health must not be rate-limited, got %d", resp.StatusCode)
		}
	}

	// A different IP still has budget — proves the limit is per-IP, not global process-wide.
	code, body := e.doHeaders(t, "GET", "/api/auth/register-status", "", map[string]string{
		"X-Forwarded-For": "198.51.100.51",
	}, nil)
	if code != http.StatusOK {
		t.Fatalf("other IP should succeed, got %d %v", code, body)
	}
}

func TestGlobalRateLimitDoesNotClearAuthTokens(t *testing.T) {
	e := setup(t)
	token := login(t, e, bootstrapAdminEmail)

	prev := api.SetAPIGlobalLimitForTest(3)
	t.Cleanup(func() { api.SetAPIGlobalLimitForTest(prev) })

	// Burn the budget with authenticated calls from a fixed IP.
	for i := 0; i < 8; i++ {
		req, _ := http.NewRequest("GET", e.server.URL+"/api/auth/me", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("X-Forwarded-For", "203.0.113.90")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("me: %v", err)
		}
		_ = resp.Body.Close()
		if resp.StatusCode == http.StatusTooManyRequests {
			break
		}
	}

	// After 429, the same token must still authenticate once the counter is cleared —
	// proving 429 did not revoke the session server-side.
	if err := e.rdb.FlushDB(t.Context()).Err(); err != nil {
		t.Fatalf("flush: %v", err)
	}
	code, body := e.doHeaders(t, "GET", "/api/auth/me", token, map[string]string{
		"X-Forwarded-For": "203.0.113.90",
	}, nil)
	if code != http.StatusOK {
		t.Fatalf("token should still work after rate limit, got %d %v", code, body)
	}
}
