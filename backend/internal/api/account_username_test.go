package api_test

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

func TestAccountUsernameQuota(t *testing.T) {
	e := setup(t)
	token, uid := register(t, e, "Quota", "quota@test.dev")

	code, body := e.do(t, "PUT", "/api/me/username", token, map[string]any{"username": "quota"})
	if code != http.StatusOK {
		t.Fatalf("same username: %d %v", code, body["error"])
	}
	if body["usernameChangesRemaining"].(float64) != 3 {
		t.Fatalf("same username consumed a slot: %v", body["usernameChangesRemaining"])
	}

	for i, next := range []string{"quotaone", "quotatwo", "quotathree"} {
		code, body = e.do(t, "PUT", "/api/me/username", token, map[string]any{"username": next})
		if code != http.StatusOK {
			t.Fatalf("change %d: %d %v", i+1, code, body["error"])
		}
		user := body["user"].(map[string]any)
		if user["username"] != next {
			t.Fatalf("username: %v", user["username"])
		}
		wantRemaining := float64(2 - i)
		if body["usernameChangesRemaining"].(float64) != wantRemaining {
			t.Fatalf("remaining after change %d: %v", i+1, body["usernameChangesRemaining"])
		}
	}
	if body["usernameCooldownUntil"] == nil || body["usernameCooldownUntil"] == "" {
		t.Fatalf("third change should start cooldown: %v", body["usernameCooldownUntil"])
	}

	code, blocked := e.do(t, "PUT", "/api/me/username", token, map[string]any{"username": "quotafour"})
	errMsg, _ := blocked["error"].(string)
	if code != http.StatusTooManyRequests || !strings.Contains(errMsg, "نام کاربری") || !strings.Contains(errMsg, "مهلت") {
		t.Fatalf("fourth change: %d %q", code, errMsg)
	}

	code, me := e.do(t, "GET", "/api/auth/me", token, nil)
	if code != http.StatusOK {
		t.Fatalf("me: %d", code)
	}
	if me["user"].(map[string]any)["username"] != "quotathree" {
		t.Fatalf("username changed during cooldown: %v", me["user"].(map[string]any)["username"])
	}

	if _, err := e.pool.Exec(context.Background(), `UPDATE users SET username_cooldown_until = now() - interval '1 second' WHERE id=$1`, uid); err != nil {
		t.Fatal(err)
	}
	code, body = e.do(t, "PUT", "/api/me/username", token, map[string]any{"username": "quotafour"})
	if code != http.StatusOK {
		t.Fatalf("after cooldown: %d %v", code, body["error"])
	}
	if body["user"].(map[string]any)["username"] != "quotafour" {
		t.Fatalf("username after cooldown: %v", body["user"])
	}
	if body["usernameChangesRemaining"].(float64) != 2 {
		t.Fatalf("allowance should reset then consume one: %v", body["usernameChangesRemaining"])
	}

	code, denied := e.do(t, "PUT", "/api/me/account", token, map[string]any{"password": "replacement-pass"})
	if code != http.StatusForbidden {
		t.Fatalf("password change without current password: %d %v", code, denied["error"])
	}
	_ = login(t, e, "quota@test.dev")

	code, rejected := e.do(t, "PUT", "/api/me/username", token, map[string]any{
		"username": "quotafive",
		"password": "should-be-ignored",
	})
	if code != http.StatusBadRequest {
		t.Fatalf("username endpoint accepted a password: %d %v", code, rejected["error"])
	}
	code, me = e.do(t, "GET", "/api/auth/me", token, nil)
	if code != http.StatusOK || me["user"].(map[string]any)["username"] != "quotafour" {
		t.Fatalf("username changed via password field: %d %v", code, me["user"])
	}
}

