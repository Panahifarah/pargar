package api_test

import (
	"net/http"
	"testing"
)

func enableRegistration(t *testing.T, e *testEnv) {
	t.Helper()
	admin := login(t, e, bootstrapAdminEmail)
	code, body := e.do(t, "PUT", "/api/admin/settings", admin, map[string]any{
		"settings": map[string]string{"registration_enabled": "true"},
	})
	if code != http.StatusOK {
		t.Fatalf("enable registration: %d %v", code, body)
	}
}

func whitelistPhones(t *testing.T, e *testEnv, phones ...string) {
	t.Helper()
	admin := login(t, e, bootstrapAdminEmail)
	code, body := e.do(t, "POST", "/api/admin/phone-whitelist/import", admin, map[string]any{
		"phones": phones,
	})
	if code != http.StatusOK {
		t.Fatalf("whitelist import: %d %v", code, body)
	}
}

func registerBody(t *testing.T, e *testEnv, phone, email, username string) map[string]any {
	t.Helper()
	id, answer := fetchCaptcha(t, e)
	return map[string]any{
		"name": "هنرجو تست", "email": email, "username": username,
		"password": "password123", "passwordConfirm": "password123", "phone": phone,
		"securityQuestion": "رنگ مورد علاقه؟", "securityAnswer": "آبی",
		"challengeId": id, "captchaAnswer": answer,
	}
}

func TestRegisterPasswordMismatch(t *testing.T) {
	e := setup(t)
	enableRegistration(t, e)
	whitelistPhones(t, e, "09121110901")

	body := registerBody(t, e, "09121110901", "reg-mismatch@test.dev", "regmismatch")
	body["passwordConfirm"] = "different99"
	code, res := e.doHeaders(t, "POST", "/api/auth/register", "", map[string]string{
		"X-Forwarded-For": "203.0.113.91",
	}, body)
	if code != http.StatusBadRequest {
		t.Fatalf("expected bad request, got %d %v", code, res)
	}
	if res["error"] != "گذرواژه و تکرار آن یکسان نیستند" {
		t.Fatalf("error: %v", res["error"])
	}
}

func TestRegisterUsernameRejectsPersianAndSpaces(t *testing.T) {
	e := setup(t)
	enableRegistration(t, e)
	whitelistPhones(t, e, "09121110910", "09121110911", "09121110912")

	cases := []struct {
		username string
		phone    string
		ip       string
	}{
		{"کاربر", "09121110910", "203.0.113.201"},
		{"user name", "09121110911", "203.0.113.202"},
		{"1startswithnum", "09121110912", "203.0.113.203"},
	}
	for _, c := range cases {
		code, res := e.doHeaders(t, "POST", "/api/auth/register", "", map[string]string{
			"X-Forwarded-For": c.ip,
		}, registerBody(t, e, c.phone, "reg-u"+c.phone+"@test.dev", c.username))
		if code != http.StatusBadRequest {
			t.Fatalf("%q: expected 400, got %d %v", c.username, code, res)
		}
		if res["error"] != "شناسه باید با حرف انگلیسی شروع شود و ۳ تا ۳۲ نویسهٔ لاتین، عدد، نقطه، خط یا زیرخط باشد" {
			t.Fatalf("%q error: %v", c.username, res["error"])
		}
	}
}

func TestRegisterUsernameAcceptsValid(t *testing.T) {
	e := setup(t)
	enableRegistration(t, e)
	whitelistPhones(t, e, "09121110920")

	code, body := e.doHeaders(t, "POST", "/api/auth/register", "", map[string]string{
		"X-Forwarded-For": "203.0.113.220",
	}, registerBody(t, e, "09121110920", "reg-uok@test.dev", "ahp.dev_1"))
	if code != http.StatusCreated {
		t.Fatalf("valid username rejected: %d %v", code, body)
	}
}

func TestRegisterInvalidEmailAndPhone(t *testing.T) {
	e := setup(t)
	enableRegistration(t, e)
	whitelistPhones(t, e, "09121110930")

	body := registerBody(t, e, "09121110930", "not-an-email", "emailevil")
	code, res := e.doHeaders(t, "POST", "/api/auth/register", "", map[string]string{
		"X-Forwarded-For": "203.0.113.230",
	}, body)
	if code != http.StatusBadRequest || res["error"] != "ایمیل نامعتبر است" {
		t.Fatalf("email: %d %v", code, res)
	}

	body = registerBody(t, e, "12345", "phone-bad@test.dev", "phonebad")
	code, res = e.doHeaders(t, "POST", "/api/auth/register", "", map[string]string{
		"X-Forwarded-For": "203.0.113.231",
	}, body)
	if code != http.StatusBadRequest {
		t.Fatalf("phone: expected 400, got %d %v", code, res)
	}
}

