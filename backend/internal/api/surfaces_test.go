package api_test

import (
	"strings"
	"testing"
)

func TestChatEditOwnMessage(t *testing.T) {
	e := setup(t)
	student, studentID := register(t, e, "Chat Editor", "chat-editor@test.dev")
	admin := login(t, e, bootstrapAdminEmail)
	code, me := e.do(t, "GET", "/api/auth/me", admin, nil)
	if code != 200 {
		t.Fatalf("me: %d %v", code, me)
	}
	adminID := int64(me["user"].(map[string]any)["id"].(float64))

	code, body := e.do(t, "POST", "/api/chats/"+itoa(adminID)+"/messages", student, map[string]any{"body": "سلام"})
	if code != 201 {
		t.Fatalf("send: %d %v", code, body)
	}
	msg := body["message"].(map[string]any)
	msgID := int64(msg["id"].(float64))

	code, body = e.do(t, "PUT", "/api/chats/"+itoa(adminID)+"/messages/"+itoa(msgID), student, map[string]any{"body": "سلام ویرایش"})
	if code != 200 {
		t.Fatalf("edit: %d %v", code, body)
	}
	edited := body["message"].(map[string]any)
	if edited["body"] != "سلام ویرایش" || edited["editedAt"] == nil {
		t.Fatalf("expected edited body, got %v", edited)
	}

	code, _ = e.do(t, "PUT", "/api/chats/"+itoa(studentID)+"/messages/"+itoa(msgID), admin, map[string]any{"body": "نه"})
	if code != 404 {
		t.Fatalf("partner edit should be rejected: %d", code)
	}

	code, _ = e.do(t, "PUT", "/api/chats/"+itoa(adminID)+"/messages/"+itoa(msgID), student, map[string]any{"body": "  "})
	if code != 400 {
		t.Fatalf("empty edit: %d", code)
	}

	code, body = e.do(t, "GET", "/api/chats/"+itoa(adminID)+"/messages", student, nil)
	if code != 200 {
		t.Fatalf("list: %d %v", code, body)
	}
	msgs := body["messages"].([]any)
	last := msgs[len(msgs)-1].(map[string]any)
	if last["body"] != "سلام ویرایش" || last["editedAt"] == nil {
		t.Fatalf("listed message not edited: %v", last)
	}
}

