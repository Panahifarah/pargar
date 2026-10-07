package api_test

import (
	"fmt"
	"net/http"
	"testing"
)

func TestAuthRoundTrip(t *testing.T) {
	e := setup(t)
	token, uid := register(t, e, "Tester", "tester@test.dev")
	if uid <= 0 {
		t.Fatal("expected positive id")
	}
	code, body := e.do(t, "GET", "/api/auth/me", token, nil)
	if code != http.StatusOK {
		t.Fatalf("me: %d", code)
	}
	u := body["user"].(map[string]any)
	if u["email"] != "tester@test.dev" {
		t.Fatalf("wrong user %v", u["email"])
	}
	if u["role"] != "student" {
		t.Fatalf("role must default to student, got %v", u["role"])
	}
	// public self-registration is disabled; duplicate email rejected via admin path
	code, _ = e.do(t, "POST", "/api/auth/register", "", map[string]any{
		"name": "Tester", "email": "tester@test.dev", "password": "password123",
	})
	if code == http.StatusCreated {
		t.Fatal("public registration must be disabled")
	}
	admin := login(t, e, bootstrapAdminEmail)
	code, _ = e.do(t, "POST", "/api/admin/users", admin, map[string]any{
		"name": "Tester", "email": "tester@test.dev", "username": "tester", "password": "password123", "role": "student",
		"securityQuestion": "رنگ مورد علاقه؟", "securityAnswer": "آبی",
	})
	if code != http.StatusConflict {
		t.Fatalf("expected 409, got %d", code)
	}
}

func TestTreeGatekeeping(t *testing.T) {
	e := setup(t)
	token, _ := register(t, e, "Tree", "tree@test.dev")
	code, body := e.do(t, "GET", "/api/tree", token, nil)
	if code != http.StatusOK {
		t.Fatalf("tree: %d", code)
	}
	chapters := body["chapters"].([]any)
	if len(chapters) != 3 {
		t.Fatalf("expected 3 chapters, got %d", len(chapters))
	}
	firstChapter := chapters[0].(map[string]any)
	lessons := firstChapter["lessons"].([]any)
	first := lessons[0].(map[string]any)
	if first["locked"] != false {
		t.Fatalf("root lesson must be unlocked")
	}
	second := lessons[1].(map[string]any)
	if second["locked"] != true {
		t.Fatalf("prereq lesson must start locked")
	}
}

func TestPrerequisiteLessonRejectsDirectAccess(t *testing.T) {
	e := setup(t)
	token, _ := register(t, e, "Direct", "direct@test.dev")

	for _, endpoint := range []struct {
		method string
		path   string
		body   map[string]any
	}{
		{method: "GET", path: "/api/lessons/2"},
		{method: "GET", path: "/api/lessons/2/resume"},
		{method: "POST", path: "/api/lessons/2/heartbeat", body: map[string]any{"position": 1, "delta": 1, "seq": 1}},
		{method: "POST", path: "/api/lessons/2/complete"},
		{method: "GET", path: "/api/lessons/2/quiz"},
		{method: "POST", path: "/api/lessons/2/quiz/submit", body: map[string]any{"answers": []int{0}}},
		{method: "GET", path: "/api/lessons/2/quiz/result"},
	} {
		code, _ := e.do(t, endpoint.method, endpoint.path, token, endpoint.body)
		if code != http.StatusForbidden {
			t.Fatalf("%s %s: expected 403, got %d", endpoint.method, endpoint.path, code)
		}
	}
}

