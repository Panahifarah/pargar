package api

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"pargar/backend/internal/models"
)

func (s *Server) handleListEvents(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	events, err := s.store.ListUpcomingEvents(r.Context(), u.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "بارگذاری رویدادها ممکن نشد")
		return
	}
	if events == nil {
		events = []models.Event{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"events": events})
}

func (s *Server) handleGetEvent(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	id := routeID(r, "id")
	e, err := s.store.GetEvent(r.Context(), id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "رویداد پیدا نشد")
		return
	}
	e.Rsvped = s.rsvped(r, e.ID, u.ID)
	writeJSON(w, http.StatusOK, map[string]any{"event": e})
}

func (s *Server) rsvped(r *http.Request, eventID, userID int64) bool {
	events, err := s.store.ListUpcomingEvents(r.Context(), userID)
	if err != nil {
		return false
	}
	for _, e := range events {
		if e.ID == eventID {
			return e.Rsvped
		}
	}
	return false
}

func (s *Server) handleRsvp(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	id := routeID(r, "id")
	if err := s.store.Rsvp(r.Context(), id, u.ID); err != nil {
		writeErr(w, http.StatusInternalServerError, "ثبت‌نام در رویداد ممکن نشد")
		return
	}
	e, err := s.store.GetEvent(r.Context(), id)
	if err == nil {
		go func() {
			_ = s.notify.Notify(context.Background(), u.ID, "event", "rsvp",
				"ثبت‌نام رویداد تأیید شد", "شما در رویداد «"+e.Title+"» ثبت‌نام کرده‌اید. هنگام شروع به شما یادآوری می‌کنیم.", "/unwrap?tab=events", nil)
		}()
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "rsvped": true})
}

func (s *Server) handleUnrsvp(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	id := routeID(r, "id")
	if err := s.store.Unrsvp(r.Context(), id, u.ID); err != nil {
		writeErr(w, http.StatusInternalServerError, "لغو ثبت‌نام رویداد ممکن نشد")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "rsvped": false})
}

func (s *Server) handleEventICS(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	id := routeID(r, "id")
	e, err := s.store.GetEvent(r.Context(), id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "رویداد پیدا نشد")
		return
	}
	_ = u // any authenticated user may download
	ics := buildICS(e, s.cfg.PublicURL)
	w.Header().Set("Content-Type", "text/calendar; charset=utf-8")
	w.Header().Set("Content-Disposition", "attachment; filename=event-"+fmt.Sprintf("%d", e.ID)+".ics")
	_, _ = w.Write([]byte(ics))
}

func buildICS(e *models.Event, origin string) string {
	f := func(t time.Time) string { return t.UTC().Format("20060102T150405Z") }
	return fmt.Sprintf(`BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Pargar//Events//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
BEGIN:VEVENT
UID:%d@pargar
DTSTAMP:%s
DTSTART:%s
DTEND:%s
SUMMARY:%s
DESCRIPTION:%s
LOCATION:%s
END:VEVENT
END:VCALENDAR
`, e.ID, f(time.Now()), f(e.StartsAt), f(e.EndsAt),
		escapeICS(e.Title), escapeICS(e.Description), escapeICS(e.ExternalURL))
}

func escapeICS(v string) string {
	out := ""
	for _, r := range v {
		switch r {
		case '\\':
			out += "\\\\"
		case ';':
			out += "\\;"
		case ',':
			out += "\\,"
		case '\n':
			out += "\\n"
		default:
			out += string(r)
		}
	}
	return out
}