func TestChatReplaceAttachment(t *testing.T) {
	e := setup(t)
	student, studentID := register(t, e, "Media Editor", "media-editor@test.dev")
	admin := login(t, e, bootstrapAdminEmail)
	code, me := e.do(t, "GET", "/api/auth/me", admin, nil)
	if code != 200 {
		t.Fatalf("me: %d %v", code, me)
	}
	adminID := int64(me["user"].(map[string]any)["id"].(float64))

	png := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00}
	code, up := uploadChatFile(t, e, student, "one.png", png)
	if code != 201 {
		t.Fatalf("upload: %d %v", code, up)
	}
	first := up["attachment"].(map[string]any)

	code, body := e.do(t, "POST", "/api/chats/"+itoa(adminID)+"/messages", student, map[string]any{
		"body":       "",
		"attachment": first,
	})
	if code != 201 {
		t.Fatalf("send: %d %v", code, body)
	}
	msg := body["message"].(map[string]any)
	msgID := int64(msg["id"].(float64))
	oldPath := mediaPath(msg["attachment"].(map[string]any)["url"])

	code, body = e.do(t, "PUT", "/api/chats/"+itoa(adminID)+"/messages/"+itoa(msgID), student, map[string]any{
		"body": "کپشن صدا",
	})
	if code != 200 {
		t.Fatalf("caption: %d %v", code, body)
	}
	captioned := body["message"].(map[string]any)
	if captioned["body"] != "کپشن صدا" || captioned["editedAt"] == nil {
		t.Fatalf("caption edit: %v", captioned)
	}
	if mediaPath(captioned["attachment"].(map[string]any)["url"]) != oldPath {
		t.Fatalf("caption edit replaced the file: %v", captioned)
	}

	code, body = e.do(t, "PUT", "/api/chats/"+itoa(adminID)+"/messages/"+itoa(msgID), student, map[string]any{
		"body": "",
	})
	if code != 200 {
		t.Fatalf("clear caption: %d %v", code, body)
	}
	cleared := body["message"].(map[string]any)
	if cleared["body"] != "" || mediaPath(cleared["attachment"].(map[string]any)["url"]) != oldPath {
		t.Fatalf("empty caption should keep the file: %v", cleared)
	}

	png[8] = 0x01
	code, up = uploadChatFile(t, e, student, "two.png", png)
	if code != 201 {
		t.Fatalf("upload extra: %d %v", code, up)
	}
	extra := up["attachment"].(map[string]any)
	code, body = e.do(t, "PUT", "/api/chats/"+itoa(adminID)+"/messages/"+itoa(msgID), student, map[string]any{
		"body":       "کپشن صدا",
		"attachment": extra,
	})
	if code != 200 {
		t.Fatalf("append: %d %v", code, body)
	}
	appended := body["message"].(map[string]any)
	appendedAtts := appended["attachments"].([]any)
	if len(appendedAtts) != 2 || mediaPath(appendedAtts[0].(map[string]any)["url"]) != oldPath {
		t.Fatalf("append wiped the original: %v", appended)
	}
	if mediaPath(appendedAtts[1].(map[string]any)["url"]) == "" || mediaPath(appendedAtts[1].(map[string]any)["url"]) == oldPath {
		t.Fatalf("appended file: %v", appendedAtts)
	}

	png[8] = 0x02
	code, up = uploadChatFile(t, e, student, "three.png", png)
	if code != 201 {
		t.Fatalf("upload replacement: %d %v", code, up)
	}
	next := up["attachment"].(map[string]any)
	code, body = e.do(t, "PUT", "/api/chats/"+itoa(adminID)+"/messages/"+itoa(msgID), student, map[string]any{
		"body":         "کپشن صدا",
		"replacements": []any{map[string]any{"index": 0, "attachment": next}},
	})
	if code != 200 {
		t.Fatalf("replace: %d %v", code, body)
	}
	edited := body["message"].(map[string]any)
	editedAtts := edited["attachments"].([]any)
	newPath := mediaPath(editedAtts[0].(map[string]any)["url"])
	if edited["editedAt"] == nil || len(editedAtts) != 2 || newPath == "" || newPath == oldPath {
		t.Fatalf("expected only the first file to be replaced, got %v", edited)
	}
	if mediaPath(editedAtts[1].(map[string]any)["url"]) != mediaPath(extra["url"]) {
		t.Fatalf("replace dropped the added file: %v", editedAtts)
	}

	wrong := map[string]any{"type": "video", "url": next["url"], "name": "clip.mp4", "size": next["size"]}
	code, _ = e.do(t, "PUT", "/api/chats/"+itoa(adminID)+"/messages/"+itoa(msgID), student, map[string]any{
		"body":         "کپشن صدا",
		"replacements": []any{map[string]any{"index": 0, "attachment": wrong}},
	})
	if code != 400 {
		t.Fatalf("different kind should be rejected: %d", code)
	}

	code, _ = e.do(t, "PUT", "/api/chats/"+itoa(adminID)+"/messages/"+itoa(msgID), student, map[string]any{
		"body":         "",
		"replacements": []any{map[string]any{"index": 0, "attachment": map[string]any{"type": "file", "url": next["url"], "name": "x.pdf", "size": 1}}},
	})
	if code != 400 {
		t.Fatalf("file replace: %d", code)
	}

	code, _ = e.do(t, "PUT", "/api/chats/"+itoa(studentID)+"/messages/"+itoa(msgID), admin, map[string]any{
		"body":       "",
		"attachment": next,
	})
	if code != 404 {
		t.Fatalf("partner edit should be rejected: %d", code)
	}
}

