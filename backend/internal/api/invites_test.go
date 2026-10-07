package api_test

import (
	"net/http"
	"testing"
)

func createInvite(t *testing.T, e *testEnv, maxUses int, label string, expiresInDays *int) map[string]any {
	t.Helper()
	admin := login(t, e, bootstrapAdminEmail)
	body := map[string]any{"maxUses": maxUses, "label": label}
	if expiresInDays != nil {
		body["expiresInDays"] = *expiresInDays
	}
	code, resp := e.do(t, "POST", "/api/admin/invites", admin, body)
	if code != http.StatusCreated {
		t.Fatalf("create invite: %d %v", code, resp)
	}
	inv, ok := resp["invite"].(map[string]any)
	if !ok || inv["token"] == nil || inv["url"] == nil {
		t.Fatalf("missing invite token/url: %v", resp)
	}
	return inv
}

func TestInviteRegisterSuccessWhenPublicDisabled(t *testing.T) {
	e := setup(t)
	inv := createInvite(t, e, 3, "دوره بهار", nil)
	token := inv["token"].(string)

	code, body := e.do(t, "GET", "/api/auth/register-invite/"+token, "", nil)
	if code != http.StatusOK {
		t.Fatalf("invite status: %d %v", code, body)
	}
	if body["valid"] != true {
		t.Fatalf("expected valid, got %v", body)
	}
	if _, ok := body["remaining"]; ok {
		t.Fatalf("public status must not expose remaining: %v", body)
	}
	if _, ok := body["maxUses"]; ok {
		t.Fatalf("public status must not expose maxUses: %v", body)
	}
	if _, ok := body["usedCount"]; ok {
		t.Fatalf("public status must not expose usedCount: %v", body)
	}
	if body["label"] != "دوره بهار" {
		t.Fatalf("label: %v", body["label"])
	}

	code, body = e.doHeaders(t, "POST", "/api/auth/register-invite/"+token, "", map[string]string{
		"X-Forwarded-For": "203.0.113.101",
	}, registerBody(t, e, "09122220001", "inv-ok@test.dev", "invok"))
	if code != http.StatusCreated {
		t.Fatalf("invite register: %d %v", code, body)
	}
	if body["accessToken"] == nil || body["user"] == nil {
		t.Fatalf("missing session: %v", body)
	}

	code, body = e.do(t, "GET", "/api/auth/register-invite/"+token, "", nil)
	if code != http.StatusOK {
		t.Fatalf("invite status after use: %d %v", code, body)
	}
	if body["valid"] != true {
		t.Fatalf("expected still valid, got %v", body)
	}
	if _, ok := body["remaining"]; ok {
		t.Fatalf("public status must not expose remaining after use: %v", body)
	}
}

func TestInviteCapacityExhaustion(t *testing.T) {
	e := setup(t)
	inv := createInvite(t, e, 1, "", nil)
	token := inv["token"].(string)

	code, body := e.doHeaders(t, "POST", "/api/auth/register-invite/"+token, "", map[string]string{
		"X-Forwarded-For": "203.0.113.110",
	}, registerBody(t, e, "09122220010", "inv-full1@test.dev", "invfull1"))
	if code != http.StatusCreated {
		t.Fatalf("first seat: %d %v", code, body)
	}

	code, body = e.do(t, "GET", "/api/auth/register-invite/"+token, "", nil)
	if code != http.StatusGone {
		t.Fatalf("expected gone when full, got %d %v", code, body)
	}
	if body["error"] != "این لینک عضویت قابل استفاده نیست" {
		t.Fatalf("expected generic message, got %v", body["error"])
	}

	code, body = e.doHeaders(t, "POST", "/api/auth/register-invite/"+token, "", map[string]string{
		"X-Forwarded-For": "203.0.113.111",
	}, registerBody(t, e, "09122220011", "inv-full2@test.dev", "invfull2"))
	if code != http.StatusGone {
		t.Fatalf("expected capacity gone, got %d %v", code, body)
	}
}

