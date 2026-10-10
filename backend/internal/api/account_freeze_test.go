package api_test

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestAccountFreeze(t *testing.T) {
	e := setup(t)
	token, uid := register(t, e, "Freeze", "freeze@test.dev")

	code, missing := e.do(t, "POST", "/api/me/freeze", token, map[string]any{})
	missingMsg, _ := missing["error"].(string)
	if code == http.StatusOK || !strings.Contains(missingMsg, "گذرواژه") {
		t.Fatalf("freeze without password: %d %q", code, missingMsg)
	}
	code, wrong := e.do(t, "POST", "/api/me/freeze", token, map[string]any{"currentPassword": "not-the-password"})
	wrongMsg, _ := wrong["error"].(string)
	if code != http.StatusForbidden || !strings.Contains(wrongMsg, "گذرواژه") || !strings.Contains(wrongMsg, "نادرست") {
		t.Fatalf("freeze with wrong password: %d %q", code, wrongMsg)
	}
	var untouched *time.Time
	if err := e.pool.QueryRow(context.Background(), `SELECT frozen_at FROM users WHERE id=$1`, uid).Scan(&untouched); err != nil {
		t.Fatal(err)
	}
	if untouched != nil {
		t.Fatal("failed freeze wrote frozen_at")
	}

	code, body := e.do(t, "POST", "/api/me/freeze", token, map[string]any{"currentPassword": "password123"})
	if code != http.StatusOK {
		t.Fatalf("freeze: %d %v", code, body["error"])
	}
	user := body["user"].(map[string]any)
	frozenAt, _ := user["frozenAt"].(string)
	if frozenAt == "" || user["isFrozen"] != true || user["isClosed"] == true {
		t.Fatalf("freeze state: frozenAt=%v isFrozen=%v isClosed=%v", user["frozenAt"], user["isFrozen"], user["isClosed"])
	}
	if user["isLocked"] == true {
		t.Fatal("freeze reused the admin lock flag")
	}
	var stored *time.Time
	if err := e.pool.QueryRow(context.Background(), `SELECT frozen_at FROM users WHERE id=$1`, uid).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if stored == nil || stored.IsZero() {
		t.Fatal("frozen_at was not stored")
	}

	code, profile := e.do(t, "GET", "/api/users/"+itoa(uid), token, nil)
	if code != http.StatusOK {
		t.Fatalf("profile: %d %v", code, profile["error"])
	}
	pub := profile["user"].(map[string]any)
	if pub["isFrozen"] != true {
		t.Fatalf("public profile missing freeze flag: %v", pub["isFrozen"])
	}
	if _, ok := pub["email"]; ok {
		t.Fatalf("public profile leaked email: %v", pub["email"])
	}

	_ = login(t, e, "freeze@test.dev")

	code, body = e.do(t, "POST", "/api/me/unfreeze", token, map[string]any{})
	if code != http.StatusOK {
		t.Fatalf("unfreeze: %d %v", code, body["error"])
	}
	cleared := body["user"].(map[string]any)
	if cleared["isFrozen"] == true || cleared["frozenAt"] != nil {
		t.Fatalf("unfreeze left a timestamp: %v", cleared["frozenAt"])
	}
	var after *time.Time
	if err := e.pool.QueryRow(context.Background(), `SELECT frozen_at FROM users WHERE id=$1`, uid).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if after != nil {
		t.Fatalf("frozen_at still set: %s", after.Format(time.RFC3339))
	}

	if _, err := e.pool.Exec(context.Background(), `UPDATE users SET closed_at = now() WHERE id=$1`, uid); err != nil {
		t.Fatal(err)
	}
	code, denied := e.do(t, "POST", "/api/auth/login", "", loginBody(t, e, "freeze@test.dev", "password123"))
	errMsg, _ := denied["error"].(string)
	if code != http.StatusForbidden || !strings.Contains(errMsg, "بسته") || !strings.Contains(errMsg, "ورود") {
		t.Fatalf("closed login: %d %q", code, errMsg)
	}

	code, undo := e.do(t, "POST", "/api/me/unfreeze", token, map[string]any{})
	undoMsg, _ := undo["error"].(string)
	if code != http.StatusConflict || !strings.Contains(undoMsg, "لغو فریز") {
		t.Fatalf("unfreeze after close: %d %q", code, undoMsg)
	}

	code, forbidden := e.do(t, "DELETE", "/api/admin/users/"+itoa(uid), token, nil)
	if code != http.StatusForbidden {
		t.Fatalf("student permanent delete: %d %v", code, forbidden["error"])
	}
}