func TestChatReadMarksOnlyIncoming(t *testing.T) {
	e := setup(t)
	student, studentID := register(t, e, "Seen Student", "seen-student@test.dev")
	admin := login(t, e, bootstrapAdminEmail)
	code, me := e.do(t, "GET", "/api/auth/me", admin, nil)
	if code != 200 {
		t.Fatalf("me: %d %v", code, me)
	}
	adminID := int64(me["user"].(map[string]any)["id"].(float64))

	code, body := e.do(t, "POST", "/api/chats/"+itoa(adminID)+"/messages", student, map[string]any{"body": "از هنرجو"})
	if code != 201 {
		t.Fatalf("student send: %d %v", code, body)
	}
	studentMsg := int64(body["message"].(map[string]any)["id"].(float64))

	code, body = e.do(t, "GET", "/api/chats/"+itoa(adminID)+"/messages", student, nil)
	if code != 200 {
		t.Fatalf("student list: %d %v", code, body)
	}
	if chatMsg(t, body, studentMsg)["readAt"] != nil {
		t.Fatalf("opening my own thread marked it seen: %v", chatMsg(t, body, studentMsg))
	}

	code, body = e.do(t, "GET", "/api/chats/"+itoa(studentID)+"/messages", admin, nil)
	if code != 200 {
		t.Fatalf("admin list: %d %v", code, body)
	}
	if chatMsg(t, body, studentMsg)["readAt"] == nil {
		t.Fatalf("partner open should mark the incoming message seen")
	}

	code, body = e.do(t, "POST", "/api/chats/"+itoa(studentID)+"/messages", admin, map[string]any{"body": "از ادمین"})
	if code != 201 {
		t.Fatalf("admin send: %d %v", code, body)
	}
	adminMsg := int64(body["message"].(map[string]any)["id"].(float64))

	code, body = e.do(t, "GET", "/api/chats/"+itoa(studentID)+"/messages", admin, nil)
	if code != 200 {
		t.Fatalf("admin list again: %d %v", code, body)
	}
	if chatMsg(t, body, adminMsg)["readAt"] != nil {
		t.Fatalf("admin own message was marked seen: %v", chatMsg(t, body, adminMsg))
	}
	if chatMsg(t, body, studentMsg)["readAt"] == nil {
		t.Fatalf("already seen incoming message lost its receipt")
	}
}