func TestHeartbeatReportsUnlockTransition(t *testing.T) {
	e := setup(t)
	token, _ := register(t, e, "Heartbeat", "heartbeat@test.dev")

	for i := 1; i <= 5; i++ {
		rewindWatchSession(t, e, token, 1)
		code, body := e.do(t, "POST", "/api/lessons/1/heartbeat", token, map[string]any{
			"position": float64(i * 7),
			"delta":    7,
			"seq":      i,
		})
		if code != http.StatusOK || body["quizUnlocked"] != false || body["quizUnlockedNow"] != false {
			t.Fatalf("heartbeat %d should remain locked: %d %v", i, code, body)
		}
	}

	rewindWatchSession(t, e, token, 1)
	code, body := e.do(t, "POST", "/api/lessons/1/heartbeat", token, map[string]any{
		"position": 42, "delta": 4, "seq": 6,
	})
	if code != http.StatusOK || body["quizUnlocked"] != true || body["quizUnlockedNow"] != true {
		t.Fatalf("unlocking heartbeat should report transition: %d %v", code, body)
	}

	rewindWatchSession(t, e, token, 1)
	code, body = e.do(t, "POST", "/api/lessons/1/heartbeat", token, map[string]any{
		"position": 43, "delta": 1, "seq": 7,
	})
	if code != http.StatusOK || body["quizUnlocked"] != true || body["quizUnlockedNow"] != false {
		t.Fatalf("subsequent heartbeat should report persistent unlock only: %d %v", code, body)
	}
}

func TestQuizRequiresWatch(t *testing.T) {
	e := setup(t)
	token, _ := register(t, e, "Cheat", "cheat@test.dev")
	code, _ := e.do(t, "GET", "/api/lessons/1/quiz", token, nil)
	if code != http.StatusForbidden {
		t.Fatalf("quiz must be locked before watch, got %d", code)
	}
}

func TestWatchUnlocksQuizAndPass(t *testing.T) {
	e := setup(t)
	token, _ := register(t, e, "Win", "win@test.dev")

	watchToUnlock(t, e, token, 1)

	code, body := e.do(t, "GET", "/api/lessons/1/quiz", token, nil)
	if code != http.StatusOK {
		t.Fatalf("quiz not unlocked after watch: %d", code)
	}
	questions := body["questions"].([]any)
	if len(questions) != 3 {
		t.Fatalf("expected 3 questions")
	}
	// answer keys must never leak to clients
	for _, q := range questions {
		qm := q.(map[string]any)
		if _, ok := qm["answerIndex"]; ok {
			t.Fatalf("answer key leaked to client!")
		}
	}

	// graded server-side; correct answers for seeded lesson 1 are [1,1,2]
	code, result := e.do(t, "POST", "/api/lessons/1/quiz/submit", token, map[string]any{"answers": []int{1, 1, 2}})
	if code != http.StatusOK {
		t.Fatalf("submit: %d %v", code, result)
	}
	if result["passed"] != true {
		t.Fatalf("expected pass, got %v", result)
	}
	if result["xpEarned"].(float64) <= 0 {
		t.Fatalf("expected xp")
	}

	// lessons 2 and 3 must now be unlocked
	_, body = e.do(t, "GET", "/api/tree", token, nil)
	chapters := body["chapters"].([]any)
	found := 0
	for _, ch := range chapters {
		for _, l := range ch.(map[string]any)["lessons"].([]any) {
			lm := l.(map[string]any)
			switch lm["id"].(float64) {
			case 2, 3:
				if lm["locked"] != false {
					t.Fatalf("lesson %v should be unlocked after passing prereq", lm["id"])
				}
				found++
			}
		}
	}
	if found != 2 {
		t.Fatalf("expected 2 unlocked lessons, got %d", found)
	}
}

