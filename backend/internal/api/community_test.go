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
	socials, ok := body["socials"].([]any)
	if !ok {
		t.Fatalf("missing socials: %v", body)
	}
	if socials == nil {
		t.Fatal("socials must be a list")
	}
	if _, hasDonation := body["donation"]; hasDonation {
		t.Fatal("donation must not be exposed")
	}
	// Telegram channel surface was removed from the product.
	if _, hasChannel := body["channel"]; hasChannel {
		t.Fatal("legacy channel field must not be exposed")
	}
}