func TestChatSendMultipleAttachments(t *testing.T) {
	e := setup(t)
	student, _ := register(t, e, "Album Student", "album-student@test.dev")
	admin := login(t, e, bootstrapAdminEmail)
	code, me := e.do(t, "GET", "/api/auth/me", admin, nil)
	if code != 200 {
		t.Fatalf("me: %d %v", code, me)
	}
	adminID := int64(me["user"].(map[string]any)["id"].(float64))

	png := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00}
	code, up1 := uploadChatFile(t, e, student, "one.png", png)
	if code != 201 {
		t.Fatalf("upload one: %d %v", code, up1)
	}
	png[8] = 0x01
	code, up2 := uploadChatFile(t, e, student, "two.png", png)
	if code != 201 {
		t.Fatalf("upload two: %d %v", code, up2)
	}
	a := up1["attachment"].(map[string]any)
	b := up2["attachment"].(map[string]any)

	code, body := e.do(t, "POST", "/api/chats/"+itoa(adminID)+"/messages", student, map[string]any{
		"body":        "کپشن مشترک",
		"attachments": []any{a, b},
	})
	if code != 201 {
		t.Fatalf("send album: %d %v", code, body)
	}
	msg := body["message"].(map[string]any)
	if msg["body"] != "کپشن مشترک" {
		t.Fatalf("caption: %v", msg["body"])
	}
	atts := msg["attachments"].([]any)
	if len(atts) != 2 {
		t.Fatalf("attachments: %v", msg["attachments"])
	}
	if mediaPath(atts[0].(map[string]any)["url"]) == "" || mediaPath(atts[0].(map[string]any)["url"]) == mediaPath(atts[1].(map[string]any)["url"]) {
		t.Fatalf("photo urls: %v", atts)
	}
	if mediaPath(msg["attachment"].(map[string]any)["url"]) != mediaPath(atts[0].(map[string]any)["url"]) {
		t.Fatalf("first attachment should mirror the album: %v", msg["attachment"])
	}
	msgID := int64(msg["id"].(float64))

	code, body = e.do(t, "GET", "/api/chats/"+itoa(adminID)+"/messages", student, nil)
	if code != 200 {
		t.Fatalf("list: %d %v", code, body)
	}
	listed := chatMsg(t, body, msgID)
	if listed["readAt"] != nil {
		t.Fatalf("own album was marked seen: %v", listed)
	}
	listedAtts := listed["attachments"].([]any)
	if len(listedAtts) != 2 || listed["body"] != "کپشن مشترک" {
		t.Fatalf("listed album: %v", listed)
	}

	code, body = e.do(t, "PUT", "/api/chats/"+itoa(adminID)+"/messages/"+itoa(msgID), student, map[string]any{
		"body": "کپشن ویرایش‌شده",
	})
	if code != 200 {
		t.Fatalf("album caption: %d %v", code, body)
	}
	albumEdit := body["message"].(map[string]any)
	albumAtts := albumEdit["attachments"].([]any)
	if albumEdit["body"] != "کپشن ویرایش‌شده" || len(albumAtts) != 2 {
		t.Fatalf("album caption edit: %v", albumEdit)
	}
	if mediaPath(albumAtts[0].(map[string]any)["url"]) != mediaPath(atts[0].(map[string]any)["url"]) ||
		mediaPath(albumAtts[1].(map[string]any)["url"]) != mediaPath(atts[1].(map[string]any)["url"]) {
		t.Fatalf("album caption edit changed photos: %v", albumAtts)
	}

	code, up3 := uploadChatFile(t, e, student, "notes.txt", []byte("hello"))
	if code != 201 {
		t.Fatalf("upload txt: %d %v", code, up3)
	}
	code, up4 := uploadChatFile(t, e, student, "more.txt", []byte("world"))
	if code != 201 {
		t.Fatalf("upload txt 2: %d %v", code, up4)
	}
	code, body = e.do(t, "POST", "/api/chats/"+itoa(adminID)+"/messages", student, map[string]any{
		"attachments": []any{up3["attachment"], up4["attachment"]},
	})
	if code != 201 {
		t.Fatalf("send files: %d %v", code, body)
	}
	files := body["message"].(map[string]any)["attachments"].([]any)
	if len(files) != 2 || files[0].(map[string]any)["type"] != "file" || files[1].(map[string]any)["name"] != "more.txt" {
		t.Fatalf("files: %v", files)
	}

	many := make([]any, 0, 11)
	for i := 0; i < 11; i++ {
		many = append(many, a)
	}
	code, _ = e.do(t, "POST", "/api/chats/"+itoa(adminID)+"/messages", student, map[string]any{"attachments": many})
	if code != 400 {
		t.Fatalf("too many: %d", code)
	}
}

func chatMsg(t *testing.T, body map[string]any, id int64) map[string]any {
	t.Helper()
	for _, raw := range body["messages"].([]any) {
		msg := raw.(map[string]any)
		if int64(msg["id"].(float64)) == id {
			return msg
		}
	}
	t.Fatalf("message %d missing in %v", id, body["messages"])
	return nil
}

func mediaPath(raw any) string {
	s, _ := raw.(string)
	if i := strings.IndexByte(s, '?'); i >= 0 {
		return s[:i]
	}
	return s
}

func TestLearningDetailMatchesActiveStudents(t *testing.T) {
	e := setup(t)
	admin := login(t, e, bootstrapAdminEmail)

	code, body := e.do(t, "GET", "/api/admin/stats", admin, nil)
	if code != 200 {
		t.Fatalf("stats: %d %v", code, body)
	}
	if body["stats"].(map[string]any)["users"].(float64) != 0 {
		t.Fatalf("overview should ignore staff, got %v", body["stats"])
	}

	_, uid := register(t, e, "Active Student", "active-student@test.dev")

	code, body = e.do(t, "GET", "/api/admin/stats", admin, nil)
	if code != 200 {
		t.Fatalf("stats after student: %d %v", code, body)
	}
	if body["stats"].(map[string]any)["users"].(float64) != 1 {
		t.Fatalf("expected 1 active student, got %v", body["stats"])
	}

	code, body = e.do(t, "GET", "/api/admin/learning/overview", admin, nil)
	if code != 200 {
		t.Fatalf("overview: %d %v", code, body)
	}
	if body["overview"].(map[string]any)["studentsActive"].(float64) != 1 {
		t.Fatalf("learning active mismatch: %v", body["overview"])
	}

	code, body = e.do(t, "GET", "/api/admin/users/"+itoa(uid)+"/learning", admin, nil)
	if code != 200 {
		t.Fatalf("learning detail: %d %v", code, body)
	}
	user := body["learning"].(map[string]any)["user"].(map[string]any)
	if user["name"] != "Active Student" {
		t.Fatalf("detail user: %v", user)
	}

	code, body = e.do(t, "GET", "/api/admin/users/999999/learning", admin, nil)
	if code != 404 {
		t.Fatalf("missing user: %d %v", code, body)
	}

	code, body = e.do(t, "GET", "/api/admin/learning/students?page=1&pageSize=10", admin, nil)
	if code != 200 {
		t.Fatalf("students page: %d %v", code, body)
	}
	if body["total"].(float64) != 1 || len(body["items"].([]any)) != 1 {
		t.Fatalf("expected one page row, got %v", body)
	}
}