func TestQuizFailLocksAccountAndMentorUnlocks(t *testing.T) {
	e := setup(t)
	token, uid := register(t, e, "Struggle", "struggle@test.dev")

	watchToUnlock(t, e, token, 1)

	// all-wrong answers burn 3 hearts -> account locked
	code, result := e.do(t, "POST", "/api/lessons/1/quiz/submit", token, map[string]any{"answers": []int{0, 0, 0}})
	if code != http.StatusOK {
		t.Fatalf("submit: %d", code)
	}
	if result["heartsLeft"].(float64) != 0 {
		t.Fatalf("expected 0 hearts")
	}
	if result["locked"] != true {
		t.Fatalf("expected locked")
	}

	// locked users can no longer send heartbeats (423)
	code, _ = e.do(t, "POST", "/api/lessons/1/heartbeat", token, map[string]any{"position": 45, "delta": 1, "seq": 9})
	if code != http.StatusLocked {
		t.Fatalf("expected 423 while locked, got %d", code)
	}

	// locked users may request staff review (does not unlock); only staff unlocks
	code, body := e.do(t, "POST", "/api/me/request-unlock", token, map[string]any{"note": "لطفاً بررسی کنید"})
	if code != http.StatusCreated && code != http.StatusOK {
		t.Fatalf("unlock request: %d %v", code, body)
	}
	code, _ = e.do(t, "POST", "/api/me/request-reset", token, nil)
	if code != http.StatusForbidden {
		t.Fatalf("self reset should be forbidden, got %d", code)
	}

	// mentor unlocks (account CRUD is admin-only; unlock remains staff)
	admin := login(t, e, bootstrapAdminEmail)
	code, _ = e.do(t, "POST", "/api/admin/users", admin, map[string]any{
		"name": "Mentor Maya", "email": "mentor@test.dev", "username": "mentor", "password": "password123", "role": "mentor",
		"securityQuestion": "نام حیوان خانگی؟", "securityAnswer": "rex",
	})
	if code != http.StatusCreated {
		t.Fatalf("create mentor: %d", code)
	}
	mentor := login(t, e, "mentor@test.dev")

	code, _ = e.do(t, "GET", "/api/admin/users?q=struggle", mentor, nil)
	if code != http.StatusForbidden {
		t.Fatalf("mentor listing users should be 403, got %d", code)
	}
	code, body = e.do(t, "GET", "/api/admin/learning/students?q=struggle", mentor, nil)
	if code != http.StatusOK {
		t.Fatalf("mentor learning students: %d %v", code, body)
	}

	code, _ = e.do(t, "POST", "/api/admin/users/"+itoa(uid)+"/unlock", mentor, nil)
	if code != http.StatusOK {
		t.Fatalf("unlock: %d", code)
	}

	code, body = e.do(t, "GET", "/api/auth/me", token, nil)
	u := body["user"].(map[string]any)
	if code != http.StatusOK || u["isLocked"] != false {
		t.Fatalf("user should be unlocked: %v", u["isLocked"])
	}
	if u["hearts"].(float64) != 3 {
		t.Fatalf("hearts should be restored to 3, got %v", u["hearts"])
	}
}

func TestAdminHeartOverflowLocksAndCapsAccount(t *testing.T) {
	e := setup(t)
	token, _ := register(t, e, "Overflow", "overflow@test.dev")
	admin := login(t, e, bootstrapAdminEmail)

	code, body := e.do(t, "GET", "/api/admin/users?q=overflow", admin, nil)
	if code != http.StatusOK {
		t.Fatalf("admin users: %d", code)
	}
	uid := int64(body["items"].([]any)[0].(map[string]any)["id"].(float64))

	code, body = e.do(t, "PUT", "/api/admin/users/"+itoa(uid), admin, map[string]any{"hearts": 4})
	if code != http.StatusOK {
		t.Fatalf("update user: %d", code)
	}
	user := body["user"].(map[string]any)
	if user["hearts"].(float64) != 3 || user["isLocked"] != true {
		t.Fatalf("overflow must cap hearts and lock account: %v", user)
	}

	code, body = e.do(t, "GET", "/api/auth/me", token, nil)
	if code != http.StatusOK {
		t.Fatalf("me: %d", code)
	}
	user = body["user"].(map[string]any)
	if user["hearts"].(float64) != 3 || user["isLocked"] != true {
		t.Fatalf("persisted overflow guard failed: %v", user)
	}
}

func TestCannotChangeOwnRoleOrLockSelf(t *testing.T) {
	e := setup(t)
	admin := login(t, e, bootstrapAdminEmail)

	code, body := e.do(t, "GET", "/api/auth/me", admin, nil)
	if code != http.StatusOK {
		t.Fatalf("me: %d", code)
	}
	adminID := int64(body["user"].(map[string]any)["id"].(float64))

	code, body = e.do(t, "PUT", "/api/admin/users/"+itoa(adminID), admin, map[string]any{"role": "student"})
	if code != http.StatusBadRequest {
		t.Fatalf("self role change via update should be 400, got %d %v", code, body)
	}

	code, body = e.do(t, "POST", "/api/admin/users/"+itoa(adminID)+"/role", admin, map[string]any{"role": "mentor"})
	if code != http.StatusBadRequest {
		t.Fatalf("self role change via set-role should be 400, got %d %v", code, body)
	}

	code, body = e.do(t, "POST", "/api/admin/users/"+itoa(adminID)+"/lock", admin, nil)
	if code != http.StatusBadRequest {
		t.Fatalf("self lock should be 400, got %d %v", code, body)
	}

	code, body = e.do(t, "GET", "/api/auth/me", admin, nil)
	if code != http.StatusOK {
		t.Fatalf("me after: %d", code)
	}
	if body["user"].(map[string]any)["role"] != "admin" {
		t.Fatalf("admin role must remain admin, got %v", body["user"])
	}
}