func TestAccountIdentityWithoutPassword(t *testing.T) {
	e := setup(t)
	token, _ := register(t, e, "Identity", "identity@test.dev")

	code, me := e.do(t, "GET", "/api/auth/me", token, nil)
	if code != http.StatusOK {
		t.Fatalf("me: %d", code)
	}
	before := me["user"].(map[string]any)
	username, _ := before["username"].(string)
	role, _ := before["role"].(string)

	code, body := e.do(t, "PUT", "/api/me/account", token, map[string]any{
		"name":  "هویت تازه",
		"email": "identity-new@test.dev",
		"phone": "09120001122",
	})
	if code != http.StatusOK {
		t.Fatalf("identity save: %d %v", code, body["error"])
	}
	user := body["user"].(map[string]any)
	if user["name"] != "هویت تازه" || user["email"] != "identity-new@test.dev" || user["phone"] != "09120001122" {
		t.Fatalf("saved identity: name=%v email=%v phone=%v", user["name"], user["email"], user["phone"])
	}
	if user["username"] != username || user["role"] != role {
		t.Fatalf("username or role changed: username=%v role=%v", user["username"], user["role"])
	}
	if user["securityQuestion"] != before["securityQuestion"] {
		t.Fatalf("security question changed: %v", user["securityQuestion"])
	}
	_ = login(t, e, "identity-new@test.dev")

	code, same := e.do(t, "PUT", "/api/me/account", token, map[string]any{
		"name":  "هویت تازه",
		"email": "identity-new@test.dev",
		"phone": "09120001122",
	})
	if code != http.StatusOK {
		t.Fatalf("same identity: %d %v", code, same["error"])
	}

	_, _ = register(t, e, "Other", "taken-mail@test.dev")
	code, dup := e.do(t, "PUT", "/api/me/account", token, map[string]any{"email": "taken-mail@test.dev"})
	if code != http.StatusConflict {
		t.Fatalf("duplicate email: %d %v", code, dup["error"])
	}
	code, bad := e.do(t, "PUT", "/api/me/account", token, map[string]any{"email": "not-an-email"})
	if code != http.StatusBadRequest {
		t.Fatalf("invalid email: %d %v", code, bad["error"])
	}
	code, phoneBad := e.do(t, "PUT", "/api/me/account", token, map[string]any{"phone": "123"})
	if code != http.StatusBadRequest {
		t.Fatalf("invalid phone: %d %v", code, phoneBad["error"])
	}

	code, roleBody := e.do(t, "PUT", "/api/me/account", token, map[string]any{"role": "admin", "name": "نباید ذخیره شود"})
	if code != http.StatusForbidden {
		t.Fatalf("role change: %d %v", code, roleBody["error"])
	}
	code, userBody := e.do(t, "PUT", "/api/me/account", token, map[string]any{"username": "hijackname"})
	if code != http.StatusBadRequest {
		t.Fatalf("username via account: %d %v", code, userBody["error"])
	}

	code, me = e.do(t, "GET", "/api/auth/me", token, nil)
	if code != http.StatusOK {
		t.Fatalf("me after rejects: %d", code)
	}
	after := me["user"].(map[string]any)
	if after["role"] != role || after["username"] != username || after["name"] != "هویت تازه" || after["email"] != "identity-new@test.dev" {
		t.Fatalf("account mutated by rejected fields: %v", after)
	}

	code, denied := e.do(t, "PUT", "/api/me/account", token, map[string]any{"password": "replacement-pass"})
	if code != http.StatusForbidden {
		t.Fatalf("password without current: %d %v", code, denied["error"])
	}
	_ = login(t, e, "identity-new@test.dev")

	code, changed := e.do(t, "PUT", "/api/me/account", token, map[string]any{
		"currentPassword": "password123",
		"password":        "replacement-pass",
	})
	if code != http.StatusOK {
		t.Fatalf("password with current: %d %v", code, changed["error"])
	}
	kept := changed["user"].(map[string]any)
	if kept["name"] != "هویت تازه" || kept["email"] != "identity-new@test.dev" || kept["phone"] != "09120001122" || kept["role"] != role {
		t.Fatalf("password save changed identity: %v", kept)
	}
	code, session := e.do(t, "POST", "/api/auth/login", "", loginBody(t, e, "identity-new@test.dev", "replacement-pass"))
	if code != http.StatusOK || session["accessToken"] == nil {
		t.Fatalf("login after password change: %d %v", code, session["error"])
	}
	code, old := e.do(t, "POST", "/api/auth/login", "", loginBody(t, e, "identity-new@test.dev", "password123"))
	if code == http.StatusOK {
		t.Fatalf("previous password still works: %d", code)
	}
	_ = old["error"]
}