func TestInviteStatusFilter(t *testing.T) {
	e := setup(t)
	admin := login(t, e, bootstrapAdminEmail)
	code, body := e.do(t, "POST", "/api/admin/invites", admin, map[string]any{"maxUses": 2, "label": "مهر"})
	if code != 201 {
		t.Fatalf("create invite: %d %v", code, body)
	}
	code, body = e.do(t, "GET", "/api/admin/invites?status=active", admin, nil)
	if code != 200 {
		t.Fatalf("active filter: %d %v", code, body)
	}
	if body["total"].(float64) < 1 {
		t.Fatalf("expected active invites, got %v", body)
	}
	code, body = e.do(t, "GET", "/api/admin/invites?status=revoked", admin, nil)
	if code != 200 {
		t.Fatalf("revoked filter: %d %v", code, body)
	}
	if body["total"].(float64) != 0 {
		t.Fatalf("expected no revoked invites, got %v", body)
	}
	code, body = e.do(t, "GET", "/api/admin/invites?status=nope", admin, nil)
	if code != 400 {
		t.Fatalf("bad status: %d %v", code, body)
	}
}

func TestPublicProfileOmitsPrivateFields(t *testing.T) {
	e := setup(t)
	student, studentID := register(t, e, "Public Name", "public-name@test.dev")
	admin := login(t, e, bootstrapAdminEmail)
	code, me := e.do(t, "GET", "/api/auth/me", admin, nil)
	if code != 200 {
		t.Fatalf("me: %d %v", code, me)
	}
	adminID := int64(me["user"].(map[string]any)["id"].(float64))

	code, body := e.do(t, "GET", "/api/users/"+itoa(adminID), student, nil)
	if code != 200 {
		t.Fatalf("profile: %d %v", code, body)
	}
	user := body["user"].(map[string]any)
	if user["name"] == nil || user["name"] == "" {
		t.Fatalf("missing name: %v", user)
	}
	if _, ok := user["email"]; ok {
		t.Fatalf("email must not be public: %v", user)
	}
	if _, ok := user["phone"]; ok {
		t.Fatalf("phone must not be public: %v", user)
	}

	code, adminView := e.do(t, "GET", "/api/admin/users/"+itoa(studentID), admin, nil)
	if code != 200 {
		t.Fatalf("admin user: %d %v", code, adminView)
	}
	managed := adminView["user"].(map[string]any)
	if managed["email"] != "public-name@test.dev" {
		t.Fatalf("admin should see email: %v", managed)
	}
	if _, ok := managed["passwordHash"]; ok {
		t.Fatalf("password hash must stay hidden: %v", managed)
	}
	code, hidden := e.do(t, "GET", "/api/admin/users/"+itoa(adminID), student, nil)
	if code != 403 {
		t.Fatalf("student must not open admin user: %d %v", code, hidden)
	}

	code, body = e.do(t, "GET", "/api/users/"+itoa(studentID), admin, nil)
	if code != 200 {
		t.Fatalf("student profile: %d %v", code, body)
	}
	if body["user"].(map[string]any)["username"] != "public-name" {
		t.Fatalf("username: %v", body["user"])
	}
}
