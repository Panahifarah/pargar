package api_test

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"testing"
	"time"
)

func (e *testEnv) doRaw(t *testing.T, method, path, token string, body any) (int, string, []byte) {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req, _ := http.NewRequest(method, e.server.URL+path, &buf)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, resp.Header.Get("Content-Type"), raw
}

func readZipManifest(t *testing.T, raw []byte) (map[string]any, *zip.Reader) {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		t.Fatalf("zip open: %v", err)
	}
	for _, f := range zr.File {
		if f.Name != "manifest.json" {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			t.Fatalf("manifest open: %v", err)
		}
		defer rc.Close()
		var out map[string]any
		if err := json.NewDecoder(rc).Decode(&out); err != nil {
			t.Fatalf("manifest json: %v", err)
		}
		return out, zr
	}
	t.Fatal("manifest.json missing")
	return nil, nil
}

func TestAdminChatExportAccess(t *testing.T) {
	e := setup(t)
	student, studentID := register(t, e, "Export Student", "export-student@test.dev")
	admin := login(t, e, bootstrapAdminEmail)

	code, body := e.do(t, "POST", "/api/admin/users", admin, map[string]any{
		"name": "Mentor Export", "email": "mentor-export@test.dev", "username": "mentorexport", "password": "password123", "role": "mentor",
		"securityQuestion": "نام حیوان خانگی؟", "securityAnswer": "rex",
	})
	if code != http.StatusCreated {
		t.Fatalf("create mentor: %d %v", code, body)
	}
	mentorID := int64(body["user"].(map[string]any)["id"].(float64))
	mentor := login(t, e, "mentor-export@test.dev")

	code, body = e.do(t, "POST", "/api/chats/"+itoa(mentorID)+"/messages", student, map[string]any{"body": "سلام آرشیو"})
	if code != http.StatusCreated {
		t.Fatalf("send: %d %v", code, body)
	}
	_ = studentID

	code, _ = e.do(t, "GET", "/api/admin/chat-export", student, nil)
	if code != http.StatusForbidden {
		t.Fatalf("student export: want 403 got %d", code)
	}

	code, _ = e.do(t, "GET", "/api/admin/chat-export", mentor, nil)
	if code != http.StatusForbidden {
		t.Fatalf("mentor export: want 403 got %d", code)
	}

	code, ct, raw := e.doRaw(t, "GET", "/api/admin/chat-export", admin, nil)
	if code != http.StatusOK {
		t.Fatalf("admin export: %d %s", code, string(raw))
	}
	if !strings.Contains(ct, "application/zip") {
		t.Fatalf("content-type: %s", ct)
	}
	dump, zr := readZipManifest(t, raw)
	if int(dump["version"].(float64)) != 4 {
		t.Fatalf("version: %v", dump["version"])
	}
	if dump["schema"] != "pargar.chat-export" {
		t.Fatalf("schema: %v", dump["schema"])
	}
	if dump["format"] != "zip" {
		t.Fatalf("format: %v", dump["format"])
	}
	convs, _ := dump["conversations"].([]any)
	if len(convs) == 0 {
		t.Fatal("expected conversations in project export")
	}
	first := convs[0].(map[string]any)
	if first["participants"] == nil {
		t.Fatal("expected participants object")
	}
	msgs, _ := first["messages"].([]any)
	if len(msgs) == 0 {
		t.Fatal("expected messages")
	}
	msg0 := msgs[0].(map[string]any)
	if msg0["id"] == nil || msg0["createdAt"] == nil || msg0["senderRole"] == nil {
		t.Fatalf("message missing structured fields: %v", msg0)
	}
	_ = zr

	// Restore via ZIP bytes
	req, _ := http.NewRequest("POST", e.server.URL+"/api/admin/chat-export/restore", bytes.NewReader(raw))
	req.Header.Set("Authorization", "Bearer "+admin)
	req.Header.Set("Content-Type", "application/zip")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("restore request: %v", err)
	}
	defer resp.Body.Close()
	var restored map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&restored)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("restore: %d %v", resp.StatusCode, restored)
	}
	if int(restored["imported"].(float64)) < 1 {
		t.Fatalf("expected imported >= 1, got %v", restored["imported"])
	}

	code, statsBody := e.do(t, "GET", "/api/admin/chat-export/stats", admin, nil)
	if code != http.StatusOK {
		t.Fatalf("stats: %d %v", code, statsBody)
	}
	stats, _ := statsBody["stats"].(map[string]any)
	if stats == nil {
		t.Fatalf("expected stats object: %v", statsBody)
	}
	if int(stats["conversationCount"].(float64)) < 1 {
		t.Fatalf("conversationCount: %v", stats["conversationCount"])
	}
	if int(stats["messageCount"].(float64)) < 1 {
		t.Fatalf("messageCount: %v", stats["messageCount"])
	}
	if int(stats["estimatedBytes"].(float64)) < 1 {
		t.Fatalf("estimatedBytes: %v", stats["estimatedBytes"])
	}
	code, _ = e.do(t, "GET", "/api/admin/chat-export/stats", student, nil)
	if code != http.StatusForbidden {
		t.Fatalf("student stats: want 403 got %d", code)
	}

	code, _ = e.do(t, "GET", "/api/chats/backup", student, nil)
	if code != http.StatusNotFound && code != http.StatusMethodNotAllowed {
		t.Fatalf("legacy backup should be unavailable, got %d", code)
	}
	code, _ = e.do(t, "GET", "/api/admin/chat-dump", admin, nil)
	if code != http.StatusNotFound && code != http.StatusMethodNotAllowed {
		t.Fatalf("legacy chat-dump path should be gone, got %d", code)
	}
}