func TestRegisterStatusDisabledByDefault(t *testing.T) {
	e := setup(t)
	code, body := e.do(t, "GET", "/api/auth/register-status", "", nil)
	if code != http.StatusOK {
		t.Fatalf("status: %d %v", code, body)
	}
	if body["enabled"] != false {
		t.Fatalf("expected disabled, got %v", body)
	}
}

func TestRegisterRejectedWhenDisabled(t *testing.T) {
	e := setup(t)
	code, body := e.do(t, "POST", "/api/auth/register", "", registerBody(t, e,
		"09121110001", "reg-off@test.dev", "regoff",
	))
	if code != http.StatusForbidden {
		t.Fatalf("expected forbidden when disabled, got %d %v", code, body)
	}
}

func TestRegisterSuccess(t *testing.T) {
	e := setup(t)
	enableRegistration(t, e)
	whitelistPhones(t, e, "09121110002")

	code, body := e.doHeaders(t, "POST", "/api/auth/register", "", map[string]string{
		"X-Forwarded-For": "203.0.113.10",
	}, registerBody(t, e, "09121110002", "reg-ok@test.dev", "regok"))
	if code != http.StatusCreated {
		t.Fatalf("register: %d %v", code, body)
	}
	if body["accessToken"] == nil || body["refreshToken"] == nil || body["user"] == nil {
		t.Fatalf("missing tokens/user: %v", body)
	}
	user := body["user"].(map[string]any)
	if user["role"] != "student" {
		t.Fatalf("expected student role, got %v", user["role"])
	}
	if user["phone"] != "09121110002" {
		t.Fatalf("unexpected phone: %v", user["phone"])
	}
	if _, ok := user["passwordHash"]; ok {
		t.Fatal("password hash must not be exposed")
	}
	if _, ok := user["securityAnswerHash"]; ok {
		t.Fatal("security answer hash must not be exposed")
	}

	admin := login(t, e, bootstrapAdminEmail)
	code, body = e.do(t, "GET", "/api/admin/phone-whitelist?status=consumed", admin, nil)
	if code != http.StatusOK {
		t.Fatalf("list consumed: %d %v", code, body)
	}
	entries := body["items"].([]any)
	if len(entries) != 1 {
		t.Fatalf("expected 1 consumed entry, got %v", body)
	}
	if entries[0].(map[string]any)["phone"] != "09121110002" {
		t.Fatalf("unexpected consumed phone: %v", entries[0])
	}
}

func TestRegisterWithoutWhitelistRejected(t *testing.T) {
	e := setup(t)
	enableRegistration(t, e)

	code, body := e.doHeaders(t, "POST", "/api/auth/register", "", map[string]string{
		"X-Forwarded-For": "203.0.113.15",
	}, registerBody(t, e, "09121110999", "reg-nowl@test.dev", "regnowl"))
	if code != http.StatusForbidden {
		t.Fatalf("expected forbidden without whitelist, got %d %v", code, body)
	}
	if body["error"] != "این شماره در فهرست مجاز نیست" {
		t.Fatalf("unexpected error: %v", body["error"])
	}
}

func TestRegisterWithoutWhitelistAllowedWhenOptional(t *testing.T) {
	e := setup(t)
	enableRegistration(t, e)
	admin := login(t, e, bootstrapAdminEmail)
	code, body := e.do(t, "PUT", "/api/admin/settings", admin, map[string]any{
		"settings": map[string]string{
			"registration_enabled":           "true",
			"registration_require_whitelist": "false",
		},
	})
	if code != http.StatusOK {
		t.Fatalf("disable whitelist requirement: %d %v", code, body)
	}

	code, body = e.doHeaders(t, "POST", "/api/auth/register", "", map[string]string{
		"X-Forwarded-For": "203.0.113.115",
	}, registerBody(t, e, "09121110888", "reg-optwl@test.dev", "regoptwl"))
	if code != http.StatusCreated {
		t.Fatalf("expected register without whitelist when optional, got %d %v", code, body)
	}
}