func TestInviteRevoke(t *testing.T) {
	e := setup(t)
	inv := createInvite(t, e, 5, "لغو", nil)
	token := inv["token"].(string)
	id := int64(inv["id"].(float64))

	admin := login(t, e, bootstrapAdminEmail)
	code, body := e.do(t, "POST", "/api/admin/invites/"+itoa(id)+"/revoke", admin, nil)
	if code != http.StatusOK {
		t.Fatalf("revoke: %d %v", code, body)
	}
	revoked := body["invite"].(map[string]any)
	if revoked["status"] != "revoked" {
		t.Fatalf("expected revoked, got %v", revoked["status"])
	}

	code, body = e.do(t, "GET", "/api/auth/register-invite/"+token, "", nil)
	if code != http.StatusGone {
		t.Fatalf("expected gone after revoke, got %d %v", code, body)
	}
	if body["error"] != "این لینک عضویت قابل استفاده نیست" {
		t.Fatalf("expected generic message, got %v", body["error"])
	}
	code, body = e.doHeaders(t, "POST", "/api/auth/register-invite/"+token, "", map[string]string{
		"X-Forwarded-For": "203.0.113.120",
	}, registerBody(t, e, "09122220020", "inv-rev@test.dev", "invrev"))
	if code != http.StatusGone {
		t.Fatalf("expected register gone after revoke, got %d %v", code, body)
	}
}

func TestInviteDuplicatePhoneAndIP(t *testing.T) {
	e := setup(t)
	inv := createInvite(t, e, 5, "", nil)
	token := inv["token"].(string)

	code, body := e.doHeaders(t, "POST", "/api/auth/register-invite/"+token, "", map[string]string{
		"X-Forwarded-For": "203.0.113.130",
	}, registerBody(t, e, "09122220030", "inv-dup1@test.dev", "invdup1"))
	if code != http.StatusCreated {
		t.Fatalf("first: %d %v", code, body)
	}

	code, body = e.doHeaders(t, "POST", "/api/auth/register-invite/"+token, "", map[string]string{
		"X-Forwarded-For": "203.0.113.131",
	}, registerBody(t, e, "09122220030", "inv-dup2@test.dev", "invdup2"))
	if code != http.StatusConflict {
		t.Fatalf("expected phone conflict, got %d %v", code, body)
	}

	code, body = e.doHeaders(t, "POST", "/api/auth/register-invite/"+token, "", map[string]string{
		"X-Forwarded-For": "203.0.113.130",
	}, registerBody(t, e, "09122220031", "inv-dup3@test.dev", "invdup3"))
	if code != http.StatusConflict {
		t.Fatalf("expected IP conflict, got %d %v", code, body)
	}
}

func TestInviteAdminListAndPublicStillWorks(t *testing.T) {
	e := setup(t)
	_ = createInvite(t, e, 2, "لیست", nil)
	admin := login(t, e, bootstrapAdminEmail)
	code, body := e.do(t, "GET", "/api/admin/invites", admin, nil)
	if code != http.StatusOK {
		t.Fatalf("list: %d %v", code, body)
	}
	list, ok := body["items"].([]any)
	if !ok || len(list) < 1 {
		t.Fatalf("expected invites list, got %v", body)
	}
	first := list[0].(map[string]any)
	if first["token"] == nil || first["url"] == nil {
		t.Fatalf("list should include token/url for copy: %v", first)
	}
	if first["remaining"] != float64(2) {
		t.Fatalf("remaining: %v", first["remaining"])
	}

	enableRegistration(t, e)
	whitelistPhones(t, e, "09122220040")
	code, body = e.doHeaders(t, "POST", "/api/auth/register", "", map[string]string{
		"X-Forwarded-For": "203.0.113.140",
	}, registerBody(t, e, "09122220040", "pub-still@test.dev", "pubstill"))
	if code != http.StatusCreated {
		t.Fatalf("public register should still work: %d %v", code, body)
	}
}

func TestInviteBadToken(t *testing.T) {
	e := setup(t)
	code, body := e.do(t, "GET", "/api/auth/register-invite/not-a-real-token", "", nil)
	if code != http.StatusNotFound {
		t.Fatalf("expected not found, got %d %v", code, body)
	}
}

