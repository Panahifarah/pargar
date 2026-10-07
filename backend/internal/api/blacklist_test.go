package api_test

import (
	"fmt"
	"net/http"
	"testing"
)

func blacklistPhones(t *testing.T, e *testEnv, phones ...string) {
	t.Helper()
	admin := login(t, e, bootstrapAdminEmail)
	code, body := e.do(t, "POST", "/api/admin/phone-blacklist/import", admin, map[string]any{
		"phones":           phones,
		"resolveConflicts": true,
	})
	if code != http.StatusOK {
		t.Fatalf("blacklist import: %d %v", code, body)
	}
}

func TestBlacklistImportListDelete(t *testing.T) {
	e := setup(t)
	admin := login(t, e, bootstrapAdminEmail)

	code, body := e.do(t, "POST", "/api/admin/phone-blacklist/import", admin, map[string]any{
		"text": "09125550001\n09125550002,09125550001\n12345",
	})
	if code != http.StatusOK {
		t.Fatalf("import: %d %v", code, body)
	}
	if body["inserted"] != float64(2) {
		t.Fatalf("inserted: %v", body["inserted"])
	}
	if body["invalid"] != float64(1) {
		t.Fatalf("invalid: %v", body["invalid"])
	}

	code, body = e.do(t, "POST", "/api/admin/phone-blacklist/import", admin, map[string]any{
		"phones": []string{"09125550001", "09125550003"},
	})
	if code != http.StatusOK {
		t.Fatalf("reimport: %d %v", code, body)
	}
	if body["inserted"] != float64(1) || body["skipped"] != float64(1) {
		t.Fatalf("expected insert1 skip1, got %v", body)
	}

	code, body = e.do(t, "GET", "/api/admin/phone-blacklist", admin, nil)
	if code != http.StatusOK {
		t.Fatalf("list: %d %v", code, body)
	}
	entries := body["items"].([]any)
	if len(entries) != 3 {
		t.Fatalf("expected 3, got %d", len(entries))
	}
	id := int64(entries[0].(map[string]any)["id"].(float64))

	code, body = e.do(t, "DELETE", "/api/admin/phone-blacklist/"+itoa(id), admin, nil)
	if code != http.StatusOK {
		t.Fatalf("delete: %d %v", code, body)
	}
	code, body = e.do(t, "GET", "/api/admin/phone-blacklist", admin, nil)
	if code != http.StatusOK {
		t.Fatalf("list after delete: %d %v", code, body)
	}
	if len(body["items"].([]any)) != 2 {
		t.Fatalf("expected 2 after delete, got %v", body)
	}
}

func TestBlacklistImportBlockedWhenWhitelistedUntilForce(t *testing.T) {
	e := setup(t)
	admin := login(t, e, bootstrapAdminEmail)
	whitelistPhones(t, e, "09125550010")

	code, body := e.do(t, "POST", "/api/admin/phone-blacklist/import", admin, map[string]any{
		"phones": []string{"09125550010"},
	})
	if code != http.StatusOK {
		t.Fatalf("blacklist import: %d %v", code, body)
	}
	if body["inserted"] != float64(0) {
		t.Fatalf("inserted without resolve: %v", body["inserted"])
	}
	conflicts, ok := body["whitelistedConflicts"].([]any)
	if !ok || len(conflicts) != 1 || conflicts[0] != "09125550010" {
		t.Fatalf("whitelistedConflicts: %v", body["whitelistedConflicts"])
	}

	code, body = e.do(t, "GET", "/api/admin/phone-whitelist?status=available", admin, nil)
	if code != http.StatusOK {
		t.Fatalf("whitelist list: %d %v", code, body)
	}
	if len(body["items"].([]any)) != 1 {
		t.Fatalf("expected whitelist intact, got %v", body)
	}

	code, body = e.do(t, "POST", "/api/admin/phone-blacklist/import", admin, map[string]any{
		"phones":           []string{"09125550010"},
		"resolveConflicts": true,
	})
	if code != http.StatusOK {
		t.Fatalf("force import: %d %v", code, body)
	}
	if body["inserted"] != float64(1) {
		t.Fatalf("inserted: %v", body["inserted"])
	}
	if body["removedWhitelist"] != float64(1) {
		t.Fatalf("removedWhitelist: %v", body["removedWhitelist"])
	}

	code, body = e.do(t, "GET", "/api/admin/phone-whitelist?status=available", admin, nil)
	if code != http.StatusOK {
		t.Fatalf("whitelist list after force: %d %v", code, body)
	}
	if len(body["items"].([]any)) != 0 {
		t.Fatalf("expected whitelist cleared, got %v", body)
	}
}