func TestEventsRsvpICSAndChat(t *testing.T) {
	e := setup(t)
	token, _ := register(t, e, "Social", "social@test.dev")
	admin := login(t, e, bootstrapAdminEmail)
	code, body := e.do(t, "POST", "/api/admin/users", admin, map[string]any{
		"name": "Mentor Maya", "email": "mentor@test.dev", "username": "mentor", "password": "password123", "role": "mentor",
		"securityQuestion": "نام حیوان خانگی؟", "securityAnswer": "rex",
	})
	if code != http.StatusCreated {
		t.Fatalf("create mentor: %d %v", code, body)
	}
	mentorID := int64(body["user"].(map[string]any)["id"].(float64))

	code, body = e.do(t, "GET", "/api/events", token, nil)
	if code != http.StatusOK {
		t.Fatalf("events: %d", code)
	}
	events := body["events"].([]any)
	if len(events) != 3 {
		t.Fatalf("expected 3 seeded events, got %d", len(events))
	}
	evID := int64(events[0].(map[string]any)["id"].(float64))

	code, _ = e.do(t, "POST", "/api/events/"+itoa(evID)+"/rsvp", token, nil)
	if code != http.StatusOK {
		t.Fatalf("rsvp: %d", code)
	}

	// authenticated ICS download
	req, _ := http.NewRequest("GET", e.server.URL+"/api/events/"+itoa(evID)+"/ics", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	iresp, _ := http.DefaultClient.Do(req)
	if iresp.StatusCode != http.StatusOK {
		t.Fatalf("ics: %d", iresp.StatusCode)
	}

	// chat with mentor (id 2)
	code, body = e.do(t, "POST", "/api/chats/"+itoa(mentorID)+"/messages", token, map[string]any{"body": "hello mentor"})
	if code != http.StatusCreated {
		t.Fatalf("chat: %d %v", code, body)
	}
	code, body = e.do(t, "GET", "/api/chats/"+itoa(mentorID)+"/messages", token, nil)
	if code != http.StatusOK {
		t.Fatalf("messages: %d", code)
	}
	msgs := body["messages"].([]any)
	if len(msgs) != 1 || msgs[0].(map[string]any)["body"] != "hello mentor" {
		t.Fatalf("chat roundtrip failed: %v", msgs)
	}
}

func TestChatRecipientPermissions(t *testing.T) {
	e := setup(t)
	studentToken, studentID := register(t, e, "One", "one@test.dev")
	_, otherStudentID := register(t, e, "Two", "two@test.dev")
	adminToken := login(t, e, bootstrapAdminEmail)
	code, body := e.do(t, "POST", "/api/admin/users", adminToken, map[string]any{
		"name": "Mentor Maya", "email": "mentor@test.dev", "username": "mentor", "password": "password123", "role": "mentor",
		"securityQuestion": "نام حیوان خانگی؟", "securityAnswer": "rex",
	})
	if code != http.StatusCreated {
		t.Fatalf("create mentor: %d %v", code, body)
	}
	mentorID := int64(body["user"].(map[string]any)["id"].(float64))

	for _, target := range []int64{studentID, otherStudentID} {
		code, _ = e.do(t, "POST", "/api/chats/"+itoa(target)+"/messages", studentToken, map[string]any{"body": "not allowed"})
		if code != http.StatusForbidden {
			t.Fatalf("student→student must be forbidden, got %d", code)
		}
	}
	code, _ = e.do(t, "POST", "/api/chats/"+itoa(mentorID)+"/messages", studentToken, map[string]any{"body": "ok"})
	if code != http.StatusCreated {
		t.Fatalf("student→mentor should work: %d", code)
	}
}

func TestChatAroundWindow(t *testing.T) {
	e := setup(t)
	token, _ := register(t, e, "Around", "around@test.dev")
	admin := login(t, e, bootstrapAdminEmail)
	code, body := e.do(t, "POST", "/api/admin/users", admin, map[string]any{
		"name": "Mentor Around", "email": "mentor-around@test.dev", "username": "mentoraround", "password": "password123", "role": "mentor",
		"securityQuestion": "نام حیوان خانگی؟", "securityAnswer": "rex",
	})
	if code != http.StatusCreated {
		t.Fatalf("create mentor: %d %v", code, body)
	}
	mentorID := int64(body["user"].(map[string]any)["id"].(float64))

	var mid int64
	for i := 0; i < 5; i++ {
		code, body = e.do(t, "POST", "/api/chats/"+itoa(mentorID)+"/messages", token, map[string]any{
			"body": "msg-" + itoa(int64(i)),
		})
		if code != http.StatusCreated {
			t.Fatalf("send %d: %d %v", i, code, body)
		}
		id := int64(body["message"].(map[string]any)["id"].(float64))
		if i == 2 {
			mid = id
		}
	}
	if mid == 0 {
		t.Fatal("missing midpoint id")
	}

	code, body = e.do(t, "GET", "/api/chats/"+itoa(mentorID)+"/messages?around="+itoa(mid), token, nil)
	if code != http.StatusOK {
		t.Fatalf("around: %d %v", code, body)
	}
	msgs := body["messages"].([]any)
	found := false
	for _, raw := range msgs {
		if int64(raw.(map[string]any)["id"].(float64)) == mid {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("around window missing target %d: %v", mid, msgs)
	}
	if int64(body["around"].(float64)) != mid {
		t.Fatalf("around echo mismatch: %v", body["around"])
	}

	code, body = e.do(t, "POST", "/api/chats/"+itoa(mentorID)+"/messages/"+itoa(mid)+"/pin", token, nil)
	if code != http.StatusOK {
		t.Fatalf("pin: %d %v", code, body)
	}
	code, body = e.do(t, "GET", "/api/chats/"+itoa(mentorID)+"/messages", token, nil)
	if code != http.StatusOK {
		t.Fatalf("list: %d", code)
	}
	pinned := body["pinned"].([]any)
	if len(pinned) != 1 {
		t.Fatalf("expected 1 pin, got %d", len(pinned))
	}
}

func TestUnlockRequestQueuesStaffReview(t *testing.T) {
	e := setup(t)
	token, studentID := register(t, e, "LockedKid", "lockedkid@test.dev")
	admin := login(t, e, bootstrapAdminEmail)

	code, _ := e.do(t, "POST", "/api/admin/users/"+itoa(studentID)+"/lock", admin, nil)
	if code != http.StatusOK {
		t.Fatalf("admin lock: %d", code)
	}

	code, body := e.do(t, "POST", "/api/me/request-unlock", token, map[string]any{"note": "کمک لازم دارم"})
	if code != http.StatusCreated {
		t.Fatalf("unlock request: %d %v", code, body)
	}
	// second request within window should be idempotent OK
	code, body = e.do(t, "POST", "/api/me/request-unlock", token, map[string]any{"note": "دوباره"})
	if code != http.StatusOK {
		t.Fatalf("repeat unlock request: %d %v", code, body)
	}

	code, _ = e.do(t, "POST", "/api/admin/users/"+itoa(studentID)+"/unlock", admin, nil)
	if code != http.StatusOK {
		t.Fatalf("admin unlock: %d", code)
	}
	code, body = e.do(t, "GET", "/api/auth/me", token, nil)
	if code != http.StatusOK || body["user"].(map[string]any)["isLocked"] != false {
		t.Fatalf("should be unlocked: %d %v", code, body)
	}
}

func TestNotificationsFanOutAndPrefs(t *testing.T) {
	e := setup(t)
	token, _ := register(t, e, "Notified", "notified@test.dev")

	// prefs exist & mutable
	code, body := e.do(t, "GET", "/api/notifications/preferences", token, nil)
	if code != http.StatusOK {
		t.Fatalf("prefs: %d", code)
	}
	code, _ = e.do(t, "PUT", "/api/notifications/preferences", token, map[string]any{
		"progress": false, "gamification": true, "mentor": true, "event": false,
	})
	if code != http.StatusOK {
		t.Fatalf("put prefs: %d", code)
	}

	// produce notifications (gamification on, progress off)
	watchToUnlock(t, e, token, 1)
	e.do(t, "POST", "/api/lessons/1/quiz/submit", token, map[string]any{"answers": []int{1, 1, 2}})

	code, body = e.do(t, "GET", "/api/notifications", token, nil)
	if code != http.StatusOK {
		t.Fatalf("notifs: %d", code)
	}
	unread := int(body["unread"].(float64))
	if unread == 0 {
		t.Fatal("expected notifications to be created")
	}
	found := false
	for _, n := range body["notifications"].([]any) {
		if n.(map[string]any)["type"] == "quiz_passed" {
			found = true
		}
	}
	if !found {
		t.Fatal("expected gamification quiz_passed notification")
	}

	code, body = e.do(t, "GET", "/api/notifications/unread-count", token, nil)
	if code != http.StatusOK || int(body["unread"].(float64)) != unread {
		t.Fatalf("unread count mismatch")
	}

	code, _ = e.do(t, "POST", "/api/notifications/read-all", token, nil)
	if code != http.StatusOK {
		t.Fatalf("read-all: %d", code)
	}
	code, body = e.do(t, "GET", "/api/notifications/unread-count", token, nil)
	if code != http.StatusOK || int(body["unread"].(float64)) != 0 {
		t.Fatalf("expected 0 unread after read-all, got %v", body)
	}
}

func TestLeaderboardAfterXP(t *testing.T) {
	e := setup(t)
	token, _ := register(t, e, "Orc", "orc@test.dev")
	watchToUnlock(t, e, token, 1)
	e.do(t, "POST", "/api/lessons/1/quiz/submit", token, map[string]any{"answers": []int{1, 1, 2}})

	code, body := e.do(t, "GET", "/api/leaderboard/weekly", token, nil)
	if code != http.StatusOK {
		t.Fatalf("leaderboard: %d", code)
	}
	entries := body["entries"].([]any)
	if len(entries) == 0 {
		t.Fatal("expected leaderboard entries")
	}
	if entries[0].(map[string]any)["xp"].(float64) <= 0 {
		t.Fatalf("expected positive xp")
	}
	fmt.Println("leaderboard ok")
}

func TestAdminSettingsAndSponsors(t *testing.T) {
	e := setup(t)
	admin := login(t, e, bootstrapAdminEmail)

	code, body := e.do(t, "PUT", "/api/admin/settings", admin, map[string]any{
		"settings": map[string]any{
			"donation_enabled": "true",
			"donation_note":    "یادداشت تست",
			"sponsors":         `[{"name":"حامی یک","url":"https://example.com","blurb":"حمایت"}]`,
		},
	})
	if code != http.StatusOK {
		t.Fatalf("put settings: %d %v", code, body)
	}
	settings := body["settings"].(map[string]any)
	if settings["donation_note"] != "یادداشت تست" {
		t.Fatalf("donation note not saved: %v", settings["donation_note"])
	}

	code, body = e.do(t, "GET", "/api/sponsors", "", nil)
	if code != http.StatusOK {
		t.Fatalf("sponsors: %d %v", code, body)
	}
	sponsors := body["sponsors"].([]any)
	if len(sponsors) != 1 || sponsors[0].(map[string]any)["name"] != "حامی یک" {
		t.Fatalf("unexpected sponsors: %v", sponsors)
	}

	code, body = e.do(t, "GET", "/api/community", "", nil)
	if code != http.StatusOK {
		t.Fatalf("community: %d %v", code, body)
	}
	if _, ok := body["channel"]; ok {
		t.Fatalf("community must not expose telegram channel: %v", body["channel"])
	}
	donation := body["donation"].(map[string]any)
	if donation["note"] != "یادداشت تست" {
		t.Fatalf("community donation note: %v", donation["note"])
	}
}