func TestChatExportZipIncludesAttachment(t *testing.T) {
	e := setup(t)
	student, studentID := register(t, e, "Att Export Student", "att-export@test.dev")
	admin := login(t, e, bootstrapAdminEmail)
	code, body := e.do(t, "POST", "/api/admin/users", admin, map[string]any{
		"name": "Mentor Att", "email": "mentor-att@test.dev", "username": "mentoratt", "password": "password123", "role": "mentor",
		"securityQuestion": "نام حیوان خانگی؟", "securityAnswer": "rex",
	})
	if code != http.StatusCreated {
		t.Fatalf("create mentor: %d %v", code, body)
	}
	mentorID := int64(body["user"].(map[string]any)["id"].(float64))

	mediaName := "hello-export.txt"
	mediaBytes := []byte("attachment-bytes-for-export")
	code, up := uploadChatFile(t, e, student, mediaName, mediaBytes)
	if code != http.StatusCreated {
		t.Fatalf("upload: %d %v", code, up)
	}
	att, _ := up["attachment"].(map[string]any)
	if att == nil || att["url"] == "" {
		t.Fatalf("missing attachment url: %v", up)
	}

	code, body = e.do(t, "POST", "/api/chats/"+itoa(mentorID)+"/messages", student, map[string]any{
		"body":       "با پیوست",
		"attachment": att,
	})
	if code != http.StatusCreated {
		t.Fatalf("send with att: %d %v", code, body)
	}
	_ = studentID

	code, ct, raw := e.doRaw(t, "GET", "/api/admin/chat-export", admin, nil)
	if code != http.StatusOK {
		t.Fatalf("export: %d %s", code, string(raw))
	}
	if !strings.Contains(ct, "zip") {
		t.Fatalf("ct: %s", ct)
	}
	dump, zr := readZipManifest(t, raw)
	convs := dump["conversations"].([]any)
	foundPath := ""
	for _, c := range convs {
		cm := c.(map[string]any)
		for _, m := range cm["messages"].([]any) {
			mm := m.(map[string]any)
			a, _ := mm["attachment"].(map[string]any)
			if a == nil {
				continue
			}
			if p, _ := a["path"].(string); p != "" {
				foundPath = p
			}
			if a["missing"] == true {
				t.Fatalf("attachment marked missing: %v", a)
			}
		}
	}
	if foundPath == "" {
		t.Fatal("expected attachment path in manifest")
	}
	var foundInZip bool
	for _, f := range zr.File {
		if f.Name == foundPath {
			foundInZip = true
			rc, err := f.Open()
			if err != nil {
				t.Fatal(err)
			}
			got, _ := io.ReadAll(rc)
			_ = rc.Close()
			if !bytes.Equal(got, mediaBytes) {
				t.Fatalf("attachment bytes mismatch: %q", got)
			}
		}
	}
	if !foundInZip {
		t.Fatalf("zip missing %s", foundPath)
	}
}

