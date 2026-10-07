package api

import (
	"context"
	"time"

	"pargar/backend/internal/config"
	"pargar/backend/internal/store"
)

// Scheduler runs periodic background jobs.
type Scheduler struct {
	store *store.Store
	srv   *Server
	cfg   *config.Config
	stop  chan struct{}
}

// reminder windows (relative to event start)
var reminderWindows = []struct {
	kind string
	dur  time.Duration
}{
	{"1h", time.Hour},
	{"15m", 15 * time.Minute},
}

func NewScheduler(srv *Server, st *store.Store, cfg *config.Config) *Scheduler {
	return &Scheduler{store: st, srv: srv, cfg: cfg, stop: make(chan struct{})}
}

func (sh *Scheduler) Run() {
	ticker := time.NewTicker(30 * time.Second)
	for {
		select {
		case <-sh.stop:
			return
		case <-ticker.C:
			sh.runOnce()
		}
	}
}

func (sh *Scheduler) Stop() { close(sh.stop) }

func (sh *Scheduler) runOnce() {
	ctx := context.Background()
	// 1. event reminders for RSVPers
	now := time.Now()
	for _, win := range reminderWindows {
		startFrom := now.Add(-time.Minute)
		endAt := now.Add(win.dur + time.Minute)
		rows, err := sh.store.Pool().Query(ctx, `
			SELECT DISTINCT r.event_id, r.user_id
			FROM event_rsvps r JOIN events e ON e.id = r.event_id
			WHERE e.is_active AND e.starts_at BETWEEN $1 AND $2`, startFrom, endAt)
		if err != nil {
			continue
		}
		for rows.Next() {
			var eventID, userID int64
			if rows.Scan(&eventID, &userID) != nil {
				continue
			}
			ref := "event:" + itoa(eventID) + ":" + win.kind
			sent, err := sh.store.ReminderSent(ctx, userID, "event_reminder", ref)
			if err != nil || sent {
				continue
			}
			e, err := sh.store.GetEvent(ctx, eventID)
			if err != nil {
				continue
			}
			_ = sh.srv.notify.Notify(ctx, userID, "event", "event_reminder",
				"رویداد "+reminderLabel(win.kind)+" آغاز می‌شود",
				"رویداد «"+e.Title+"» "+reminderHuman(win.kind)+" آغاز می‌شود. نوع برگزاری: "+e.EventType+"؛ برای پیوستن وارد بخش رویدادها شوید.",
				"/unwrap?tab=events", map[string]any{"eventId": eventID})
			_ = sh.store.MarkReminderSent(ctx, userID, "event_reminder", ref)
		}
		rows.Close()
	}

	// 3. streak at risk (missed a day of activity)
	rows2, err := sh.store.Pool().Query(ctx, `
		SELECT id FROM users
		WHERE is_active AND NOT is_locked AND streak_current > 0
		  AND last_activity_date IS NOT NULL AND last_activity_date = (now() - interval '1 day')::date`)
	if err == nil {
		for rows2.Next() {
			var uid int64
			if rows2.Scan(&uid) != nil {
				continue
			}
			ref := time.Now().Format("2006-01-02")
			sent, err := sh.store.ReminderSent(ctx, uid, "streak_at_risk", ref)
			if err != nil || sent {
				continue
			}
			u, err := sh.store.GetUserByID(ctx, uid)
			if err != nil {
				continue
			}
			_ = sh.srv.notify.Notify(ctx, uid, "gamification", "streak_at_risk",
				"زنجیرهٔ فعالیت در خطر است",
				"امروز یک درس را کامل کنید تا زنجیرهٔ "+itoa(int64(u.StreakCurrent))+"روزهٔ شما حفظ شود.",
				"/cap", nil)
			_ = sh.store.MarkReminderSent(ctx, uid, "streak_at_risk", ref)
		}
		rows2.Close()
	}

	if _, err := sh.store.PurgeOldHeartbeats(ctx, 30*24*time.Hour); err != nil {
		// non-fatal: log via notify path would be overkill; ignore
		_ = err
	}
}

func reminderLabel(kind string) string {
	if kind == "15m" {
		return "به‌زودی"
	}
	return "تا یک ساعت دیگر"
}

func reminderHuman(kind string) string {
	return "حدوداً " + reminderLabel(kind)
}
