package api_test

import (
	"net/http"
	"testing"
)

func TestCommunityEndpointPublic(t *testing.T) {
	e := setup(t)
	code, body := e.do(t, "GET", "/api/community", "", nil)
	if code != http.StatusOK {
		t.Fatalf("community: %d %v", code, body)
	}
	don, ok := body["donation"].(map[string]any)
	if !ok {
		t.Fatalf("missing donation: %v", body)
	}
	if _, ok := don["enabled"]; !ok {
		t.Fatalf("missing donation.enabled: %v", don)
	}
	if don["mode"] != "chat" {
		t.Fatalf("donation.mode want chat, got %v", don["mode"])
	}
	if _, hasCard := don["cardNumber"]; hasCard {
		t.Fatal("public card number must not be exposed")
	}
	// Telegram channel surface was removed from the product.
	if _, hasChannel := body["channel"]; hasChannel {
		t.Fatal("legacy channel field must not be exposed")
	}
}