func TestBlacklistImportForceAlias(t *testing.T) {
	e := setup(t)
	admin := login(t, e, bootstrapAdminEmail)
	whitelistPhones(t, e, "09125550011")

	code, body := e.do(t, "POST", "/api/admin/phone-blacklist/import", admin, map[string]any{
		"phones": []string{"09125550011"},
		"force":  true,
	})
	if code != http.StatusOK {
		t.Fatalf("force import: %d %v", code, body)
	}
	if body["inserted"] != float64(1) || body["removedWhitelist"] != float64(1) {
		t.Fatalf("force result: %v", body)
	}
}

func TestBlacklistImportRejectsConsumedWhitelist(t *testing.T) {
	e := setup(t)
	enableRegistration(t, e)
	whitelistPhones(t, e, "09125550020")
	code, body := e.doHeaders(t, "POST", "/api/auth/register", "", map[string]string{
		"X-Forwarded-For": "203.0.113.220",
	}, registerBody(t, e, "09125550020", "bl-consumed@test.dev", "blconsumed"))
	if code != http.StatusCreated {
		t.Fatalf("register: %d %v", code, body)
	}

	admin := login(t, e, bootstrapAdminEmail)
	code, body = e.do(t, "POST", "/api/admin/phone-blacklist/import", admin, map[string]any{
		"phones":           []string{"09125550020"},
		"resolveConflicts": true,
	})
	if code != http.StatusOK {
		t.Fatalf("import: %d %v", code, body)
	}
	if body["rejected"] != float64(1) || body["inserted"] != float64(0) {
		t.Fatalf("expected rejected, got %v", body)
	}
	rejectedPhones, ok := body["rejectedPhones"].([]any)
	if !ok || len(rejectedPhones) != 1 || rejectedPhones[0] != "09125550020" {
		t.Fatalf("rejectedPhones: %v", body["rejectedPhones"])
	}
}

func TestBlacklistedPhoneCannotPublicRegister(t *testing.T) {
	e := setup(t)
	enableRegistration(t, e)
	whitelistPhones(t, e, "09125550030")
	blacklistPhones(t, e, "09125550030")

	code, body := e.doHeaders(t, "POST", "/api/auth/register", "", map[string]string{
		"X-Forwarded-For": "203.0.113.230",
	}, registerBody(t, e, "09125550030", "bl-pub@test.dev", "blpub"))
	if code != http.StatusForbidden {
		t.Fatalf("expected forbidden, got %d %v", code, body)
	}
	if body["error"] != "این شماره مجاز به ثبت‌نام نیست" {
		t.Fatalf("error: %v", body["error"])
	}

	admin := login(t, e, bootstrapAdminEmail)
	code, body = e.do(t, "GET", "/api/admin/phone-blacklist/attempts?phone=09125550030", admin, nil)
	if code != http.StatusOK {
		t.Fatalf("attempts: %d %v", code, body)
	}
	entries := body["items"].([]any)
	if len(entries) != 1 {
		t.Fatalf("expected 1 attempt, got %v", body)
	}
	a := entries[0].(map[string]any)
	if a["path"] != "public" || a["phone"] != "09125550030" {
		t.Fatalf("unexpected attempt: %v", a)
	}
	if a["attemptedUsername"] != "blpub" || a["attemptedEmail"] != "bl-pub@test.dev" {
		t.Fatalf("attempt identity: %v", a)
	}
}

func TestBlacklistedPhoneCannotInviteRegister(t *testing.T) {
	e := setup(t)
	blacklistPhones(t, e, "09125550040")
	inv := createInvite(t, e, 2, "", nil)
	token := inv["token"].(string)

	code, body := e.doHeaders(t, "POST", "/api/auth/register-invite/"+token, "", map[string]string{
		"X-Forwarded-For": "203.0.113.240",
	}, registerBody(t, e, "09125550040", "bl-inv@test.dev", "blinv"))
	if code != http.StatusForbidden {
		t.Fatalf("expected forbidden, got %d %v", code, body)
	}
	if body["error"] != "این شماره مجاز به ثبت‌نام نیست" {
		t.Fatalf("error: %v", body["error"])
	}

	admin := login(t, e, bootstrapAdminEmail)
	code, body = e.do(t, "GET", "/api/admin/phone-blacklist/attempts", admin, nil)
	if code != http.StatusOK {
		t.Fatalf("attempts: %d %v", code, body)
	}
	entries := body["items"].([]any)
	if len(entries) < 1 {
		t.Fatalf("expected attempt history, got %v", body)
	}
	found := false
	for _, raw := range entries {
		a := raw.(map[string]any)
		if a["phone"] == "09125550040" && a["path"] == "invite" {
			found = true
			if a["inviteId"] == nil {
				t.Fatalf("invite attempt missing inviteId: %v", a)
			}
			break
		}
	}
	if !found {
		t.Fatalf("invite attempt not found: %v", entries)
	}
}

