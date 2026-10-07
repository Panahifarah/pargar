package api_test

import (
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"pargar/backend/internal/api"
)

func TestWebSocketUpgrade(t *testing.T) {
	e := setup(t)
	token := login(t, e, bootstrapAdminEmail)

	u, err := url.Parse(e.server.URL)
	if err != nil {
		t.Fatalf("parse url: %v", err)
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
		t.Fatalf("websocket dial: status=%d err=%v", status, err)
	}
	defer conn.Close()
	if resp.StatusCode != http.StatusSwitchingProtocols {
		t.Fatalf("expected 101 Switching Protocols, got %d", resp.StatusCode)
	}

	_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	_, msg, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read welcome: %v", err)
	}
	if !strings.Contains(string(msg), `"connected"`) {
		t.Fatalf("unexpected welcome frame: %s", msg)
	}
}

func TestWebSocketExcludedFromGlobalRateLimit(t *testing.T) {
	e := setup(t)
	token := login(t, e, bootstrapAdminEmail)

	prev := api.SetAPIGlobalLimitForTest(2)
	t.Cleanup(func() { api.SetAPIGlobalLimitForTest(prev) })

	// Burn the global REST budget from a fixed IP.
	for i := 0; i < 6; i++ {
		req, _ := http.NewRequest("GET", e.server.URL+"/api/auth/me", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("X-Forwarded-For", "198.51.100.77")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("me: %v", err)
		}
		_ = resp.Body.Close()
	}

	u, err := url.Parse(e.server.URL)
	if err != nil {
		t.Fatalf("parse url: %v", err)
	}
	u.Scheme = "ws"
	u.Path = "/api/ws"

	header := http.Header{}
	header.Set("X-Forwarded-For", "198.51.100.77")
	dialer := websocket.Dialer{
		HandshakeTimeout: 3 * time.Second,
		Subprotocols:     []string{"bearer", token},
	}
	conn, resp, err := dialer.Dial(u.String(), header)
	if err != nil {
		status := 0
		if resp != nil {
			status = resp.StatusCode
		}
		t.Fatalf("ws must not be rate-limited: status=%d err=%v", status, err)
	}
	defer conn.Close()
	if resp.StatusCode != http.StatusSwitchingProtocols {
		t.Fatalf("expected 101, got %d", resp.StatusCode)
	}
}