func TestInvitePauseResume(t *testing.T) {
	e := setup(t)
	inv := createInvite(t, e, 5, "توقف", nil)
	token := inv["token"].(string)
	id := int64(inv["id"].(float64))
	admin := login(t, e, bootstrapAdminEmail)

	code, body := e.do(t, "POST", "/api/admin/invites/"+itoa(id)+"/pause", admin, nil)
	if code != http.StatusOK {
		t.Fatalf("pause: %d %v", code, body)
	}
	paused := body["invite"].(map[string]any)
	if paused["status"] != "paused" {
		t.Fatalf("expected paused, got %v", paused["status"])
	}
	if paused["remaining"] != float64(5) {
		t.Fatalf("admin should still see remaining while paused: %v", paused["remaining"])
	}

	code, body = e.do(t, "GET", "/api/auth/register-invite/"+token, "", nil)
	if code != http.StatusGone {
		t.Fatalf("expected gone while paused, got %d %v", code, body)
	}
	if body["error"] != "این لینک عضویت قابل استفاده نیست" {
		t.Fatalf("expected generic message, got %v", body["error"])
	}

	code, body = e.doHeaders(t, "POST", "/api/auth/register-invite/"+token, "", map[string]string{
		"X-Forwarded-For": "203.0.113.150",
	}, registerBody(t, e, "09122220050", "inv-pause@test.dev", "invpause"))
	if code != http.StatusGone {
		t.Fatalf("register while paused should fail: %d %v", code, body)
	}

	code, body = e.do(t, "POST", "/api/admin/invites/"+itoa(id)+"/resume", admin, nil)
	if code != http.StatusOK {
		t.Fatalf("resume: %d %v", code, body)
	}
	resumed := body["invite"].(map[string]any)
	if resumed["status"] != "active" {
		t.Fatalf("expected active after resume, got %v", resumed["status"])
	}

	code, body = e.do(t, "GET", "/api/auth/register-invite/"+token, "", nil)
	if code != http.StatusOK || body["valid"] != true {
		t.Fatalf("expected valid after resume: %d %v", code, body)
	}

	code, body = e.doHeaders(t, "POST", "/api/auth/register-invite/"+token, "", map[string]string{
		"X-Forwarded-For": "203.0.113.151",
	}, registerBody(t, e, "09122220051", "inv-resume@test.dev", "invresume"))
	if code != http.StatusCreated {
		t.Fatalf("register after resume: %d %v", code, body)
	}
}

