package api

import (
	"testing"
	"time"

	"pargar/backend/internal/config"
)

func TestMediaSignatureRoundTrip(t *testing.T) {
	s := &Server{cfg: &config.Config{JWTSecret: "test-secret-at-least-32-chars-long!!", PublicURL: "http://localhost", MediaURLTTL: time.Hour}}
	url := s.signMediaURL("videos/lesson-1.mp4")
	if url == "" || !containsAll(url, "/media/", "exp=", "sig=") {
		t.Fatalf("bad signed url: %s", url)
	}
	key := mediaKeyFromURL(url)
	if key != "videos/lesson-1.mp4" {
		t.Fatalf("key extract: %q", key)
	}
	// parse query manually
	exp := ""
	sig := ""
	for _, part := range splitQuery(url) {
		if len(part) > 4 && part[:4] == "exp=" {
			exp = part[4:]
		}
		if len(part) > 4 && part[:4] == "sig=" {
			sig = part[4:]
		}
	}
	if !s.verifyMediaSignature(key, exp, sig) {
		t.Fatal("signature should verify")
	}
	if s.verifyMediaSignature(key, "1", sig) {
		t.Fatal("expired should fail")
	}
}

func containsAll(s string, parts ...string) bool {
	for _, p := range parts {
		if !containsStr(s, p) {
			return false
		}
	}
	return true
}

func containsStr(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || len(sub) == 0 || indexOf(s, sub) >= 0)
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

func splitQuery(u string) []string {
	i := indexOf(u, "?")
	if i < 0 {
		return nil
	}
	q := u[i+1:]
	var parts []string
	start := 0
	for j := 0; j <= len(q); j++ {
		if j == len(q) || q[j] == '&' {
			parts = append(parts, q[start:j])
			start = j + 1
		}
	}
	return parts
}
