package api

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"runtime/debug"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"pargar/backend/internal/models"
	"pargar/backend/internal/store"
)

var announcementCategories = map[string]bool{
	"event": true, "progress": true, "gamification": true, "mentor": true,
	"urgent": true, "curriculum": true, "community": true, "system": true,
}

func (s *Server) handleAdminAnnounce(w http.ResponseWriter, r *http.Request) {
	s.createAnnouncement(w, r)
}

func (s *Server) handleAdminListAnnouncements(w http.ResponseWriter, r *http.Request) {
	list, err := s.store.ListAnnouncements(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "بارگذاری اطلاعیه‌ها ممکن نشد")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"announcements": announceViews(list)})
}

func (s *Server) handleAdminUpdateAnnouncement(w http.ResponseWriter, r *http.Request) {
	id := routeID(r, "id")
	a, ok := s.readAnnouncement(w, r)
	if !ok {
		return
	}
	a.ID = id
	if err := s.store.UpdateAnnouncement(r.Context(), a); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, http.StatusNotFound, "اطلاعیه پیدا نشد")
			return
		}
		writeErr(w, http.StatusInternalServerError, "ویرایش اطلاعیه ممکن نشد")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleAdminDeleteAnnouncement(w http.ResponseWriter, r *http.Request) {
	id := routeID(r, "id")
	if err := s.store.DeleteAnnouncement(r.Context(), id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, http.StatusNotFound, "اطلاعیه پیدا نشد")
			return
		}
		writeErr(w, http.StatusInternalServerError, "حذف اطلاعیه ممکن نشد")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handlePinnedAnnouncement(w http.ResponseWriter, r *http.Request) {
	list, err := s.store.RecentAnnouncements(r.Context(), 8)
	var pinned any
	if err == nil {
		for _, a := range list {
			if a.Pinned {
				pinned = announceViews([]store.Announcement{a})[0]
				break
			}
		}
	}
	if pinned == nil {
		if a, perr := s.store.PinnedAnnouncement(r.Context()); perr == nil {
			pinned = announceViews([]store.Announcement{*a})[0]
		}
	}
	views := []map[string]any{}
	if err == nil {
		views = announceViews(list)
	}
	writeJSON(w, http.StatusOK, map[string]any{"announcement": pinned, "announcements": views})
}

func (s *Server) createAnnouncement(w http.ResponseWriter, r *http.Request) {
	a, ok := s.readAnnouncement(w, r)
	if !ok {
		return
	}
	a.CreatedBy = currentUser(r).ID
	if err := s.store.CreateAnnouncement(r.Context(), &a); err != nil {
		writeErr(w, http.StatusInternalServerError, "ثبت اطلاعیه ممکن نشد")
		return
	}
	ids, err := s.store.AllActiveUserIDs(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "بارگذاری کاربران ممکن نشد")
		return
	}
	go func() {
		for _, uid := range ids {
			n := &models.Notification{
				UserID: uid, Category: a.Category, Type: "announcement",
				Title: a.Title, Body: a.Body, Route: a.Route,
			}
			if err := s.store.CreateNotification(context.Background(), n); err == nil {
				_ = s.store.AttachAnnouncement(context.Background(), n.ID, a.ID)
			}
		}
	}()
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "id": a.ID, "recipients": len(ids)})
}