func TestInviteEditCapacityAndLabel(t *testing.T) {
	e := setup(t)
	inv := createInvite(t, e, 3, "قدیمی", nil)
	token := inv["token"].(string)
	id := int64(inv["id"].(float64))
	admin := login(t, e, bootstrapAdminEmail)

	code, body := e.doHeaders(t, "POST", "/api/auth/register-invite/"+token, "", map[string]string{
		"X-Forwarded-For": "203.0.113.160",
	}, registerBody(t, e, "09122220060", "inv-edit1@test.dev", "invedit1"))
	if code != http.StatusCreated {
		t.Fatalf("consume one seat: %d %v", code, body)
	}
	code, body = e.doHeaders(t, "POST", "/api/auth/register-invite/"+token, "", map[string]string{
		"X-Forwarded-For": "203.0.113.161",
	}, registerBody(t, e, "09122220061", "inv-edit2@test.dev", "invedit2"))
	if code != http.StatusCreated {
		t.Fatalf("consume second seat: %d %v", code, body)
	}

	code, body = e.do(t, "PUT", "/api/admin/invites/"+itoa(id), admin, map[string]any{
		"label":   "جدید",
		"maxUses": 1,
	})
	if code != http.StatusBadRequest {
		t.Fatalf("maxUses < usedCount should fail: %d %v", code, body)
	}

	code, body = e.do(t, "PUT", "/api/admin/invites/"+itoa(id), admin, map[string]any{
		"label":         "جدید",
		"maxUses":       4,
		"expiresInDays": 7,
	})
	if code != http.StatusOK {
		t.Fatalf("update invite: %d %v", code, body)
	}
	updated := body["invite"].(map[string]any)
	if updated["label"] != "جدید" {
		t.Fatalf("label: %v", updated["label"])
	}
	if updated["maxUses"] != float64(4) {
		t.Fatalf("maxUses: %v", updated["maxUses"])
	}
	if updated["usedCount"] != float64(2) {
		t.Fatalf("usedCount: %v", updated["usedCount"])
	}
	if updated["remaining"] != float64(2) {
		t.Fatalf("remaining: %v", updated["remaining"])
	}
	if updated["expiresAt"] == nil {
		t.Fatalf("expected expiresAt after update: %v", updated)
	}

	code, body = e.do(t, "GET", "/api/auth/register-invite/"+token, "", nil)
	if code != http.StatusOK || body["valid"] != true {
		t.Fatalf("public still valid: %d %v", code, body)
	}
	if body["label"] != "جدید" {
		t.Fatalf("public label: %v", body["label"])
	}
	if _, ok := body["maxUses"]; ok {
		t.Fatalf("public must not expose capacity: %v", body)
	}

	code, body = e.do(t, "PUT", "/api/admin/invites/"+itoa(id), admin, map[string]any{
		"clearExpires": true,
	})
	if code != http.StatusOK {
		t.Fatalf("clear expires: %d %v", code, body)
	}
	cleared := body["invite"].(map[string]any)
	if cleared["expiresAt"] != nil {
		t.Fatalf("expected nil expiresAt, got %v", cleared["expiresAt"])
	}
}

func TestInvitePublicHidesCapacity(t *testing.T) {
	e := setup(t)
	inv := createInvite(t, e, 10, "محرمانه", nil)
	token := inv["token"].(string)

	code, body := e.do(t, "GET", "/api/auth/register-invite/"+token, "", nil)
	if code != http.StatusOK {
		t.Fatalf("status: %d %v", code, body)
	}
	for _, key := range []string{"remaining", "maxUses", "usedCount", "expiresAt"} {
		if _, ok := body[key]; ok {
			t.Fatalf("public payload must not include %s: %v", key, body)
		}
	}
	if body["valid"] != true || body["label"] != "محرمانه" {
		t.Fatalf("expected valid+label only essentials: %v", body)
	}
}

func TestInviteListPaginationAndSearch(t *testing.T) {
	e := setup(t)
	admin := login(t, e, bootstrapAdminEmail)

	for i := 1; i <= 12; i++ {
		label := "عمومی"
		if i == 3 {
			label = "دوره پاییز ویژه"
		}
		_ = createInvite(t, e, 1, label, nil)
	}

	code, body := e.do(t, "GET", "/api/admin/invites?page=1&pageSize=5", admin, nil)
	if code != http.StatusOK {
		t.Fatalf("page1: %d %v", code, body)
	}
	if len(body["items"].([]any)) != 5 {
		t.Fatalf("page1 len: %d", len(body["items"].([]any)))
	}
	if body["total"].(float64) < 12 || body["page"] != float64(1) || body["pageSize"] != float64(5) {
		t.Fatalf("page1 meta: %v", body)
	}

	code, body = e.do(t, "GET", "/api/admin/invites?page=1", admin, nil)
	if code != http.StatusOK {
		t.Fatalf("default pageSize: %d %v", code, body)
	}
	if body["pageSize"] != float64(10) {
		t.Fatalf("expected default pageSize 10, got %v", body["pageSize"])
	}

	code, body = e.do(t, "GET", "/api/admin/invites?page=1&pageSize=10&q=پاییز", admin, nil)
	if code != http.StatusOK {
		t.Fatalf("search: %d %v", code, body)
	}
	if body["total"] != float64(1) {
		t.Fatalf("search total: %v", body["total"])
	}
	items := body["items"].([]any)
	if len(items) != 1 || items[0].(map[string]any)["label"] != "دوره پاییز ویژه" {
		t.Fatalf("search items: %v", items)
	}
}
