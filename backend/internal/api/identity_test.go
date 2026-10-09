package api_test

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
)

func TestLoginWithUsername(t *testing.T) {
	e := setup(t)
	admin := login(t, e, bootstrapAdminEmail)
	code, body := e.do(t, "POST", "/api/admin/users", admin, map[string]any{
		"name": "ULogin", "email": "ulogin@test.dev", "username": "ulogin",
		"password": "password123", "role": "student",
		"phone": "09121112233", "securityQuestion": "رنگ مورد علاقه؟", "securityAnswer": "آبی",
	})
	if code != http.StatusCreated {
		t.Fatalf("create: %d %v", code, body)
	}
	code, body = e.do(t, "POST", "/api/auth/login", "", loginBody(t, e, "ulogin", "password123"))
	if code != http.StatusOK {
		t.Fatalf("username login: %d %v", code, body)
	}
}

func TestUniquePhone(t *testing.T) {
	e := setup(t)
	admin := login(t, e, bootstrapAdminEmail)
	code, _ := e.do(t, "POST", "/api/admin/users", admin, map[string]any{
		"name": "P1", "email": "p1@test.dev", "username": "p1user",
		"password": "password123", "role": "student",
		"phone": "09120000001", "securityQuestion": "رنگ؟", "securityAnswer": "آبی",
	})
	if code != http.StatusCreated {
		t.Fatalf("first: %d", code)
	}
	code, body := e.do(t, "POST", "/api/admin/users", admin, map[string]any{
		"name": "P2", "email": "p2@test.dev", "username": "p2user",
		"password": "password123", "role": "student",
		"phone": "09120000001", "securityQuestion": "رنگ؟", "securityAnswer": "آبی",
	})
	if code != http.StatusConflict {
		t.Fatalf("expected phone conflict, got %d %v", code, body)
	}
}

func TestAdminResetPassword(t *testing.T) {
	e := setup(t)
	admin := login(t, e, bootstrapAdminEmail)
	code, body := e.do(t, "POST", "/api/admin/users", admin, map[string]any{
		"name": "ResetMe", "email": "resetme@test.dev", "username": "resetme",
		"password": "password123", "role": "student",
		"securityQuestion": "پایتخت؟", "securityAnswer": "تهران",
	})
	if code != http.StatusCreated {
		t.Fatalf("create: %d %v", code, body)
	}
	uid := int64(body["user"].(map[string]any)["id"].(float64))

	code, _ = e.do(t, "POST", "/api/admin/users/"+itoa(uid)+"/reset-password", admin, map[string]any{
		"newPassword": "short",
	})
	if code != http.StatusBadRequest {
		t.Fatalf("short password: %d", code)
	}

	code, body = e.do(t, "POST", "/api/admin/users/"+itoa(uid)+"/reset-password", admin, map[string]any{
		"newPassword": "newpass123",
	})
	if code != http.StatusOK {
		t.Fatalf("reset: %d %v", code, body)
	}

	code, _ = e.do(t, "POST", "/api/auth/login", "", loginBody(t, e, "resetme", "newpass123"))
	if code != http.StatusOK {
		t.Fatalf("login with new password failed: %d", code)
	}
}

