package api_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"testing"
)

func TestPasswordRecoveryDisabled(t *testing.T) {
	e := setup(t)
	_, _ = register(t, e, "Recovery User", "recover-me@test.dev")

	id, answer := fetchCaptcha(t, e)
	code, body := e.do(t, "POST", "/api/auth/recovery/challenge", "", map[string]any{
		"login": "recover-me@test.dev", "challengeId": id, "captchaAnswer": answer,
	})
	if code != http.StatusNotFound {
		t.Fatalf("challenge should be disabled: want 404 got %d %v", code, body)
	}

	id, answer = fetchCaptcha(t, e)
	code, body = e.do(t, "POST", "/api/auth/recovery/reset", "", map[string]any{
		"login": "recover-me@test.dev", "securityAnswer": "rex",
		"newPassword": "NewPassw0rd!", "challengeId": id, "captchaAnswer": answer,
	})
	if code != http.StatusNotFound {
		t.Fatalf("reset should be disabled: want 404 got %d %v", code, body)
	}
}

func TestSessionCookieOnLogin(t *testing.T) {
	e := setup(t)
	_, _ = register(t, e, "Cookie User", "cookie-user@test.dev")
	code, body, cookies := e.doWithCookies(t, "POST", "/api/auth/login", "", loginBody(t, e, "cookie-user@test.dev", "password123"), nil)
	if code != http.StatusOK {
		t.Fatalf("login: %d %v", code, body)
	}
	var access string
	for _, c := range cookies {
		if c.Name == "pargar_access" {
			access = c.Value
		}
	}
	if access == "" {
		t.Fatalf("missing pargar_access cookie: %v", cookies)
	}
	code, body, _ = e.doWithCookies(t, "GET", "/api/auth/me", "", nil, []*http.Cookie{
		{Name: "pargar_access", Value: access},
	})
	if code != http.StatusOK {
		t.Fatalf("me via cookie: %d %v", code, body)
	}
}

func (e *testEnv) doWithCookies(t *testing.T, method, path, bearer string, body any, cookies []*http.Cookie) (int, map[string]any, []*http.Cookie) {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req, _ := http.NewRequest(method, e.server.URL+path, &buf)
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for _, c := range cookies {
		req.AddCookie(c)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	defer resp.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out, resp.Cookies()
}