func (s *Server) readAnnouncement(w http.ResponseWriter, r *http.Request) (store.Announcement, bool) {
	var req struct {
		Title    string `json:"title"`
		Body     string `json:"body"`
		Route    string `json:"route"`
		Category string `json:"category"`
		Pinned   bool   `json:"pinned"`
	}
	if err := bodyJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "دادهٔ ارسالی نامعتبر است")
		return store.Announcement{}, false
	}
	req.Title = strings.TrimSpace(req.Title)
	req.Body = strings.TrimSpace(req.Body)
	req.Route = strings.TrimSpace(req.Route)
	if req.Category == "" {
		req.Category = "event"
	}
	if !announcementCategories[req.Category] {
		writeErr(w, http.StatusBadRequest, "دستهٔ اطلاعیه نامعتبر است")
		return store.Announcement{}, false
	}
	if utf8.RuneCountInString(req.Title) < 3 || utf8.RuneCountInString(req.Title) > 200 {
		writeErr(w, http.StatusBadRequest, "عنوان اطلاعیه نامعتبر است")
		return store.Announcement{}, false
	}
	if utf8.RuneCountInString(req.Body) < 8 || utf8.RuneCountInString(req.Body) > 4000 {
		writeErr(w, http.StatusBadRequest, "متن اطلاعیه نامعتبر است")
		return store.Announcement{}, false
	}
	if req.Route != "" && !strings.HasPrefix(req.Route, "/") {
		writeErr(w, http.StatusBadRequest, "مسیر باید با / شروع شود")
		return store.Announcement{}, false
	}
	return store.Announcement{
		Title: req.Title, Body: req.Body, Category: req.Category, Route: req.Route, Pinned: req.Pinned,
	}, true
}

func announceViews(list []store.Announcement) []map[string]any {
	if list == nil {
		return []map[string]any{}
	}
	out := make([]map[string]any, 0, len(list))
	for _, a := range list {
		out = append(out, map[string]any{
			"id": a.ID, "title": a.Title, "body": a.Body, "category": a.Category,
			"route": a.Route, "pinned": a.Pinned, "createdAt": a.CreatedAt, "updatedAt": a.UpdatedAt,
		})
	}
	return out
}

func (s *Server) handleChatPrefs(w http.ResponseWriter, r *http.Request) {
	me := currentUser(r)
	partner := routeID(r, "partner")
	if !s.canChatWith(r.Context(), me, partner) {
		writeErr(w, http.StatusForbidden, "شما اجازهٔ گفتگو با این کاربر را ندارید")
		return
	}
	var req struct {
		PinnedRank *int `json:"pinnedRank"`
		Muted      bool `json:"muted"`
		Archived   bool `json:"archived"`
	}
	if err := bodyJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "دادهٔ ارسالی نامعتبر است")
		return
	}
	if err := s.store.UpsertChatPref(r.Context(), me.ID, partner, req.PinnedRank, req.Muted, req.Archived); err != nil {
		writeErr(w, http.StatusInternalServerError, "ذخیره تنظیم گفتگو ممکن نشد")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleChatMuteAll(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Muted bool `json:"muted"`
	}
	if err := bodyJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "دادهٔ ارسالی نامعتبر است")
		return
	}
	if err := s.store.SetChatMutedAll(r.Context(), currentUser(r).ID, req.Muted); err != nil {
		writeErr(w, http.StatusInternalServerError, "ذخیره ممکن نشد")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "muted": req.Muted})
}

func (s *Server) handleChatPeek(w http.ResponseWriter, r *http.Request) {
	me := currentUser(r)
	partner := routeID(r, "partner")
	if !s.canChatWith(r.Context(), me, partner) {
		writeErr(w, http.StatusForbidden, "شما اجازهٔ گفتگو با این کاربر را ندارید")
		return
	}
	msgs, err := s.store.ListChatMessages(r.Context(), me.ID, partner, 0, 8)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "پیش‌نمایش ممکن نشد")
		return
	}
	if len(msgs) > 8 {
		msgs = msgs[len(msgs)-8:]
	}
	writeJSON(w, http.StatusOK, map[string]any{"messages": msgs})
}

