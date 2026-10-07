package api_test

import (
	"testing"
	"time"
)

func TestAdminEventCreateUpdateIsActive(t *testing.T) {
	e := setup(t)
	token := login(t, e, bootstrapAdminEmail)

	starts := time.Now().UTC().Add(2 * time.Hour).Truncate(time.Second)
	ends := starts.Add(time.Hour)
	status, body := e.do(t, "POST", "/api/admin/events", token, map[string]any{
		"title":       "جلسه تست",
		"description": "توضیح",
		"eventType":   "workshop",
		"externalUrl": "https://example.com/meet",
		"startsAt":    starts.Format(time.RFC3339),
		"endsAt":      ends.Format(time.RFC3339),
		"isActive":    false,
	})
	if status != 201 {
		t.Fatalf("create status=%d body=%v", status, body)
	}
	id, _ := body["id"].(float64)
	if id == 0 {
		t.Fatalf("missing id: %v", body)
	}

	status, list := e.do(t, "GET", "/api/admin/events", token, nil)
	if status != 200 {
		t.Fatalf("list status=%d", status)
	}
	events, _ := list["events"].([]any)
	found := false
	for _, raw := range events {
		ev, _ := raw.(map[string]any)
		if ev["id"] == id {
			found = true
			if ev["isActive"] != false {
				t.Fatalf("expected isActive=false, got %#v", ev["isActive"])
			}
		}
	}
	if !found {
		t.Fatal("created event not in list")
	}

	status, _ = e.do(t, "PUT", "/api/admin/events/"+itoa(int64(id)), token, map[string]any{
		"title":       "جلسه تست",
		"description": "توضیح",
		"eventType":   "workshop",
		"externalUrl": "https://example.com/meet",
		"startsAt":    starts.Format(time.RFC3339),
		"endsAt":      ends.Format(time.RFC3339),
		"isActive":    true,
	})
	if status != 200 {
		t.Fatalf("update status=%d", status)
	}

	status, bad := e.do(t, "PUT", "/api/admin/events/"+itoa(int64(id)), token, map[string]any{
		"title":     "بازه بد",
		"eventType": "meet",
		"startsAt":  ends.Format(time.RFC3339),
		"endsAt":    starts.Format(time.RFC3339),
		"isActive":  true,
	})
	if status != 400 {
		t.Fatalf("expected 400 for inverted range, got %d body=%v", status, bad)
	}
}

func TestAdminChallengeCRUD(t *testing.T) {
	e := setup(t)
	token := login(t, e, bootstrapAdminEmail)

	starts := time.Now().UTC().Add(-time.Hour).Truncate(time.Second)
	ends := starts.Add(30 * 24 * time.Hour)
	status, body := e.do(t, "POST", "/api/admin/challenges", token, map[string]any{
		"title":       "چالش ماه",
		"description": "۵۰۰ امتیاز",
		"targetXp":    500,
		"startsAt":    starts.Format(time.RFC3339),
		"endsAt":      ends.Format(time.RFC3339),
		"isActive":    true,
	})
	if status != 201 {
		t.Fatalf("create challenge status=%d body=%v", status, body)
	}

	status, mine := e.do(t, "GET", "/api/challenges", token, nil)
	if status != 200 {
		t.Fatalf("list challenges status=%d", status)
	}
	chs, _ := mine["challenges"].([]any)
	if len(chs) == 0 {
		t.Fatal("expected active challenge for student/admin")
	}
}