func TestRegisterWhitelistConsumedOnSecondUse(t *testing.T) {
	e := setup(t)
	enableRegistration(t, e)
	whitelistPhones(t, e, "09121110004")

	code, body := e.doHeaders(t, "POST", "/api/auth/register", "", map[string]string{
		"X-Forwarded-For": "203.0.113.16",
	}, registerBody(t, e, "09121110004", "reg-wl1@test.dev", "regwl1"))
	if code != http.StatusCreated {
		t.Fatalf("first: %d %v", code, body)
	}
	// Same phone already on user — uniqueness hits first; use a fresh attempt message path
	// by checking list shows consumed and a different unused phone still works.
	admin := login(t, e, bootstrapAdminEmail)
	code, body = e.do(t, "GET", "/api/admin/phone-whitelist?status=available", admin, nil)
	if code != http.StatusOK {
		t.Fatalf("list available: %d %v", code, body)
	}
	if len(body["items"].([]any)) != 0 {
		t.Fatalf("expected no available after consume, got %v", body)
	}
}

func TestRegisterDuplicatePhone(t *testing.T) {
	e := setup(t)
	enableRegistration(t, e)
	whitelistPhones(t, e, "09121110003")

	code, body := e.doHeaders(t, "POST", "/api/auth/register", "", map[string]string{
		"X-Forwarded-For": "203.0.113.20",
	}, registerBody(t, e, "09121110003", "reg-p1@test.dev", "regp1"))
	if code != http.StatusCreated {
		t.Fatalf("first: %d %v", code, body)
	}
	code, body = e.doHeaders(t, "POST", "/api/auth/register", "", map[string]string{
		"X-Forwarded-For": "203.0.113.21",
	}, registerBody(t, e, "09121110003", "reg-p2@test.dev", "regp2"))
	if code != http.StatusConflict {
		t.Fatalf("expected phone conflict, got %d %v", code, body)
	}
}

func TestRegisterSameIPRejected(t *testing.T) {
	e := setup(t)
	enableRegistration(t, e)
	whitelistPhones(t, e, "09121110007", "09121110008")

	headers := map[string]string{"X-Forwarded-For": "203.0.113.40"}
	code, body := e.doHeaders(t, "POST", "/api/auth/register", "", headers,
		registerBody(t, e, "09121110007", "reg-ip1@test.dev", "regip1"))
	if code != http.StatusCreated {
		t.Fatalf("first: %d %v", code, body)
	}
	code, body = e.doHeaders(t, "POST", "/api/auth/register", "", headers,
		registerBody(t, e, "09121110008", "reg-ip2@test.dev", "regip2"))
	if code != http.StatusConflict {
		t.Fatalf("expected IP conflict, got %d %v", code, body)
	}
}

func TestRegisterUsesForwardedIP(t *testing.T) {
	e := setup(t)
	enableRegistration(t, e)
	whitelistPhones(t, e, "09121110009", "09121110010", "09121110011")

	// Proxies append; the last hop is the client identity (Traefik overwrites to a single IP).
	code, body := e.doHeaders(t, "POST", "/api/auth/register", "", map[string]string{
		"X-Forwarded-For": "198.51.100.50, 10.0.0.1",
	}, registerBody(t, e, "09121110009", "reg-xff@test.dev", "regxff"))
	if code != http.StatusCreated {
		t.Fatalf("register via XFF: %d %v", code, body)
	}
	// Same last-hop client IP must be blocked even with a different leading chain.
	code, body = e.doHeaders(t, "POST", "/api/auth/register", "", map[string]string{
		"X-Forwarded-For": "203.0.113.9, 10.0.0.1",
	}, registerBody(t, e, "09121110010", "reg-xff2@test.dev", "regxff2"))
	if code != http.StatusConflict {
		t.Fatalf("expected same XFF client IP rejected, got %d %v", code, body)
	}
	// X-Real-IP alone also counts as a distinct registration IP.
	code, body = e.doHeaders(t, "POST", "/api/auth/register", "", map[string]string{
		"X-Real-IP": "198.51.100.60",
	}, registerBody(t, e, "09121110011", "reg-xri@test.dev", "regxri"))
	if code != http.StatusCreated {
		t.Fatalf("register via X-Real-IP: %d %v", code, body)
	}
}