func (s *Server) handleChatUnread(w http.ResponseWriter, r *http.Request) {
	me := currentUser(r)
	partner := routeID(r, "partner")
	if err := s.store.MarkChatUnread(r.Context(), me.ID, partner, me.Role.String()); err != nil {
		writeErr(w, http.StatusInternalServerError, "بازگشت به نخوانده ممکن نشد")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleChatDeleteBoth(w http.ResponseWriter, r *http.Request) {
	me := currentUser(r)
	partner := routeID(r, "partner")
	if r.URL.Query().Get("confirm") != "both" {
		writeErr(w, http.StatusBadRequest, "برای پاک کردن دو طرفه confirm=both لازم است")
		return
	}
	if !s.canChatWith(r.Context(), me, partner) && me.Role != models.RoleAdmin {
		writeErr(w, http.StatusForbidden, "اجازه ندارید")
		return
	}
	if err := s.store.DeleteChatBoth(r.Context(), me.ID, partner); err != nil {
		writeErr(w, http.StatusInternalServerError, "حذف گفتگو ممکن نشد")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleChatBroadcast(w http.ResponseWriter, r *http.Request) {
	me := currentUser(r)
	if !me.Role.IsStaff() {
		writeErr(w, http.StatusForbidden, "فقط مسئول دوره می‌تواند پیام همگانی بفرستد")
		return
	}
	var req struct {
		Body    string  `json:"body"`
		UserIDs []int64 `json:"userIds"`
		All     bool    `json:"all"`
	}
	if err := bodyJSON(r, &req); err != nil || strings.TrimSpace(req.Body) == "" {
		writeErr(w, http.StatusBadRequest, "متن پیام لازم است")
		return
	}
	ids := req.UserIDs
	if req.All {
		var err error
		ids, err = s.store.AllActiveUserIDs(r.Context())
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "بارگذاری کاربران ممکن نشد")
			return
		}
	}
	sent := 0
	for _, id := range ids {
		if id == me.ID || !s.canChatWith(r.Context(), me, id) {
			continue
		}
		studentID, mentorID := id, me.ID
		if me.Role == models.RoleStudent {
			studentID, mentorID = me.ID, id
		}
		if _, err := s.store.AddChatMessage(r.Context(), studentID, mentorID, me.Role, strings.TrimSpace(req.Body), nil, nil); err == nil {
			sent++
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"sent": sent})
}

func (s *Server) handleSaveMessage(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Body           string `json:"body"`
		AttachmentURL  string `json:"attachmentUrl"`
		AttachmentType string `json:"attachmentType"`
		AttachmentName string `json:"attachmentName"`
	}
	if err := bodyJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "دادهٔ ارسالی نامعتبر است")
		return
	}
	if strings.TrimSpace(req.Body) == "" && req.AttachmentURL == "" {
		writeErr(w, http.StatusBadRequest, "پیامی برای ذخیره نیست")
		return
	}
	me := currentUser(r)
	var att *models.Attachment
	if req.AttachmentURL != "" {
		url := req.AttachmentURL
		if q := strings.Index(url, "?"); q >= 0 {
			url = url[:q]
		}
		att = &models.Attachment{Type: req.AttachmentType, URL: url, Name: req.AttachmentName}
	}
	var saved []models.Attachment
	if att != nil {
		saved = []models.Attachment{*att}
	}
	if _, err := s.store.AddChatMessage(r.Context(), me.ID, me.ID, me.Role, strings.TrimSpace(req.Body), nil, saved); err != nil {
		writeErr(w, http.StatusInternalServerError, "ذخیره ممکن نشد")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleListSaved(w http.ResponseWriter, r *http.Request) {
	list, err := s.store.ListSaved(r.Context(), currentUser(r).ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "بارگذاری ممکن نشد")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"messages": list})
}

func (s *Server) handleGetMeProfile(w http.ResponseWriter, r *http.Request) {
	p, err := s.store.GetProfileExtras(r.Context(), currentUser(r).ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "بارگذاری پروفایل ممکن نشد")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"profile": s.profileView(p)})
}

