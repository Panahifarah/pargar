package api_test

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestAnnouncementRecordEditDeleteAndPin(t *testing.T) {
	e := setup(t)
	admin := login(t, e, bootstrapAdminEmail)
	student, _ := register(t, e, "Ann", "ann@test.dev")
	code, created := e.do(t, "POST", "/api/admin/announce", admin, map[string]any{
		"title": "اطلاعیه تازه", "body": "متن **مارک‌داون** برای همه.", "category": "urgent", "route": "", "pinned": true,
	})
	if code != http.StatusOK {
		t.Fatalf("create: %d %v", code, created)
	}
	id := int64(created["id"].(float64))
	code, list := e.do(t, "GET", "/api/admin/announcements", admin, nil)
	if code != http.StatusOK || len(list["announcements"].([]any)) == 0 {
		t.Fatalf("list: %d %v", code, list)
	}
	code, pin := e.do(t, "GET", "/api/announcements/pinned", student, nil)
	if code != http.StatusOK {
		t.Fatalf("pin: %d %v", code, pin)
	}
	item := pin["announcement"].(map[string]any)
	if item["title"] != "اطلاعیه تازه" {
		t.Fatalf("pinned title: %v", item)
	}
	code, second := e.do(t, "POST", "/api/admin/announce", admin, map[string]any{
		"title": "اطلاعیه دوم", "body": "متن دوم برای اسلاید.", "category": "event", "route": "", "pinned": false,
	})
	if code != http.StatusOK {
		t.Fatalf("second: %d %v", code, second)
	}
	code, slidesRes := e.do(t, "GET", "/api/announcements/pinned", student, nil)
	slides, _ := slidesRes["announcements"].([]any)
	if code != http.StatusOK || len(slides) < 2 {
		t.Fatalf("slides: %d %v", code, slidesRes["announcements"])
	}
	code, _ = e.do(t, "PUT", "/api/admin/announcements/"+itoa(id), admin, map[string]any{
		"title": "اطلاعیه ویرایش‌شده", "body": "متن ویرایش‌شده برای رونوشت.", "category": "curriculum", "route": "/cap", "pinned": true,
	})
	if code != http.StatusOK {
		t.Fatalf("update: %d", code)
	}
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		code, pin = e.do(t, "GET", "/api/announcements/pinned", student, nil)
		if code == http.StatusOK {
			if got, _ := pin["announcement"].(map[string]any); got != nil && got["title"] == "اطلاعیه ویرایش‌شده" {
				break
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
	code, _ = e.do(t, "DELETE", "/api/admin/announcements/"+itoa(id), admin, nil)
	if code != http.StatusOK {
		t.Fatalf("delete: %d", code)
	}
}

func TestHeartsRegenerateAndDoNotLock(t *testing.T) {
	e := setup(t)
	token, uid := register(t, e, "Heart", "heart@test.dev")
	admin := login(t, e, bootstrapAdminEmail)
	code, _ := e.do(t, "PUT", "/api/admin/users/"+itoa(uid), admin, map[string]any{"hearts": 0})
	if code != http.StatusOK {
		t.Fatalf("set hearts: %d", code)
	}
	if _, err := e.pool.Exec(context.Background(), `UPDATE users SET hearts_updated_at = now() - interval '5 hours' WHERE id=$1`, uid); err != nil {
		t.Fatal(err)
	}
	code, me := e.do(t, "GET", "/api/auth/me", token, nil)
	if code != http.StatusOK {
		t.Fatalf("me: %d", code)
	}
	user := me["user"].(map[string]any)
	if user["hearts"].(float64) < 1 {
		t.Fatalf("expected a returned heart, got %v", user["hearts"])
	}
	if user["isLocked"] == true {
		t.Fatal("zero hearts must not lock by default")
	}
	code, _ = e.do(t, "PUT", "/api/admin/settings", admin, map[string]any{
		"settings": map[string]string{"hearts_max": "5", "hearts_regen_minutes": "240", "hearts_lock_on_empty": "false"},
	})
	if code != http.StatusOK {
		t.Fatalf("settings: %d", code)
	}
}

func TestProfilePrivateByDefault(t *testing.T) {
	e := setup(t)
	viewer, _ := register(t, e, "Viewer", "viewer@test.dev")
	_, other := register(t, e, "Hidden", "hidden@test.dev")
	code, body := e.do(t, "GET", "/api/users/"+itoa(other), viewer, nil)
	if code != http.StatusOK {
		t.Fatalf("profile: %d %v", code, body)
	}
	user := body["user"].(map[string]any)
	if user["private"] != true {
		t.Fatalf("expected private profile, got %v", user)
	}
	if _, ok := user["xp"]; ok {
		t.Fatalf("private profile leaked xp: %v", user)
	}
}

func TestMentorDirectoryUsesRealRoles(t *testing.T) {
	e := setup(t)
	admin := login(t, e, bootstrapAdminEmail)
	_, uid := register(t, e, "StudentRow", "row@test.dev")
	code, body := e.do(t, "GET", "/api/mentors?page=1&pageSize=50", admin, nil)
	if code != http.StatusOK {
		t.Fatalf("mentors: %d %v", code, body)
	}
	found := false
	for _, raw := range body["mentors"].([]any) {
		row := raw.(map[string]any)
		if int64(row["id"].(float64)) == uid {
			found = true
			if row["role"] != "student" {
				t.Fatalf("role: %v", row["role"])
			}
		}
	}
	if !found {
		t.Fatal("student missing from staff directory")
	}
}

func TestSavedMessageBecomesSelfChat(t *testing.T) {
	e := setup(t)
	token, uid := register(t, e, "Saver", "saver@test.dev")
	code, body := e.do(t, "POST", "/api/me/saved", token, map[string]any{"body": "برای بعد"})
	if code != http.StatusOK {
		t.Fatalf("save: %d %v", code, body)
	}
	code, body = e.do(t, "GET", "/api/chats/"+itoa(uid)+"/messages", token, nil)
	if code != http.StatusOK {
		t.Fatalf("self chat: %d %v", code, body)
	}
	msgs, _ := body["messages"].([]any)
	if len(msgs) == 0 {
		t.Fatal("saved text missing from self chat")
	}
	last := msgs[len(msgs)-1].(map[string]any)
	if last["body"] != "برای بعد" {
		t.Fatalf("body: %v", last["body"])
	}
}

func TestBroadcastCanTargetSomePeople(t *testing.T) {
	e := setup(t)
	admin := login(t, e, bootstrapAdminEmail)
	student, sid := register(t, e, "One", "one@test.dev")
	code, me := e.do(t, "GET", "/api/auth/me", admin, nil)
	if code != http.StatusOK {
		t.Fatal(code)
	}
	adminID := int64(me["user"].(map[string]any)["id"].(float64))
	code, body := e.do(t, "POST", "/api/chats/broadcast", admin, map[string]any{
		"body": "فقط برای تو", "userIds": []int64{sid},
	})
	if code != http.StatusOK || body["sent"].(float64) != 1 {
		t.Fatalf("broadcast: %d %v", code, body)
	}
	code, thread := e.do(t, "GET", "/api/chats/"+itoa(adminID)+"/messages", student, nil)
	if code != http.StatusOK {
		t.Fatalf("thread: %d %v", code, thread)
	}
	found := false
	for _, raw := range thread["messages"].([]any) {
		if raw.(map[string]any)["body"] == "فقط برای تو" {
			found = true
		}
	}
	if !found {
		t.Fatal("targeted broadcast missing")
	}
}

func TestChatPinAndBotReply(t *testing.T) {
	e := setup(t)
	admin := login(t, e, bootstrapAdminEmail)
	student, sid := register(t, e, "Chatty", "chatty@test.dev")
	code, _ := e.do(t, "PUT", "/api/chats/"+itoa(sid)+"/prefs", admin, map[string]any{
		"pinnedRank": 1, "muted": true, "archived": false,
	})
	if code != http.StatusOK {
		t.Fatalf("prefs: %d", code)
	}
	code, conv := e.do(t, "GET", "/api/chats/conversations?page=1&pageSize=20", admin, nil)
	if code != http.StatusOK {
		t.Fatalf("conversations: %d %v", code, conv)
	}
	code, bot := e.do(t, "POST", "/api/admin/bots", admin, map[string]any{"name": "ربات آزمون"})
	if code != http.StatusCreated {
		t.Fatalf("bot: %d %v", code, bot)
	}
	token := bot["token"].(string)
	botID := int64(bot["botId"].(float64))
	code, sent := e.doHeaders(t, "POST", "/api/bot/send", "", map[string]string{"X-Bot-Token": token}, map[string]any{
		"userId": sid, "text": "سلام از ربات", "buttons": []any{map[string]string{"text": "باشه"}},
	})
	if code != http.StatusOK {
		t.Fatalf("bot send: %d %v", code, sent)
	}
	code, _ = e.do(t, "POST", "/api/chats/"+itoa(botID)+"/messages", student, map[string]any{"body": "جواب هنرجو"})
	if code != http.StatusOK && code != http.StatusCreated {
		t.Fatalf("reply: %d", code)
	}
	code, updates := e.doHeaders(t, "GET", "/api/bot/updates", "", map[string]string{"X-Bot-Token": token}, nil)
	if code != http.StatusOK || len(updates["updates"].([]any)) == 0 {
		t.Fatalf("updates: %d %v", code, updates)
	}
}

func TestLastSeenAndPinnedReorder(t *testing.T) {
	e := setup(t)
	admin := login(t, e, bootstrapAdminEmail)
	_, alpha := register(t, e, "آلفا", "alpha-pin@test.dev")
	_, beta := register(t, e, "بتا", "beta-pin@test.dev")
	for _, id := range []int64{alpha, beta} {
		code, body := e.do(t, "POST", "/api/chats/"+itoa(id)+"/messages", admin, map[string]any{"body": "سلام"})
		if code != http.StatusCreated && code != http.StatusOK {
			t.Fatalf("message %d: %d %v", id, code, body)
		}
	}
	code, _ := e.do(t, "PUT", "/api/chats/"+itoa(alpha)+"/prefs", admin, map[string]any{
		"pinnedRank": 0, "muted": false, "archived": false,
	})
	if code != http.StatusOK {
		t.Fatalf("pin alpha: %d", code)
	}
	code, _ = e.do(t, "PUT", "/api/chats/"+itoa(beta)+"/prefs", admin, map[string]any{
		"pinnedRank": 1, "muted": false, "archived": false,
	})
	if code != http.StatusOK {
		t.Fatalf("pin beta: %d", code)
	}
	code, _ = e.do(t, "PUT", "/api/chats/"+itoa(alpha)+"/prefs", admin, map[string]any{
		"pinnedRank": 1, "muted": false, "archived": false,
	})
	if code != http.StatusOK {
		t.Fatalf("swap alpha: %d", code)
	}
	code, _ = e.do(t, "PUT", "/api/chats/"+itoa(beta)+"/prefs", admin, map[string]any{
		"pinnedRank": 0, "muted": false, "archived": false,
	})
	if code != http.StatusOK {
		t.Fatalf("swap beta: %d", code)
	}
	code, conv := e.do(t, "GET", "/api/chats/conversations", admin, nil)
	if code != http.StatusOK {
		t.Fatalf("conversations: %d %v", code, conv)
	}
	var pinned []float64
	for _, raw := range conv["conversations"].([]any) {
		row := raw.(map[string]any)
		partner := row["partner"].(map[string]any)
		id := partner["id"].(float64)
		if id != float64(alpha) && id != float64(beta) {
			continue
		}
		rank, ok := row["pinnedRank"].(float64)
		if !ok {
			t.Fatalf("missing pinnedRank for %v", id)
		}
		pinned = append(pinned, id)
		if id == float64(beta) && rank != 0 {
			t.Fatalf("beta rank: %v", rank)
		}
		if id == float64(alpha) && rank != 1 {
			t.Fatalf("alpha rank: %v", rank)
		}
	}
	if len(pinned) != 2 || pinned[0] != float64(beta) {
		t.Fatalf("pin order: %v", pinned)
	}

	seenAt := time.Now().Add(-2 * time.Hour).UTC()
	if _, err := e.pool.Exec(context.Background(), `UPDATE users SET last_seen_at=$2 WHERE id=$1`, alpha, seenAt); err != nil {
		t.Fatalf("last seen: %v", err)
	}
	code, people := e.do(t, "GET", "/api/mentors?page=1&pageSize=50", admin, nil)
	if code != http.StatusOK {
		t.Fatalf("mentors: %d %v", code, people)
	}
	var found bool
	for _, raw := range people["mentors"].([]any) {
		person := raw.(map[string]any)
		if person["id"].(float64) != float64(alpha) {
			continue
		}
		found = true
		stamp, _ := person["lastSeen"].(string)
		if stamp == "" {
			t.Fatalf("lastSeen missing: %v", person)
		}
		parsed, err := time.Parse(time.RFC3339, stamp)
		if err != nil {
			parsed, err = time.Parse(time.RFC3339Nano, stamp)
		}
		if err != nil || parsed.Sub(seenAt).Abs() > time.Minute {
			t.Fatalf("lastSeen %q: %v", stamp, err)
		}
	}
	if !found {
		t.Fatal("alpha missing from mentors")
	}
}

func TestBotAPIKeys(t *testing.T) {
	e := setup(t)
	admin := login(t, e, bootstrapAdminEmail)
	_, sid := register(t, e, "BotPeer", "bot-peer@test.dev")

	code, created := e.do(t, "POST", "/api/admin/bots", admin, map[string]any{"name": "تست"})
	if code != http.StatusCreated {
		t.Fatalf("create: %d", code)
	}
	secret, _ := created["token"].(string)
	if len(secret) < 32 {
		t.Fatal("create did not return a secret")
	}
	if created["botId"] == nil {
		t.Fatal("botId missing")
	}
	botUserID := created["botId"].(float64)
	code, people := e.do(t, "GET", "/api/mentors?page=1&pageSize=50", admin, nil)
	if code != http.StatusOK {
		t.Fatalf("mentors: %d %v", code, people["error"])
	}
	for _, raw := range people["mentors"].([]any) {
		person := raw.(map[string]any)
		if person["id"].(float64) == botUserID {
			t.Fatal("bot appeared in the mentor directory")
		}
	}

	code, list := e.do(t, "GET", "/api/admin/bots?page=1&pageSize=8", admin, nil)
	if code != http.StatusOK {
		t.Fatalf("list: %d", code)
	}
	if list["pageSize"] != float64(8) {
		t.Fatalf("pageSize: %v", list["pageSize"])
	}
	assertBotListHidesSecret(t, list, secret)
	item := findBotItem(t, list, "تست")
	createdAt, _ := item["createdAt"].(string)
	if item["active"] != true || item["requestCount"] != float64(0) || createdAt == "" {
		t.Fatalf("row shape: active=%v count=%v hasCreated=%v", item["active"], item["requestCount"], createdAt != "")
	}
	id := int64(item["id"].(float64))

	code, _ = e.doHeaders(t, "POST", "/api/bot/send", "", map[string]string{"X-Bot-Token": "not-a-real-token"}, map[string]any{
		"userId": sid, "text": "نباید بشمرد",
	})
	if code != http.StatusUnauthorized {
		t.Fatalf("bad token: %d", code)
	}

	code, sent := e.doHeaders(t, "POST", "/api/bot/send", "", map[string]string{"X-Bot-Token": secret}, map[string]any{
		"userId": sid, "text": "سلام از ربات", "buttons": []any{map[string]string{"text": "باشه"}},
	})
	if code != http.StatusOK {
		t.Fatalf("send: %d %v", code, sent["error"])
	}
	code, list = e.do(t, "GET", "/api/admin/bots?page=1&pageSize=8", admin, nil)
	if code != http.StatusOK {
		t.Fatalf("list after send: %d", code)
	}
	assertBotListHidesSecret(t, list, secret)
	item = findBotItem(t, list, "تست")
	if item["requestCount"] != float64(1) {
		t.Fatalf("requestCount after send: %v", item["requestCount"])
	}

	code, updates := e.doHeaders(t, "GET", "/api/bot/updates", "", map[string]string{"X-Bot-Token": secret}, nil)
	if code != http.StatusOK {
		t.Fatalf("updates: %d %v", code, updates["error"])
	}
	code, list = e.do(t, "GET", "/api/admin/bots?page=1&pageSize=8", admin, nil)
	item = findBotItem(t, list, "تست")
	if item["requestCount"] != float64(2) {
		t.Fatalf("requestCount after updates: %v", item["requestCount"])
	}

	code, stopped := e.do(t, "PUT", "/api/admin/bots/"+itoa(id), admin, map[string]any{"active": false})
	if code != http.StatusOK || stopped["active"] != false {
		t.Fatalf("stop: %d %v", code, stopped["error"])
	}
	code, _ = e.doHeaders(t, "POST", "/api/bot/send", "", map[string]string{"X-Bot-Token": secret}, map[string]any{
		"userId": sid, "text": "بعد از توقف",
	})
	if code != http.StatusUnauthorized {
		t.Fatalf("stopped send: %d", code)
	}
	code, _ = e.doHeaders(t, "GET", "/api/bot/updates", "", map[string]string{"X-Bot-Token": secret}, nil)
	if code != http.StatusUnauthorized {
		t.Fatalf("stopped updates: %d", code)
	}
	code, list = e.do(t, "GET", "/api/admin/bots?page=1&pageSize=8", admin, nil)
	assertBotListHidesSecret(t, list, secret)
	item = findBotItem(t, list, "تست")
	if item["active"] != false || item["requestCount"] != float64(2) {
		t.Fatalf("after stop: active=%v count=%v", item["active"], item["requestCount"])
	}
}

func findBotItem(t *testing.T, list map[string]any, name string) map[string]any {
	t.Helper()
	items, _ := list["items"].([]any)
	for _, raw := range items {
		row, _ := raw.(map[string]any)
		if row["name"] == name {
			return row
		}
	}
	t.Fatalf("missing bot %s", name)
	return nil
}

func assertBotListHidesSecret(t *testing.T, list map[string]any, secret string) {
	t.Helper()
	raw, err := json.Marshal(list)
	if err != nil {
		t.Fatal(err)
	}
	if secret != "" && strings.Contains(string(raw), secret) {
		t.Fatal("list included the bot secret")
	}
	var walk func(any)
	walk = func(v any) {
		switch x := v.(type) {
		case map[string]any:
			for k, child := range x {
				switch k {
				case "token", "tokenHash", "token_hash", "secret":
					t.Fatalf("unexpected field %s", k)
				}
				walk(child)
			}
		case []any:
			for _, child := range x {
				walk(child)
			}
		}
	}
	walk(list)
}
