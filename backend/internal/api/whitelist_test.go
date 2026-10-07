package api_test

import (
	"fmt"
	"net/http"
	"testing"
)

func TestWhitelistImportListDelete(t *testing.T) {
	e := setup(t)
	admin := login(t, e, bootstrapAdminEmail)

	code, body := e.do(t, "POST", "/api/admin/phone-whitelist/import", admin, map[string]any{
		"text": "09123330001\n09123330002,09123330001\n12345",
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

	code, body = e.do(t, "POST", "/api/admin/phone-whitelist/import", admin, map[string]any{
		"phones": []string{"09123330001", "09123330003"},
	})
	if code != http.StatusOK {
		t.Fatalf("reimport: %d %v", code, body)
	}
	if body["inserted"] != float64(1) || body["skipped"] != float64(1) {
		t.Fatalf("expected insert1 skip1, got %v", body)
	}

	code, body = e.do(t, "GET", "/api/admin/phone-whitelist?status=available", admin, nil)
	if code != http.StatusOK {
		t.Fatalf("list: %d %v", code, body)
	}
	entries := body["items"].([]any)
	if len(entries) != 3 {
		t.Fatalf("expected 3 available, got %d", len(entries))
	}
	if body["total"] != float64(3) {
		t.Fatalf("total: %v", body["total"])
	}
	id := int64(entries[0].(map[string]any)["id"].(float64))

	code, body = e.do(t, "DELETE", "/api/admin/phone-whitelist/"+itoa(id), admin, nil)
	if code != http.StatusOK {
		t.Fatalf("delete: %d %v", code, body)
	}
	code, body = e.do(t, "GET", "/api/admin/phone-whitelist?status=available", admin, nil)
	if code != http.StatusOK {
		t.Fatalf("list after delete: %d %v", code, body)
	}
	if len(body["items"].([]any)) != 2 {
		t.Fatalf("expected 2 after delete, got %v", body)
	}
}

func TestInviteRegisterWithoutWhitelistOK(t *testing.T) {
	e := setup(t)
	inv := createInvite(t, e, 2, "", nil)
	token := inv["token"].(string)

	code, body := e.doHeaders(t, "POST", "/api/auth/register-invite/"+token, "", map[string]string{
		"X-Forwarded-For": "203.0.113.201",
	}, registerBody(t, e, "09124440001", "inv-nowl@test.dev", "invnowl"))
	if code != http.StatusCreated {
		t.Fatalf("invite without whitelist should work: %d %v", code, body)
	}
}

func TestInviteRegisterConsumesWhitelist(t *testing.T) {
	e := setup(t)
	whitelistPhones(t, e, "09124440010")
	inv := createInvite(t, e, 2, "", nil)
	token := inv["token"].(string)

	code, body := e.doHeaders(t, "POST", "/api/auth/register-invite/"+token, "", map[string]string{
		"X-Forwarded-For": "203.0.113.202",
	}, registerBody(t, e, "09124440010", "inv-wl@test.dev", "invwl"))
	if code != http.StatusCreated {
		t.Fatalf("invite register: %d %v", code, body)
	}

	enableRegistration(t, e)
	code, body = e.doHeaders(t, "POST", "/api/auth/register", "", map[string]string{
		"X-Forwarded-For": "203.0.113.203",
	}, registerBody(t, e, "09124440010", "pub-after-inv@test.dev", "pubafterinv"))
	if code != http.StatusConflict {
		t.Fatalf("expected conflict after invite consumed phone, got %d %v", code, body)
	}

	admin := login(t, e, bootstrapAdminEmail)
	code, body = e.do(t, "GET", "/api/admin/phone-whitelist?status=consumed", admin, nil)
	if code != http.StatusOK {
		t.Fatalf("list consumed: %d %v", code, body)
	}
	entries := body["items"].([]any)
	if len(entries) != 1 {
		t.Fatalf("expected consumed entry, got %v", body)
	}
	if entries[0].(map[string]any)["phone"] != "09124440010" {
		t.Fatalf("phone: %v", entries[0])
	}
}

func TestPublicRegisterAfterWhitelistConsumeFails(t *testing.T) {
	e := setup(t)
	enableRegistration(t, e)
	whitelistPhones(t, e, "09124440020")

	code, body := e.doHeaders(t, "POST", "/api/auth/register", "", map[string]string{
		"X-Forwarded-For": "203.0.113.210",
	}, registerBody(t, e, "09124440020", "wl-once@test.dev", "wlonce"))
	if code != http.StatusCreated {
		t.Fatalf("first: %d %v", code, body)
	}

	// Re-import same phone is skipped (already exists as consumed), so second public
	// attempt hits phone uniqueness — still blocked.
	code, body = e.doHeaders(t, "POST", "/api/auth/register", "", map[string]string{
		"X-Forwarded-For": "203.0.113.211",
	}, registerBody(t, e, "09124440020", "wl-twice@test.dev", "wltwice"))
	if code != http.StatusConflict {
		t.Fatalf("expected second use blocked, got %d %v", code, body)
	}
}

func TestWhitelistImportBlockedWhenBlacklistedUntilForce(t *testing.T) {
	e := setup(t)
	admin := login(t, e, bootstrapAdminEmail)

	code, body := e.do(t, "POST", "/api/admin/phone-blacklist/import", admin, map[string]any{
		"phones": []string{"09123330100"},
	})
	if code != http.StatusOK {
		t.Fatalf("blacklist seed: %d %v", code, body)
	}

	code, body = e.do(t, "POST", "/api/admin/phone-whitelist/import", admin, map[string]any{
		"phones": []string{"09123330100", "09123330101"},
	})
	if code != http.StatusOK {
		t.Fatalf("whitelist import: %d %v", code, body)
	}
	if body["inserted"] != float64(1) {
		t.Fatalf("inserted without resolve: %v", body["inserted"])
	}
	conflicts, ok := body["blacklistedConflicts"].([]any)
	if !ok || len(conflicts) != 1 || conflicts[0] != "09123330100" {
		t.Fatalf("blacklistedConflicts: %v", body["blacklistedConflicts"])
	}

	code, body = e.do(t, "GET", "/api/admin/phone-blacklist", admin, nil)
	if code != http.StatusOK {
		t.Fatalf("blacklist list: %d %v", code, body)
	}
	if body["total"] != float64(1) {
		t.Fatalf("expected blacklist intact, got %v", body)
	}

	code, body = e.do(t, "POST", "/api/admin/phone-whitelist/import", admin, map[string]any{
		"phones":           []string{"09123330100"},
		"resolveConflicts": true,
	})
	if code != http.StatusOK {
		t.Fatalf("force whitelist import: %d %v", code, body)
	}
	if body["inserted"] != float64(1) {
		t.Fatalf("inserted: %v", body["inserted"])
	}
	if body["removedBlacklist"] != float64(1) {
		t.Fatalf("removedBlacklist: %v", body["removedBlacklist"])
	}

	code, body = e.do(t, "GET", "/api/admin/phone-blacklist", admin, nil)
	if code != http.StatusOK {
		t.Fatalf("blacklist after force: %d %v", code, body)
	}
	if body["total"] != float64(0) {
		t.Fatalf("expected blacklist cleared, got %v", body)
	}

	code, body = e.do(t, "GET", "/api/admin/phone-whitelist?q=09123330100", admin, nil)
	if code != http.StatusOK {
		t.Fatalf("whitelist after force: %d %v", code, body)
	}
	if body["total"] != float64(1) {
		t.Fatalf("expected phone on whitelist, got %v", body)
	}
}

func TestWhitelistImportForceAlias(t *testing.T) {
	e := setup(t)
	admin := login(t, e, bootstrapAdminEmail)
	code, body := e.do(t, "POST", "/api/admin/phone-blacklist/import", admin, map[string]any{
		"phones": []string{"09123330110"},
	})
	if code != http.StatusOK {
		t.Fatalf("blacklist seed: %d %v", code, body)
	}

	code, body = e.do(t, "POST", "/api/admin/phone-whitelist/import", admin, map[string]any{
		"phones": []string{"09123330110"},
		"force":  true,
	})
	if code != http.StatusOK {
		t.Fatalf("force import: %d %v", code, body)
	}
	if body["inserted"] != float64(1) || body["removedBlacklist"] != float64(1) {
		t.Fatalf("force result: %v", body)
	}
}

func TestWhitelistListPagination(t *testing.T) {
	e := setup(t)
	admin := login(t, e, bootstrapAdminEmail)

	phones := make([]string, 0, 25)
	for i := 1; i <= 25; i++ {
		phones = append(phones, fmt.Sprintf("0912334%04d", i))
	}
	code, body := e.do(t, "POST", "/api/admin/phone-whitelist/import", admin, map[string]any{
		"phones": phones,
	})
	if code != http.StatusOK {
		t.Fatalf("import: %d %v", code, body)
	}
	if body["inserted"] != float64(25) {
		t.Fatalf("inserted: %v", body["inserted"])
	}

	code, body = e.do(t, "GET", "/api/admin/phone-whitelist?page=1&pageSize=10&status=available", admin, nil)
	if code != http.StatusOK {
		t.Fatalf("page1: %d %v", code, body)
	}
	items := body["items"].([]any)
	if len(items) != 10 {
		t.Fatalf("page1 len: %d", len(items))
	}
	if body["total"] != float64(25) || body["page"] != float64(1) || body["pageSize"] != float64(10) {
		t.Fatalf("page1 meta: %v", body)
	}

	code, body = e.do(t, "GET", "/api/admin/phone-whitelist?page=3&pageSize=10&status=available", admin, nil)
	if code != http.StatusOK {
		t.Fatalf("page3: %d %v", code, body)
	}
	items = body["items"].([]any)
	if len(items) != 5 {
		t.Fatalf("page3 len: %d", len(items))
	}
	if body["total"] != float64(25) || body["page"] != float64(3) {
		t.Fatalf("page3 meta: %v", body)
	}

	code, body = e.do(t, "GET", "/api/admin/phone-whitelist?page=1&pageSize=500&status=available", admin, nil)
	if code != http.StatusOK {
		t.Fatalf("capped: %d %v", code, body)
	}
	if body["pageSize"] != float64(100) {
		t.Fatalf("expected pageSize capped to 100, got %v", body["pageSize"])
	}
	if len(body["items"].([]any)) != 25 {
		t.Fatalf("capped list len: %d", len(body["items"].([]any)))
	}

	code, body = e.do(t, "GET", "/api/admin/phone-whitelist?page=1&pageSize=10&q=09123340001", admin, nil)
	if code != http.StatusOK {
		t.Fatalf("search: %d %v", code, body)
	}
	if body["total"] != float64(1) {
		t.Fatalf("search total: %v", body["total"])
	}
	items = body["items"].([]any)
	if len(items) != 1 || items[0].(map[string]any)["phone"] != "09123340001" {
		t.Fatalf("search items: %v", items)
	}

	code, body = e.do(t, "GET", "/api/admin/phone-whitelist?page=1", admin, nil)
	if code != http.StatusOK {
		t.Fatalf("default pageSize: %d %v", code, body)
	}
	if body["pageSize"] != float64(10) {
		t.Fatalf("expected default pageSize 10, got %v", body["pageSize"])
	}
}

func TestWhitelistImportRejectsExistingUserPhone(t *testing.T) {
	e := setup(t)
	admin := login(t, e, bootstrapAdminEmail)

	code, body := e.do(t, "POST", "/api/admin/users", admin, map[string]any{
		"name": "کاربر WL", "email": "wl-exist@test.dev", "username": "wlexist",
		"password": "password123", "role": "student",
		"phone": "09123330999", "securityQuestion": "رنگ؟", "securityAnswer": "آبی",
	})
	if code != http.StatusCreated {
		t.Fatalf("create user: %d %v", code, body)
	}

	code, body = e.do(t, "POST", "/api/admin/phone-whitelist/import", admin, map[string]any{
		"phones": []string{"09123330999", "09123330998"},
	})
	if code != http.StatusOK {
		t.Fatalf("whitelist import: %d %v", code, body)
	}
	if body["inserted"] != float64(1) {
		t.Fatalf("inserted: %v", body["inserted"])
	}
	if body["rejected"] != float64(1) {
		t.Fatalf("rejected: %v", body["rejected"])
	}
	rejected, _ := body["rejectedPhones"].([]any)
	if len(rejected) != 1 || rejected[0] != "09123330999" {
		t.Fatalf("rejectedPhones: %v", body["rejectedPhones"])
	}
}