func TestChatExportTokenDownload(t *testing.T) {
	e := setup(t)
	student, _ := register(t, e, "Tok Export Student", "tok-export@test.dev")
	admin := login(t, e, bootstrapAdminEmail)
	code, body := e.do(t, "POST", "/api/admin/users", admin, map[string]any{
		"name": "Mentor Tok", "email": "mentor-tok@test.dev", "username": "mentortok", "password": "password123", "role": "mentor",
		"securityQuestion": "نام حیوان خانگی؟", "securityAnswer": "rex",
	})
	if code != http.StatusCreated {
		t.Fatalf("create mentor: %d %v", code, body)
	}
	mentorID := int64(body["user"].(map[string]any)["id"].(float64))
	code, body = e.do(t, "POST", "/api/chats/"+itoa(mentorID)+"/messages", student, map[string]any{"body": "token export msg"})
	if code != http.StatusCreated {
		t.Fatalf("send: %d %v", code, body)
	}

	code, _ = e.do(t, "POST", "/api/admin/chat-export/tokens", student, map[string]any{"expiresInHours": 1})
	if code != http.StatusForbidden {
		t.Fatalf("student create token: want 403 got %d", code)
	}

	code, created := e.do(t, "POST", "/api/admin/chat-export/tokens", admin, map[string]any{
		"expiresInHours": 1,
		"label":          "تست لینک",
	})
	if code != http.StatusCreated {
		t.Fatalf("create token: %d %v", code, created)
	}
	tokObj := created["token"].(map[string]any)
	rawToken, _ := tokObj["token"].(string)
	url, _ := tokObj["url"].(string)
	tokenID := int64(tokObj["id"].(float64))
	if rawToken == "" || url == "" {
		t.Fatalf("missing token/url: %v", tokObj)
	}
	if !strings.Contains(url, "/api/exports/chats/") {
		t.Fatalf("unexpected url shape: %s", url)
	}

	code, ct, raw := e.doRaw(t, "GET", "/api/exports/chats/"+rawToken, "", nil)
	if code != http.StatusOK {
		t.Fatalf("token download: %d %s", code, string(raw))
	}
	if !strings.Contains(ct, "zip") {
		t.Fatalf("content-type: %s", ct)
	}
	dump, _ := readZipManifest(t, raw)
	convs, _ := dump["conversations"].([]any)
	if len(convs) == 0 {
		t.Fatal("expected conversations from token download")
	}

	code, _, _ = e.doRaw(t, "GET", "/api/exports/chats/"+rawToken, "", nil)
	if code != http.StatusUnauthorized {
		t.Fatalf("second download should be single-use 401: got %d", code)
	}

	code, listed := e.do(t, "GET", "/api/admin/chat-export/tokens", admin, nil)
	if code != http.StatusOK {
		t.Fatalf("list tokens: %d %v", code, listed)
	}
	items, _ := listed["items"].([]any)
	if len(items) == 0 {
		t.Fatal("expected listed tokens")
	}

	code, revoked := e.do(t, "POST", "/api/admin/chat-export/tokens/"+itoa(tokenID)+"/revoke", admin, nil)
	if code != http.StatusOK {
		t.Fatalf("revoke: %d %v", code, revoked)
	}
	code, _, _ = e.doRaw(t, "GET", "/api/exports/chats/"+rawToken, "", nil)
	if code != http.StatusUnauthorized {
		t.Fatalf("revoked: want 401 got %d", code)
	}
}

func TestChatExportTokenExpired(t *testing.T) {
	e := setup(t)
	admin := login(t, e, bootstrapAdminEmail)

	code, created := e.do(t, "POST", "/api/admin/chat-export/tokens", admin, map[string]any{"expiresInHours": 1})
	if code != http.StatusCreated {
		t.Fatalf("create: %d %v", code, created)
	}
	tokObj := created["token"].(map[string]any)
	rawToken := tokObj["token"].(string)
	id := int64(tokObj["id"].(float64))

	_, err := e.pool.Exec(context.Background(), `
		UPDATE chat_export_tokens SET expires_at = $1 WHERE id = $2`,
		time.Now().UTC().Add(-time.Minute), id)
	if err != nil {
		t.Fatalf("force expire: %v", err)
	}

	code, _, _ = e.doRaw(t, "GET", "/api/exports/chats/"+rawToken, "", nil)
	if code != http.StatusUnauthorized {
		t.Fatalf("expired: want 401 got %d", code)
	}

	code, _, _ = e.doRaw(t, "GET", "/api/exports/chats/not-a-real-token", "", nil)
	if code != http.StatusUnauthorized {
		t.Fatalf("bogus token: want 401 got %d", code)
	}

	code, _ = e.do(t, "POST", "/api/admin/chat-export/tokens", admin, map[string]any{"expiresInHours": 12})
	if code != http.StatusBadRequest {
		t.Fatalf("invalid hours: want 400 got %d", code)
	}
}

// --- helpers for multipart chat upload in tests ---

func uploadChatFile(t *testing.T, e *testEnv, token, filename string, content []byte) (int, map[string]any) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	part, err := mw.CreateFormFile("file", filename)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(content); err != nil {
		t.Fatal(err)
	}
	_ = mw.Close()
	req, _ := http.NewRequest("POST", e.server.URL+"/api/chats/upload", &buf)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out
}