func TestPublicRegisterStillRequiresWhitelist(t *testing.T) {
	e := setup(t)
	enableRegistration(t, e)

	code, body := e.doHeaders(t, "POST", "/api/auth/register", "", map[string]string{
		"X-Forwarded-For": "203.0.113.250",
	}, registerBody(t, e, "09125550050", "still-wl@test.dev", "stillwl"))
	if code != http.StatusForbidden {
		t.Fatalf("expected forbidden without whitelist, got %d %v", code, body)
	}
	if body["error"] != "این شماره در فهرست مجاز نیست" {
		t.Fatalf("error: %v", body["error"])
	}
}

func TestBlacklistListPagination(t *testing.T) {
	e := setup(t)
	admin := login(t, e, bootstrapAdminEmail)

	phones := make([]string, 0, 12)
	for i := 1; i <= 12; i++ {
		phones = append(phones, fmt.Sprintf("0912556%04d", i))
	}
	code, body := e.do(t, "POST", "/api/admin/phone-blacklist/import", admin, map[string]any{
		"phones": phones,
	})
	if code != http.StatusOK {
		t.Fatalf("import: %d %v", code, body)
	}

	code, body = e.do(t, "GET", "/api/admin/phone-blacklist?page=1&pageSize=5", admin, nil)
	if code != http.StatusOK {
		t.Fatalf("list page1: %d %v", code, body)
	}
	if len(body["items"].([]any)) != 5 {
		t.Fatalf("page1 len: %d", len(body["items"].([]any)))
	}
	if body["total"] != float64(12) || body["page"] != float64(1) || body["pageSize"] != float64(5) {
		t.Fatalf("meta: %v", body)
	}

	code, body = e.do(t, "GET", "/api/admin/phone-blacklist?page=3&pageSize=5", admin, nil)
	if code != http.StatusOK {
		t.Fatalf("list page3: %d %v", code, body)
	}
	if len(body["items"].([]any)) != 2 {
		t.Fatalf("page3 len: %d", len(body["items"].([]any)))
	}

	// Seed attempts via blocked register tries.
	enableRegistration(t, e)
	for i := 1; i <= 7; i++ {
		phone := fmt.Sprintf("0912556%04d", i)
		code, _ = e.doHeaders(t, "POST", "/api/auth/register", "", map[string]string{
			"X-Forwarded-For": fmt.Sprintf("203.0.113.%d", 100+i),
		}, registerBody(t, e, phone, fmt.Sprintf("bl-page-%d@test.dev", i), fmt.Sprintf("blpage%d", i)))
		if code != http.StatusForbidden {
			t.Fatalf("expected forbidden attempt %d, got %d", i, code)
		}
	}

	code, body = e.do(t, "GET", "/api/admin/phone-blacklist/attempts?page=1&pageSize=3", admin, nil)
	if code != http.StatusOK {
		t.Fatalf("attempts page1: %d %v", code, body)
	}
	if len(body["items"].([]any)) != 3 {
		t.Fatalf("attempts page1 len: %d", len(body["items"].([]any)))
	}
	total := body["total"].(float64)
	if total < 7 {
		t.Fatalf("attempts total: %v", total)
	}
	if body["pageSize"] != float64(3) {
		t.Fatalf("attempts pageSize: %v", body["pageSize"])
	}

	code, body = e.do(t, "GET", "/api/admin/phone-blacklist/attempts?page=1&pageSize=3&q=09125560001", admin, nil)
	if code != http.StatusOK {
		t.Fatalf("filtered attempts: %d %v", code, body)
	}
	if body["total"].(float64) < 1 {
		t.Fatalf("filtered total: %v", body["total"])
	}
	for _, raw := range body["items"].([]any) {
		if raw.(map[string]any)["phone"] != "09125560001" {
			t.Fatalf("unexpected phone in filtered page: %v", raw)
		}
	}

	code, body = e.do(t, "GET", "/api/admin/phone-blacklist?page=1&pageSize=10&q=09125560002", admin, nil)
	if code != http.StatusOK {
		t.Fatalf("blacklist search: %d %v", code, body)
	}
	if body["total"] != float64(1) {
		t.Fatalf("blacklist search total: %v", body["total"])
	}
	items := body["items"].([]any)
	if len(items) != 1 || items[0].(map[string]any)["phone"] != "09125560002" {
		t.Fatalf("blacklist search items: %v", items)
	}

	code, body = e.do(t, "GET", "/api/admin/phone-blacklist?page=1", admin, nil)
	if code != http.StatusOK {
		t.Fatalf("default pageSize: %d %v", code, body)
	}
	if body["pageSize"] != float64(10) {
		t.Fatalf("expected default pageSize 10, got %v", body["pageSize"])
	}
}