func (s *Server) handlePutMeProfile(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Banner       *string         `json:"banner"`
		Public       *bool           `json:"public"`
		ShowActivity *bool           `json:"showActivity"`
		ShowStats    *bool           `json:"showStats"`
		ShowPath     *bool           `json:"showPath"`
		ShowBadges   *bool           `json:"showBadges"`
		SocialLinks  json.RawMessage `json:"socialLinks"`
		Theme        *string         `json:"theme"`
	}
	if err := bodyJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "دادهٔ ارسالی نامعتبر است")
		return
	}
	cur, err := s.store.GetProfileExtras(r.Context(), currentUser(r).ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "بارگذاری پروفایل ممکن نشد")
		return
	}
	if req.Banner != nil {
		cur.Banner = strings.TrimSpace(*req.Banner)
	}
	if req.Public != nil {
		cur.Public = *req.Public
	}
	if req.ShowActivity != nil {
		cur.ShowActivity = *req.ShowActivity
	}
	if req.ShowStats != nil {
		cur.ShowStats = *req.ShowStats
	}
	if req.ShowPath != nil {
		cur.ShowPath = *req.ShowPath
	}
	if req.ShowBadges != nil {
		cur.ShowBadges = *req.ShowBadges
	}
	if req.Theme != nil {
		cur.Theme = strings.TrimSpace(*req.Theme)
	}
	if len(req.SocialLinks) > 0 {
		var links []map[string]string
		if err := json.Unmarshal(req.SocialLinks, &links); err != nil || len(links) > 5 {
			writeErr(w, http.StatusBadRequest, "حداکثر ۵ لینک شخصی مجاز است")
			return
		}
		cur.SocialLinks = req.SocialLinks
	}
	if i := strings.Index(cur.Banner, "?"); i >= 0 {
		cur.Banner = cur.Banner[:i]
	}
	if err := s.store.SaveProfileExtras(r.Context(), currentUser(r).ID, cur); err != nil {
		writeErr(w, http.StatusInternalServerError, "ذخیره پروفایل ممکن نشد")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"profile": s.profileView(cur)})
}

func (s *Server) profileView(p store.ProfileExtras) map[string]any {
	links := json.RawMessage(p.SocialLinks)
	if len(links) == 0 {
		links = json.RawMessage(`[]`)
	}
	banner := p.Banner
	if i := strings.Index(banner, "?"); i >= 0 {
		banner = banner[:i]
	}
	return map[string]any{
		"banner": s.signExistingMediaURL(banner), "public": p.Public, "showActivity": p.ShowActivity,
		"showStats": p.ShowStats, "showPath": p.ShowPath, "showBadges": p.ShowBadges,
		"socialLinks": json.RawMessage(links), "theme": p.Theme,
	}
}

func (s *Server) handleMeAchievements(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	writeJSON(w, http.StatusOK, map[string]any{"achievements": s.achievementsFor(r.Context(), u)})
}

func (s *Server) achievementsFor(ctx context.Context, u *models.User) []map[string]any {
	passed := 0
	_ = s.store.Pool().QueryRow(ctx, `SELECT count(*) FROM lesson_progress WHERE user_id=$1 AND passed_quiz`, u.ID).Scan(&passed)
	certs := 0
	_ = s.store.Pool().QueryRow(ctx, `SELECT count(*) FROM certificates WHERE user_id=$1 AND revoked_at IS NULL`, u.ID).Scan(&certs)
	items := []struct {
		id, title string
		on        bool
	}{
		{"first_pass", "اولین قبولی", passed > 0},
		{"chapter_done", "اتمام فصل", s.finishedChapter(ctx, u.ID)},
		{"streak_7", "استمرار هفت‌روزه", u.StreakCurrent >= 7 || u.StreakLongest >= 7},
		{"course_done", "پایان دوره", certs > 0},
	}
	out := make([]map[string]any, 0, len(items))
	for _, it := range items {
		out = append(out, map[string]any{"id": it.id, "title": it.title, "unlocked": it.on})
	}
	return out
}

func (s *Server) finishedChapter(ctx context.Context, userID int64) bool {
	var n int
	err := s.store.Pool().QueryRow(ctx, `
		SELECT count(*) FROM chapters c
		WHERE EXISTS (SELECT 1 FROM lessons l WHERE l.chapter_id=c.id)
		  AND NOT EXISTS (
			SELECT 1 FROM lessons l
			LEFT JOIN lesson_progress p ON p.lesson_id=l.id AND p.user_id=$1
			WHERE l.chapter_id=c.id AND COALESCE(p.passed_quiz, false)=false
		  )`, userID).Scan(&n)
	return err == nil && n > 0
}

