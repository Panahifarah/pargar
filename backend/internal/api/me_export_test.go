package api_test

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base64"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestMeChatHTMLZipExport(t *testing.T) {
	e := setup(t)
	student, studentID := register(t, e, "Export Student", "me-export@test.dev")
	other, otherID := register(t, e, "Other Student", "me-export-other@test.dev")
	admin := login(t, e, bootstrapAdminEmail)
	code, body := e.do(t, "POST", "/api/admin/users", admin, map[string]any{
		"name": "Mentor Export", "email": "mentor-export@test.dev", "username": "mentorexport",
		"password": "password123", "role": "mentor",
		"securityQuestion": "نام حیوان خانگی؟", "securityAnswer": "rex",
	})
	if code != http.StatusCreated {
		t.Fatalf("create mentor: %d %v", code, body)
	}
	mentorID := int64(body["user"].(map[string]any)["id"].(float64))
	mentor := login(t, e, "mentor-export@test.dev")

	png, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
	if err != nil || len(png) < 8 {
		t.Fatalf("png: %v len=%d", err, len(png))
	}
	wav := make([]byte, 44)
	copy(wav, []byte("RIFF"))
	copy(wav[8:], []byte("WAVE"))
	note := []byte("note-bytes")

	code, upImg := uploadChatFile(t, e, student, "shot.png", png)
	if code != http.StatusCreated {
		t.Fatalf("png upload: %d %v", code, upImg)
	}
	code, upNote := uploadChatFile(t, e, student, "notes.txt", note)
	if code != http.StatusCreated {
		t.Fatalf("txt upload: %d %v", code, upNote)
	}
	code, upVoice := uploadChatFile(t, e, student, "voice-note.wav", wav)
	if code != http.StatusCreated {
		t.Fatalf("wav upload: %d %v", code, upVoice)
	}

	code, sent := e.do(t, "POST", "/api/chats/"+itoa(mentorID)+"/messages", student, map[string]any{
		"body":        "<b>راز</b>\nخط دوم",
		"attachments": []any{upImg["attachment"], upNote["attachment"]},
	})
	if code != http.StatusCreated {
		t.Fatalf("send: %d %v", code, sent)
	}
	msgID := int64(sent["message"].(map[string]any)["id"].(float64))
	if _, err := e.pool.Exec(context.Background(), `UPDATE chat_messages SET created_at = $1 WHERE id = $2`, "2026-03-21 12:00:00+00", msgID); err != nil {
		t.Fatal(err)
	}
	code, voice := e.do(t, "POST", "/api/chats/"+itoa(mentorID)+"/messages", student, map[string]any{
		"body":       "صدا",
		"attachment": upVoice["attachment"],
	})
	if code != http.StatusCreated {
		t.Fatalf("voice: %d %v", code, voice)
	}
	if _, err := e.pool.Exec(context.Background(), `
		INSERT INTO chat_messages (user_id, mentor_id, sender_role, body, attachment_type, attachment_url, attachment_name, attachment_size)
		VALUES ($1, $2, 'student', 'گمشده', 'audio', 'http://localhost:8080/media/chats/999-missing.wav', 'gone.wav', 5000)`,
		studentID, mentorID); err != nil {
		t.Fatal(err)
	}
	code, saved := e.do(t, "POST", "/api/chats/"+itoa(studentID)+"/messages", student, map[string]any{"body": "یادداشت خصوصی"})
	if code != http.StatusCreated {
		t.Fatalf("saved: %d %v", code, saved)
	}
	code, reply := e.do(t, "POST", "/api/chats/"+itoa(studentID)+"/messages", mentor, map[string]any{"body": "از منتور"})
	if code != http.StatusCreated {
		t.Fatalf("reply: %d %v", code, reply)
	}

	code, _ = e.do(t, "GET", "/api/me/export?meta=1", student, nil)
	if code != http.StatusBadRequest {
		t.Fatalf("meta without chat: %d", code)
	}
	code, _, raw := e.doRaw(t, "GET", "/api/me/export", student, nil)
	if code != http.StatusBadRequest || (len(raw) >= 2 && raw[0] == 'P' && raw[1] == 'K') {
		t.Fatalf("export without chat should not be a zip: %d", code)
	}

	code, meta := e.do(t, "GET", "/api/me/export?meta=1&chat="+itoa(mentorID), student, nil)
	if code != http.StatusOK {
		t.Fatalf("meta: %d %v", code, meta)
	}
	approx := int64(meta["bytes"].(float64))
	floor := int64(len(png) + len(wav) + len(note) + 5000)
	if approx < floor {
		t.Fatalf("estimate %d < media floor %d", approx, floor)
	}
	if int64(meta["chat"].(float64)) != mentorID {
		t.Fatalf("meta chat: %v", meta["chat"])
	}
	code, savedMeta := e.do(t, "GET", "/api/me/export?meta=1&chat="+itoa(studentID), student, nil)
	if code != http.StatusOK || int64(savedMeta["bytes"].(float64)) >= approx {
		t.Fatalf("saved meta should be only that chat: %d %v", code, savedMeta)
	}

	code, ct, raw := e.doRaw(t, "GET", "/api/me/export?chat="+itoa(mentorID), student, nil)
	if code != http.StatusOK {
		t.Fatalf("zip: %d %s", code, ct)
	}
	if ct != "application/zip" || len(raw) < 2 || raw[0] != 'P' || raw[1] != 'K' {
		t.Fatalf("not a zip: %s %d", ct, len(raw))
	}
	zr, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		t.Fatal(err)
	}
	var htmlDoc string
	var sawImage, sawAudio, sawNote bool
	for _, f := range zr.File {
		if strings.Contains(f.Name, "gone.wav") || strings.Contains(f.Name, "missing") {
			t.Fatalf("missing media was packed: %s", f.Name)
		}
		rc, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		blob, _ := io.ReadAll(rc)
		_ = rc.Close()
		switch {
		case f.Name == "index.html":
			htmlDoc = string(blob)
		case strings.HasSuffix(f.Name, ".png"):
			sawImage = bytes.Equal(blob, png)
		case strings.HasSuffix(f.Name, ".wav"):
			sawAudio = bytes.Equal(blob, wav)
		case strings.HasSuffix(f.Name, ".txt"):
			sawNote = bytes.Equal(blob, note)
		}
	}
	if htmlDoc == "" || !sawImage || !sawAudio || !sawNote {
		t.Fatalf("zip parts image=%v audio=%v note=%v html=%d", sawImage, sawAudio, sawNote, len(htmlDoc))
	}
	if !strings.Contains(htmlDoc, `lang="fa"`) || !strings.Contains(htmlDoc, `dir="rtl"`) {
		t.Fatal("html is not a persian rtl document")
	}
	if strings.Contains(htmlDoc, "<b>راز") || !strings.Contains(htmlDoc, "&lt;b&gt;راز&lt;/b&gt;") {
		t.Fatal("user text was not escaped")
	}
	if !strings.Contains(htmlDoc, "&lt;b&gt;راز&lt;/b&gt;\nخط دوم") {
		t.Fatal("newline was not kept in the bubble")
	}
	if !strings.Contains(htmlDoc, "white-space: pre-wrap") {
		t.Fatal("bubble text does not keep whitespace")
	}
	if !strings.Contains(htmlDoc, `class="msg mine"`) || !strings.Contains(htmlDoc, `class="msg theirs"`) {
		t.Fatal("own and partner bubbles are missing")
	}
	if !strings.Contains(htmlDoc, "#6d63f0") {
		t.Fatal("own bubble is not the chat primary color")
	}
	if !strings.Contains(htmlDoc, ">Mentor Export</h1>") || !strings.Contains(htmlDoc, "Export Student") || !strings.Contains(htmlDoc, "از منتور") {
		t.Fatal("single conversation header or sender names missing")
	}
	if strings.Contains(htmlDoc, "یادداشت خصوصی") || strings.Contains(htmlDoc, "گفتگوهای پرگار") {
		t.Fatal("export included another conversation")
	}
	if !strings.Contains(htmlDoc, "<img ") || !strings.Contains(htmlDoc, `src="media/`) {
		t.Fatal("image is not inlined with a relative src")
	}
	if !strings.Contains(htmlDoc, "<audio controls") {
		t.Fatal("voice has no native audio control")
	}
	if !strings.Contains(htmlDoc, "<a href=\"media/") {
		t.Fatal("other file is not a relative link")
	}
	if !strings.Contains(htmlDoc, "۱ فروردین · ۱۵:۳۰") {
		t.Fatal("jalali stamp missing")
	}
	if !strings.Contains(htmlDoc, "فایل همراه موجود نیست") || !strings.Contains(htmlDoc, "gone.wav") {
		t.Fatal("missing file was not reported in the transcript")
	}

	code, ct, savedRaw := e.doRaw(t, "GET", "/api/me/export?chat="+itoa(studentID), student, nil)
	if code != http.StatusOK || ct != "application/zip" || len(savedRaw) < 2 || savedRaw[0] != 'P' {
		t.Fatalf("saved zip: %d %s", code, ct)
	}
	savedZip, err := zip.NewReader(bytes.NewReader(savedRaw), int64(len(savedRaw)))
	if err != nil {
		t.Fatal(err)
	}
	var savedHTML string
	for _, f := range savedZip.File {
		if strings.HasSuffix(f.Name, ".png") || strings.HasSuffix(f.Name, ".wav") || strings.HasSuffix(f.Name, ".txt") {
			t.Fatalf("saved chat packed another conversation's media: %s", f.Name)
		}
		if f.Name != "index.html" {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		blob, _ := io.ReadAll(rc)
		_ = rc.Close()
		savedHTML = string(blob)
	}
	if !strings.Contains(savedHTML, "پیام‌های ذخیره‌شده") || !strings.Contains(savedHTML, "یادداشت خصوصی") {
		t.Fatal("saved chat export is missing its own transcript")
	}
	if strings.Contains(savedHTML, "راز") || strings.Contains(savedHTML, "از منتور") {
		t.Fatal("saved chat export included the mentor thread")
	}

	code, _, _ = e.doRaw(t, "GET", "/api/me/export?chat="+itoa(studentID), other, nil)
	if code != http.StatusNotFound {
		t.Fatalf("other user chat: %d", code)
	}
	code, _, otherRaw := e.doRaw(t, "GET", "/api/me/export?chat="+itoa(otherID), other, nil)
	if code != http.StatusOK || len(otherRaw) < 2 || otherRaw[0] != 'P' {
		t.Fatalf("other user own export failed: %d", code)
	}
	otherZip, err := zip.NewReader(bytes.NewReader(otherRaw), int64(len(otherRaw)))
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range otherZip.File {
		rc, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		blob, _ := io.ReadAll(rc)
		_ = rc.Close()
		if bytes.Contains(blob, []byte("راز")) || bytes.Contains(blob, []byte("یادداشت خصوصی")) {
			t.Fatalf("other user export leaked %s", f.Name)
		}
	}
	code, mentorMeta := e.do(t, "GET", "/api/me/export?meta=1&chat="+itoa(studentID), mentor, nil)
	if code != http.StatusOK || int64(mentorMeta["bytes"].(float64)) < floor {
		t.Fatalf("mentor meta: %d %v", code, mentorMeta)
	}
	code, _ = e.do(t, "GET", "/api/me/export?chat=999999", student, nil)
	if code != http.StatusNotFound {
		t.Fatalf("missing partner: %d", code)
	}
	code, _, _ = e.doRaw(t, "GET", "/api/me/export?chat="+itoa(mentorID), "", nil)
	if code != http.StatusUnauthorized {
		t.Fatalf("anon: %d", code)
	}
}
