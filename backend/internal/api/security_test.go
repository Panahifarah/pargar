package api_test

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"pargar/backend/internal/api"
	"pargar/backend/internal/config"
	"pargar/backend/internal/storage"
	"pargar/backend/internal/store"
)

func TestCaptchaAnswerNotLeakedWithoutExposeFlag(t *testing.T) {
	e := setup(t)
	cfg := config.Load()
	cfg.DevMode = true
	cfg.CaptchaExposeAnswer = false
	st := store.New(e.pool)
	srv := api.NewServer(cfg, st, e.rdb, storage.NewLocal(t.TempDir(), "http://localhost:8080"))
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(ts.Close)

	req, _ := http.NewRequest("GET", ts.URL+"/api/auth/captcha", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("captcha: %v", err)
	}
	defer resp.Body.Close()
	var body map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&body)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("captcha: %d %v", resp.StatusCode, body)
	}
	if _, ok := body["answer"]; ok {
		t.Fatalf("captcha answer must not be exposed when CAPTCHA_EXPOSE_ANSWER is off: %v", body)
	}
	if body["challengeId"] == "" || body["imageBase64"] == "" {
		t.Fatalf("expected challenge fields: %v", body)
	}
}

func TestClientIPUsesLastForwardedHop(t *testing.T) {
	e := setup(t)
	prev := api.SetAPIGlobalLimitForTest(3)
	t.Cleanup(func() { api.SetAPIGlobalLimitForTest(prev) })

	// Spoofed leading IP must not create a separate bucket — last hop is authoritative.
	spoofed := "198.51.100.1, 203.0.113.10"
	hitLimit := false
	for i := 0; i < 10; i++ {
		req, _ := http.NewRequest("GET", e.server.URL+"/api/auth/register-status", nil)
		req.Header.Set("X-Forwarded-For", spoofed)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("request: %v", err)
		}
		_ = resp.Body.Close()
		if resp.StatusCode == http.StatusTooManyRequests {
			hitLimit = true
			break
		}
	}
	if !hitLimit {
		t.Fatal("expected rate limit on last XFF hop")
	}

	// X-Real-IP is preferred and should share the same client identity.
	req, _ := http.NewRequest("GET", e.server.URL+"/api/auth/register-status", nil)
	req.Header.Set("X-Real-IP", "203.0.113.10")
	req.Header.Set("X-Forwarded-For", "198.51.100.99")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("x-real-ip: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("X-Real-IP should share last-hop budget, got %d", resp.StatusCode)
	}

	code, body := e.doHeaders(t, "GET", "/api/auth/register-status", "", map[string]string{
		"X-Forwarded-For": "203.0.113.77",
	}, nil)
	if code != http.StatusOK {
		t.Fatalf("other client should succeed, got %d %v", code, body)
	}
}

func TestWebSocketSubprotocolAuth(t *testing.T) {
	e := setup(t)
	token := login(t, e, bootstrapAdminEmail)

	u, err := url.Parse(e.server.URL)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	u.Scheme = "ws"
	u.Path = "/api/ws"

	dialer := websocket.Dialer{
		HandshakeTimeout: 3 * time.Second,
		Subprotocols:     []string{"bearer", token},
	}
	conn, resp, err := dialer.Dial(u.String(), nil)
	if err != nil {
		status := 0
		if resp != nil {
			status = resp.StatusCode
		}
		t.Fatalf("subprotocol dial: status=%d err=%v", status, err)
	}
	defer conn.Close()
	if resp.StatusCode != http.StatusSwitchingProtocols {
		t.Fatalf("expected 101, got %d", resp.StatusCode)
	}
	if conn.Subprotocol() != "bearer" {
		t.Fatalf("expected negotiated bearer subprotocol, got %q", conn.Subprotocol())
	}
	_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	_, msg, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read welcome: %v", err)
	}
	if !strings.Contains(string(msg), `"connected"`) {
		t.Fatalf("unexpected welcome: %s", msg)
	}
}

func TestWebSocketQueryTokenRejected(t *testing.T) {
	e := setup(t)
	token := login(t, e, bootstrapAdminEmail)

	u, err := url.Parse(e.server.URL)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	u.Scheme = "ws"
	u.Path = "/api/ws"
	q := u.Query()
	q.Set("token", token)
	u.RawQuery = q.Encode()

	dialer := websocket.Dialer{HandshakeTimeout: 3 * time.Second}
	conn, resp, err := dialer.Dial(u.String(), nil)
	if err == nil {
		_ = conn.Close()
		t.Fatal("query-string JWT must be rejected")
	}
	if resp == nil || resp.StatusCode != http.StatusUnauthorized {
		status := 0
		if resp != nil {
			status = resp.StatusCode
		}
		t.Fatalf("legacy query dial: want 401 got status=%d err=%v", status, err)
	}
}

func TestWebSocketHandshakeRateLimit(t *testing.T) {
	e := setup(t)
	token := login(t, e, bootstrapAdminEmail)
	prev := api.SetWSHandshakeLimitForTest(2)
	t.Cleanup(func() { api.SetWSHandshakeLimitForTest(prev) })

	u, err := url.Parse(e.server.URL)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	u.Scheme = "ws"
	u.Path = "/api/ws"

	header := http.Header{}
	header.Set("X-Real-IP", "198.51.100.88")
	dialer := websocket.Dialer{
		HandshakeTimeout: 3 * time.Second,
		Subprotocols:     []string{"bearer", token},
	}

	var lastStatus int
	for i := 0; i < 5; i++ {
		conn, resp, err := dialer.Dial(u.String(), header)
		if err == nil {
			_ = conn.Close()
			lastStatus = http.StatusSwitchingProtocols
			continue
		}
		if resp != nil {
			lastStatus = resp.StatusCode
			if resp.StatusCode == http.StatusTooManyRequests {
				return
			}
		}
	}
	t.Fatalf("expected WS handshake rate limit, last status=%d", lastStatus)
}

func TestChatUploadRateLimit(t *testing.T) {
	e := setup(t)
	token, _ := register(t, e, "Uploader", "uploader@test.dev")

	hitLimit := false
	for i := 0; i < 30; i++ {
		code, body := postTinyUpload(t, e, token)
		if code == http.StatusTooManyRequests {
			hitLimit = true
			break
		}
		if code != http.StatusCreated {
			t.Fatalf("upload %d: %d %v", i+1, code, body)
		}
	}
	if !hitLimit {
		t.Fatal("expected per-user upload rate limit")
	}
}

func postTinyUpload(t *testing.T, e *testEnv, token string) (int, map[string]any) {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	part, err := w.CreateFormFile("file", "note.txt")
	if err != nil {
		t.Fatalf("form: %v", err)
	}
	_, _ = part.Write([]byte("hi"))
	_ = w.Close()

	req, _ := http.NewRequest("POST", e.server.URL+"/api/chats/upload", &buf)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", w.FormDataContentType())
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("upload: %v", err)
	}
	defer resp.Body.Close()
	var body map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&body)
	return resp.StatusCode, body
}