func (s *Server) handleMeActivity(w http.ResponseWriter, r *http.Request) {
	rows, err := s.store.Pool().Query(r.Context(), `
		SELECT day::text, count(*) FROM (
			SELECT created_at::date AS day FROM quiz_attempts WHERE user_id=$1
			UNION ALL
			SELECT created_at::date FROM chat_messages WHERE user_id=$1 OR mentor_id=$1
		) d
		WHERE day >= current_date - 120
		GROUP BY day ORDER BY day`, currentUser(r).ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "بارگذاری فعالیت ممکن نشد")
		return
	}
	defer rows.Close()
	var days []map[string]any
	for rows.Next() {
		var day string
		var n int
		if err := rows.Scan(&day, &n); err != nil {
			continue
		}
		days = append(days, map[string]any{"day": day, "count": n})
	}
	if days == nil {
		days = []map[string]any{}
	}
	week, month := 0, 0
	_ = s.store.Pool().QueryRow(r.Context(), `
		SELECT
			count(*) FILTER (WHERE day >= current_date - 6),
			count(*) FILTER (WHERE day >= current_date - 29)
		FROM (
			SELECT DISTINCT created_at::date AS day FROM quiz_attempts WHERE user_id=$1
			UNION
			SELECT DISTINCT created_at::date FROM chat_messages WHERE user_id=$1 OR mentor_id=$1
		) d`, currentUser(r).ID).Scan(&week, &month)
	writeJSON(w, http.StatusOK, map[string]any{"days": days, "weekDays": week, "monthDays": month})
}

func (s *Server) handleSearch(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if utf8.RuneCountInString(q) < 2 {
		writeJSON(w, http.StatusOK, map[string]any{"results": []any{}})
		return
	}
	me := currentUser(r)
	like := "%" + q + "%"
	var results []map[string]any
	rows, err := s.store.Pool().Query(r.Context(), `
		SELECT id, title FROM lessons WHERE title ILIKE $1 ORDER BY id LIMIT 8`, like)
	if err == nil {
		for rows.Next() {
			var id int64
			var title string
			if rows.Scan(&id, &title) == nil {
				results = append(results, map[string]any{"kind": "lesson", "title": title, "href": "/player/" + strconv.FormatInt(id, 10)})
			}
		}
		rows.Close()
	}
	rows, err = s.store.Pool().Query(r.Context(), `
		SELECT id, title FROM events WHERE title ILIKE $1 ORDER BY starts_at DESC LIMIT 8`, like)
	if err == nil {
		for rows.Next() {
			var id int64
			var title string
			if rows.Scan(&id, &title) == nil {
				results = append(results, map[string]any{"kind": "event", "title": title, "href": "/unwrap"})
			}
		}
		rows.Close()
	}
	if me.Role.IsStaff() {
		people, _, _ := s.store.ListUsers(r.Context(), q, "", 8, 0)
		for _, p := range people {
			results = append(results, map[string]any{"kind": "person", "title": p.Name, "href": "/profile/" + strconv.FormatInt(p.ID, 10)})
		}
	} else {
		people, _, _ := s.store.ListActiveByRoles(r.Context(), []string{"mentor", "admin"}, 40, 0)
		n := 0
		for _, p := range people {
			if n >= 8 || !strings.Contains(strings.ToLower(p.Name), strings.ToLower(q)) {
				continue
			}
			results = append(results, map[string]any{"kind": "person", "title": p.Name, "href": "/profile/" + strconv.FormatInt(p.ID, 10)})
			n++
		}
	}
	pages := []struct{ title, href string }{
		{"درخت مهارت", "/cap"}, {"اعلان‌ها", "/notifications"}, {"لیگ", "/leaderboard"},
		{"تنظیمات", "/settings"}, {"پروفایل", "/profile"},
	}
	for _, p := range pages {
		if strings.Contains(p.title, q) {
			results = append(results, map[string]any{"kind": "page", "title": p.title, "href": p.href})
		}
	}
	if results == nil {
		results = []map[string]any{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}

func (s *Server) handleMeta(w http.ResponseWriter, r *http.Request) {
	env := "production"
	if s.cfg.DevMode {
		env = "development"
	}
	version, built := appBuild()
	writeJSON(w, http.StatusOK, map[string]any{
		"version": version,
		"built":   built,
		"env":     env,
		"health":  "ok",
	})
}

func appBuild() (version, built string) {
	version = "0.2.0"
	built = "dev"
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return version, built
	}
	for _, setting := range info.Settings {
		if setting.Key == "vcs.time" && len(setting.Value) >= 10 {
			built = setting.Value[:10]
		}
		if setting.Key == "vcs.revision" && len(setting.Value) >= 7 {
			version = "0.2.0+" + setting.Value[:7]
		}
	}
	return version, built
}

func (s *Server) handleAdminListBots(w http.ResponseWriter, r *http.Request) {
	p := parsePageParams(r)
	p.PageSize = 8
	p.Offset = (p.Page - 1) * p.PageSize

	var total int64
	if err := s.store.Pool().QueryRow(r.Context(), `SELECT count(*) FROM bot_tokens`).Scan(&total); err != nil {
		writeErr(w, http.StatusInternalServerError, "بارگذاری کلیدها ممکن نشد")
		return
	}
	rows, err := s.store.Pool().Query(r.Context(), `
		SELECT bt.id, bt.bot_user_id, COALESCE(u.name, ''), bt.created_at, bt.revoked_at IS NULL, bt.request_count
		FROM bot_tokens bt
		JOIN users u ON u.id = bt.bot_user_id
		ORDER BY bt.id DESC
		LIMIT $1 OFFSET $2`, p.PageSize, p.Offset)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "بارگذاری کلیدها ممکن نشد")
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id, botID, requestCount int64
		var name string
		var createdAt time.Time
		var active bool
		if rows.Scan(&id, &botID, &name, &createdAt, &active, &requestCount) != nil {
			continue
		}
		items = append(items, map[string]any{
			"id":           id,
			"botId":        botID,
			"name":         name,
			"createdAt":    createdAt,
			"active":       active,
			"requestCount": requestCount,
		})
	}
	writePage(w, items, total, p)
}