func TestCertificateIssueAndPublicAccess(t *testing.T) {
	e := setup(t)
	token, uid := register(t, e, "Cert", "cert@test.dev")

	code, body := e.do(t, "POST", "/api/me/certificate/issue", token, nil)
	if code != http.StatusConflict {
		t.Fatalf("issue before complete should conflict: %d %v", code, body)
	}

	// Mark all active lessons passed directly for speed.
	_, err := e.pool.Exec(context.Background(), `
		INSERT INTO lesson_progress (user_id, lesson_id, watched_seconds, watched_pct, last_position, quiz_unlocked, passed_quiz, quiz_completed_at)
		SELECT $1, id, duration_seconds, 100, duration_seconds, true, true, now()
		FROM lessons WHERE is_active
		ON CONFLICT (user_id, lesson_id) DO UPDATE SET passed_quiz=true, quiz_unlocked=true`, uid)
	if err != nil {
		t.Fatalf("seed progress: %v", err)
	}

	code, body = e.do(t, "GET", "/api/me/certificate", token, nil)
	if code != http.StatusOK {
		t.Fatalf("mine before issue: %d %v", code, body)
	}
	if body["eligible"] != true {
		t.Fatalf("expected eligible=true before issue, got %v", body["eligible"])
	}
	if body["certificate"] != nil {
		t.Fatalf("expected nil certificate before issue, got %v", body["certificate"])
	}

	code, body = e.do(t, "POST", "/api/me/certificate/issue", token, nil)
	if code != http.StatusOK {
		t.Fatalf("issue: %d %v", code, body)
	}
	cert := body["certificate"].(map[string]any)
	publicID := cert["publicId"].(string)
	if publicID == "" {
		t.Fatal("missing publicId")
	}

	if len(publicID) != 32 {
		t.Fatalf("publicId should be 32-char hex token, got %q (len=%d)", publicID, len(publicID))
	}
	for _, r := range publicID {
		if (r < '0' || r > '9') && (r < 'a' || r > 'f') {
			t.Fatalf("publicId must be lowercase hex, got %q", publicID)
		}
	}

	req, err := http.NewRequest("GET", e.server.URL+"/api/certificates/"+publicID, nil)
	if err != nil {
		t.Fatalf("build public cert req: %v", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("public cert: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("public cert: %d", resp.StatusCode)
	}
	wantRobots := "noindex, nofollow, noarchive"
	if got := resp.Header.Get("X-Robots-Tag"); got != wantRobots {
		t.Fatalf("X-Robots-Tag: got %q want %q", got, wantRobots)
	}
	var pubBody map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&pubBody); err != nil {
		t.Fatalf("decode public cert: %v", err)
	}
	if pubBody["certificate"].(map[string]any)["fullName"] != "Cert" {
		t.Fatalf("unexpected public payload: %v", pubBody)
	}

	code, body = e.do(t, "GET", "/api/me/certificate", token, nil)
	if code != http.StatusOK {
		t.Fatalf("mine after issue: %d %v", code, body)
	}
	if body["eligible"] != true {
		t.Fatalf("expected eligible after issue, got %v", body["eligible"])
	}
	mineCert, _ := body["certificate"].(map[string]any)
	if mineCert == nil || mineCert["publicId"] != publicID {
		t.Fatalf("mine certificate: %v", body["certificate"])
	}

	// Missing cert still sends noindex so 404s are not indexed.
	missReq, _ := http.NewRequest("GET", e.server.URL+"/api/certificates/does-not-exist", nil)
	missResp, err := http.DefaultClient.Do(missReq)
	if err != nil {
		t.Fatalf("missing cert: %v", err)
	}
	missResp.Body.Close()
	if missResp.StatusCode != http.StatusNotFound {
		t.Fatalf("missing cert status: %d", missResp.StatusCode)
	}
	if got := missResp.Header.Get("X-Robots-Tag"); got != wantRobots {
		t.Fatalf("missing cert X-Robots-Tag: got %q want %q", got, wantRobots)
	}

	code, body = e.do(t, "POST", "/api/me/certificate/physical", token, map[string]any{
		"recipientName": "Cert",
		"phone":         "09120000000",
		"address":       "خیابان نمونه پلاک ۱",
		"city":          "تهران",
		"postalCode":    "1234567890",
	})
	if code != http.StatusCreated {
		t.Fatalf("physical request: %d %v", code, body)
	}

	code, _ = e.do(t, "POST", "/api/me/certificate/physical", token, map[string]any{
		"address": "x", "city": "y",
	})
	if code != http.StatusConflict {
		t.Fatalf("duplicate physical should conflict: %d", code)
	}

	admin := login(t, e, bootstrapAdminEmail)
	code, body = e.do(t, "GET", "/api/admin/physical-orders", admin, nil)
	if code != http.StatusOK {
		t.Fatalf("list orders: %d", code)
	}
	orders := body["orders"].([]any)
	if len(orders) < 1 {
		t.Fatal("expected orders")
	}
	orderID := int64(orders[0].(map[string]any)["id"].(float64))
	code, body = e.do(t, "PUT", "/api/admin/physical-orders/"+itoa(orderID), admin, map[string]any{
		"status": "paid", "note": "واریز شد",
	})
	if code != http.StatusOK {
		t.Fatalf("mark paid: %d %v", code, body)
	}
	code, body = e.do(t, "PUT", "/api/admin/physical-orders/"+itoa(orderID), admin, map[string]any{
		"status": "shipped", "trackingCode": "TRK-99",
	})
	if code != http.StatusOK {
		t.Fatalf("mark shipped: %d %v", code, body)
	}
	if body["order"].(map[string]any)["trackingCode"] != "TRK-99" {
		t.Fatalf("expected tracking code, got %v", body)
	}
}