func (s *Server) handleAdminSetBotActive(w http.ResponseWriter, r *http.Request) {
	id := routeID(r, "id")
	if id == 0 {
		writeErr(w, http.StatusBadRequest, "شناسه نامعتبر است")
		return
	}
	var req struct {
		Active bool `json:"active"`
	}
	if err := bodyJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "دادهٔ ارسالی نامعتبر است")
		return
	}
	var err error
	var updated int64
	if req.Active {
		tag, execErr := s.store.Pool().Exec(r.Context(), `UPDATE bot_tokens SET revoked_at=NULL WHERE id=$1`, id)
		err = execErr
		updated = tag.RowsAffected()
	} else {
		tag, execErr := s.store.Pool().Exec(r.Context(), `UPDATE bot_tokens SET revoked_at=COALESCE(revoked_at, now()) WHERE id=$1`, id)
		err = execErr
		updated = tag.RowsAffected()
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "به‌روزرسانی ممکن نشد")
		return
	}
	if updated == 0 {
		writeErr(w, http.StatusNotFound, "کلید پیدا نشد")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "active": req.Active})
}

func (s *Server) handleCreateBot(w http.ResponseWriter, r *http.Request) {
	me := currentUser(r)
	var req struct {
		Name string `json:"name"`
	}
	_ = bodyJSON(r, &req)
	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = "ربات پرگار"
	}
	raw := make([]byte, 24)
	_, _ = rand.Read(raw)
	token := hex.EncodeToString(raw)
	sum := sha256.Sum256([]byte(token))
	hash := hex.EncodeToString(sum[:])
	email := "bot-" + token[:8] + "@bots.pargar.local"
	bot, err := s.store.CreateUser(r.Context(), name, email, "bot"+token[:6], hash, "", "", "", models.RoleMentor)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "ساخت ربات ممکن نشد")
		return
	}
	if _, err := s.store.Pool().Exec(r.Context(), `
		INSERT INTO bot_tokens (bot_user_id, owner_id, token_hash) VALUES ($1,$2,$3)`, bot.ID, me.ID, hash); err != nil {
		writeErr(w, http.StatusInternalServerError, "ثبت توکن ممکن نشد")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"botId": bot.ID, "token": token})
}

func (s *Server) botFromRequest(r *http.Request) (int64, int64, bool) {
	token := strings.TrimSpace(r.Header.Get("X-Bot-Token"))
	if token == "" {
		return 0, 0, false
	}
	sum := sha256.Sum256([]byte(token))
	hash := hex.EncodeToString(sum[:])
	var botID, ownerID int64
	var active bool
	err := s.store.Pool().QueryRow(r.Context(), `
		SELECT bot_user_id, owner_id, revoked_at IS NULL FROM bot_tokens WHERE token_hash=$1`, hash).Scan(&botID, &ownerID, &active)
	if err != nil || !active {
		return 0, 0, false
	}
	_, _ = s.store.Pool().Exec(r.Context(), `
		UPDATE bot_tokens SET request_count = request_count + 1 WHERE token_hash=$1 AND revoked_at IS NULL`, hash)
	return botID, ownerID, true
}

func (s *Server) handleBotSend(w http.ResponseWriter, r *http.Request) {
	botID, _, ok := s.botFromRequest(r)
	if !ok {
		writeErr(w, http.StatusUnauthorized, "توکن ربات نامعتبر است")
		return
	}
	var req struct {
		UserID  int64  `json:"userId"`
		Text    string `json:"text"`
		Buttons []any  `json:"buttons"`
	}
	if err := bodyJSON(r, &req); err != nil || req.UserID == 0 || strings.TrimSpace(req.Text) == "" {
		writeErr(w, http.StatusBadRequest, "userId و text لازم است")
		return
	}
	buttons, _ := json.Marshal(req.Buttons)
	var id int64
	err := s.store.Pool().QueryRow(r.Context(), `
		INSERT INTO chat_messages (user_id, mentor_id, sender_role, body, buttons)
		VALUES ($1,$2,'mentor',$3,$4) RETURNING id`,
		req.UserID, botID, strings.TrimSpace(req.Text), buttons).Scan(&id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "ارسال ممکن نشد")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"messageId": id})
}

func (s *Server) handleBotUpdates(w http.ResponseWriter, r *http.Request) {
	botID, _, ok := s.botFromRequest(r)
	if !ok {
		writeErr(w, http.StatusUnauthorized, "توکن ربات نامعتبر است")
		return
	}
	after, _ := strconv.ParseInt(r.URL.Query().Get("offset"), 10, 64)
	rows, err := s.store.Pool().Query(r.Context(), `
		SELECT id, payload, created_at FROM bot_updates WHERE bot_user_id=$1 AND id>$2 ORDER BY id LIMIT 50`, botID, after)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "بارگذاری ممکن نشد")
		return
	}
	defer rows.Close()
	var updates []map[string]any
	for rows.Next() {
		var id int64
		var payload json.RawMessage
		var at time.Time
		if rows.Scan(&id, &payload, &at) == nil {
			updates = append(updates, map[string]any{"id": id, "payload": json.RawMessage(payload), "createdAt": at})
		}
	}
	if updates == nil {
		updates = []map[string]any{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"updates": updates})
}

func (s *Server) recordBotReply(ctx context.Context, from *models.User, partnerID int64, body string) {
	var ownerID int64
	err := s.store.Pool().QueryRow(ctx, `SELECT owner_id FROM bot_tokens WHERE bot_user_id=$1`, partnerID).Scan(&ownerID)
	if err != nil {
		return
	}
	payload, _ := json.Marshal(map[string]any{"from": from.ID, "name": from.Name, "text": body})
	_, _ = s.store.Pool().Exec(ctx, `INSERT INTO bot_updates (bot_user_id, payload) VALUES ($1,$2)`, partnerID, payload)
	_ = ownerID
}

func (s *Server) noteBotReply(r *http.Request, partner int64, body string) {
	s.recordBotReply(r.Context(), currentUser(r), partner, body)
}

// silence unused import if pgx is only used by callers
var _ = pgx.ErrNoRows
