package api

import (
	"archive/zip"
	"context"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"pargar/backend/internal/models"
	"pargar/backend/internal/observability"
)

const (
	meExportHTMLBase       int64 = 8 * 1024
	meExportHTMLPerMessage int64 = 512
)

func (s *Server) handleMeExport(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	if u == nil {
		writeErr(w, http.StatusUnauthorized, "ابتدا وارد شوید")
		return
	}
	partnerID, ok := meExportChatID(r)
	if !ok {
		writeErr(w, http.StatusBadRequest, "گفتگو را مشخص کنید")
		return
	}
	if !s.canChatWith(r.Context(), u, partnerID) {
		writeErr(w, http.StatusNotFound, "گفتگو پیدا نشد")
		return
	}
	if r.URL.Query().Get("meta") == "1" {
		n, last, err := s.estimateMeExportBytes(r.Context(), u.ID, partnerID)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "برآورد حجم خروجی ممکن نشد")
			return
		}
		payload := map[string]any{"bytes": n, "chat": partnerID}
		if last != nil && !last.IsZero() {
			payload["lastAt"] = last.UTC()
		}
		writeJSON(w, http.StatusOK, payload)
		return
	}
	if err := s.writeMeChatHTMLZip(w, r, u, partnerID); err != nil {
		observability.L().Error("me.export_zip", "error", err, "user_id", u.ID, "chat", partnerID)
	}
}

func meExportChatID(r *http.Request) (int64, bool) {
	raw := strings.TrimSpace(r.URL.Query().Get("chat"))
	if raw == "" {
		return 0, false
	}
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id <= 0 {
		return 0, false
	}
	return id, true
}

func (s *Server) estimateMeExportBytes(ctx context.Context, userID, partnerID int64) (int64, *time.Time, error) {
	var messages, media int64
	var last *time.Time
	err := s.store.Pool().QueryRow(ctx, `
		SELECT
			count(*)::bigint,
			COALESCE(SUM(
				CASE
					WHEN attachments IS NOT NULL
						AND jsonb_typeof(attachments) = 'array'
						AND jsonb_array_length(attachments) > 0
					THEN COALESCE((
						SELECT SUM(GREATEST(COALESCE((elem->>'size')::bigint, 0), 0))
						FROM jsonb_array_elements(attachments) AS elem
					), 0)
					ELSE GREATEST(COALESCE(attachment_size, 0), 0)
				END
			), 0)::bigint,
			MAX(created_at)
		FROM chat_messages
		WHERE (user_id = $1 AND mentor_id = $2) OR (user_id = $2 AND mentor_id = $1)`, userID, partnerID).Scan(&messages, &media, &last)
	if err != nil {
		return 0, nil, err
	}
	return media + meExportHTMLBase + messages*meExportHTMLPerMessage, last, nil
}

type meExportMessage struct {
	ID          int64
	UserID      int64
	MentorID    int64
	SenderRole  string
	Body        string
	CreatedAt   time.Time
	StudentName string
	MentorName  string
	Atts        []models.Attachment
}

type meExportFile struct {
	Path string
	Key  string
}

type mePlaced struct {
	msg meExportMessage
	rel []string
}

func (s *Server) writeMeChatHTMLZip(w http.ResponseWriter, r *http.Request, u *models.User, partnerID int64) error {
	title := "پیام‌های ذخیره‌شده"
	if partnerID != u.ID {
		partner, err := s.store.GetUserByID(r.Context(), partnerID)
		if err != nil {
			writeErr(w, http.StatusNotFound, "گفتگو پیدا نشد")
			return err
		}
		title = strings.TrimSpace(partner.Name)
		if title == "" {
			title = "گفتگو"
		}
	}
	rows, err := s.store.Pool().Query(r.Context(), `
		SELECT m.id, m.user_id, m.mentor_id, m.sender_role, m.body, m.created_at,
			m.attachment_type, m.attachment_url, m.attachment_name, m.attachment_size, m.attachments,
			COALESCE(su.name, ''), COALESCE(mu.name, '')
		FROM chat_messages m
		LEFT JOIN users su ON su.id = m.user_id
		LEFT JOIN users mu ON mu.id = m.mentor_id
		WHERE (m.user_id = $1 AND m.mentor_id = $2) OR (m.user_id = $2 AND m.mentor_id = $1)
		ORDER BY m.created_at ASC, m.id ASC`, u.ID, partnerID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "ساخت خروجی گفتگوها ممکن نشد")
		return err
	}
	defer rows.Close()

	var messages []meExportMessage
	for rows.Next() {
		var m meExportMessage
		var attType, attURL, attName *string
		var attSize *int64
		var rawAtts []byte
		if err := rows.Scan(
			&m.ID, &m.UserID, &m.MentorID, &m.SenderRole, &m.Body, &m.CreatedAt,
			&attType, &attURL, &attName, &attSize, &rawAtts,
			&m.StudentName, &m.MentorName,
		); err != nil {
			continue
		}
		m.Atts = decodeExportAttachments(rawAtts, attType, attURL, attName, attSize)
		messages = append(messages, m)
	}
	if err := rows.Err(); err != nil {
		writeErr(w, http.StatusInternalServerError, "ساخت خروجی گفتگوها ممکن نشد")
		return err
	}

	placed := make([]mePlaced, 0, len(messages))
	var files []meExportFile
	seen := map[string]bool{}
	for _, m := range messages {
		item := mePlaced{msg: m, rel: make([]string, len(m.Atts))}
		for i, att := range m.Atts {
			key := mediaKeyFromURL(att.URL)
			if key == "" || strings.Contains(key, "..") || !exportKeyAllowed(key, u.ID, m.UserID, m.MentorID) || !s.storage.Exists(key) {
				continue
			}
			label := safeExportFilename(att.Name)
			rel := filepath.ToSlash(filepath.Join("media", fmt.Sprintf("%d-%d-%s", m.ID, i+1, label)))
			if seen[rel] {
				rel = filepath.ToSlash(filepath.Join("media", fmt.Sprintf("%d-%d-b-%s", m.ID, i+1, label)))
			}
			seen[rel] = true
			item.rel[i] = rel
			files = append(files, meExportFile{Path: rel, Key: key})
		}
		placed = append(placed, item)
	}

	doc := renderMeExportHTML(u, title, placed)
	tmp, err := os.CreateTemp("", "pargar-chats-*.zip")
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "ساخت خروجی گفتگوها ممکن نشد")
		return err
	}
	tmpName := tmp.Name()
	defer func() {
		_ = tmp.Close()
		_ = os.Remove(tmpName)
	}()

	zw := zip.NewWriter(tmp)
	hw, err := zw.CreateHeader(&zip.FileHeader{
		Name:     "index.html",
		Method:   zip.Deflate,
		Modified: time.Now().UTC(),
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "ساخت خروجی گفتگوها ممکن نشد")
		return err
	}
	if _, err := io.WriteString(hw, doc); err != nil {
		writeErr(w, http.StatusInternalServerError, "ساخت خروجی گفتگوها ممکن نشد")
		return err
	}
	for _, f := range files {
		rc, _, _, err := s.storage.Open(f.Key)
		if err != nil {
			continue
		}
		aw, err := zw.CreateHeader(&zip.FileHeader{
			Name:     f.Path,
			Method:   zip.Deflate,
			Modified: time.Now().UTC(),
		})
		if err != nil {
			_ = rc.Close()
			writeErr(w, http.StatusInternalServerError, "ساخت خروجی گفتگوها ممکن نشد")
			return err
		}
		_, copyErr := io.Copy(aw, rc)
		_ = rc.Close()
		if copyErr != nil {
			writeErr(w, http.StatusInternalServerError, "ساخت خروجی گفتگوها ممکن نشد")
			return copyErr
		}
	}
	if err := zw.Close(); err != nil {
		writeErr(w, http.StatusInternalServerError, "ساخت خروجی گفتگوها ممکن نشد")
		return err
	}
	if _, err := tmp.Seek(0, io.SeekStart); err != nil {
		writeErr(w, http.StatusInternalServerError, "ساخت خروجی گفتگوها ممکن نشد")
		return err
	}
	info, err := tmp.Stat()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "ساخت خروجی گفتگوها ممکن نشد")
		return err
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="pargar-chat-%d.zip"`, partnerID))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Content-Length", strconv.FormatInt(info.Size(), 10))
	w.WriteHeader(http.StatusOK)
	_, err = io.Copy(w, tmp)
	return err
}

func exportKeyAllowed(key string, me, studentID, mentorID int64) bool {
	return mediaKeyOwnedByUser(key, me) || mediaKeyOwnedByUser(key, studentID) || mediaKeyOwnedByUser(key, mentorID)
}

func decodeExportAttachments(raw []byte, attType, attURL, attName *string, attSize *int64) []models.Attachment {
	if len(raw) > 0 && string(raw) != "null" && string(raw) != "[]" {
		var list []models.Attachment
		if err := json.Unmarshal(raw, &list); err == nil && len(list) > 0 {
			return list
		}
	}
	if attURL != nil && *attURL != "" {
		size := int64(0)
		if attSize != nil {
			size = *attSize
		}
		typ, name := "", ""
		if attType != nil {
			typ = *attType
		}
		if attName != nil {
			name = *attName
		}
		return []models.Attachment{{Type: typ, URL: *attURL, Name: name, Size: size}}
	}
	return nil
}

func renderMeExportHTML(owner *models.User, title string, messages []mePlaced) string {
	var b strings.Builder
	b.WriteString(`<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>`)
	b.WriteString(html.EscapeString(title))
	b.WriteString(`</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: #eceef8;
    color: #2a2745;
    font-family: Vazirmatn, "IRANSans", Tahoma, sans-serif;
  }
  .sheet {
    max-width: 440px;
    margin: 24px auto 40px;
    overflow: hidden;
    background: #f7f7fc;
    border: 1px solid rgba(255,255,255,.75);
    border-radius: 26px;
    box-shadow: 0 24px 70px -18px rgba(42,39,69,.35);
  }
  header.bar {
    position: relative;
    padding: 16px 16px 12px;
    background: rgba(255,255,255,.78);
    border-bottom: 1px solid #e3e5f2;
  }
  header.bar::before {
    content: "";
    position: absolute;
    inset: 0 0 auto 0;
    height: 3px;
    background: linear-gradient(to left, #6d63f0, #ec6fa9, #f2a437);
  }
  header.bar h1 { margin: 0; font-size: .95rem; font-weight: 800; }
  header.bar p { margin: 3px 0 0; color: #6b6c8a; font-size: .75rem; }
  .log { min-height: 240px; padding: 12px 12px 18px; }
  .day { display: flex; justify-content: center; margin: 10px 0 8px; }
  .day span {
    border: 1px solid #d9dbe9;
    background: rgba(255,255,255,.9);
    color: #6b6c8a;
    border-radius: 999px;
    padding: 3px 10px;
    font-size: 10px;
    font-weight: 700;
  }
  article.msg { display: flex; margin: 0 0 6px; }
  article.msg.mine { justify-content: flex-start; }
  article.msg.theirs { justify-content: flex-end; }
  .stack { display: flex; flex-direction: column; max-width: min(78%, 20rem); }
  article.mine .stack { align-items: flex-start; }
  article.theirs .stack { align-items: flex-end; }
  .who { margin: 0 6px 3px; font-size: 11px; font-weight: 800; color: #6b6c8a; }
  .bubble {
    width: fit-content;
    max-width: 100%;
    padding: 8px 14px;
    font-size: .875rem;
    line-height: 1.65;
  }
  article.mine .bubble {
    background: #6d63f0;
    color: #fff;
    border-radius: 18px 6px 18px 18px;
    box-shadow: 0 1px 1px rgba(0,0,0,.12);
  }
  article.theirs .bubble {
    background: #fff;
    color: #2a2745;
    border: 1px solid #d9dbe9;
    border-radius: 6px 18px 18px 18px;
    box-shadow: 0 1px 1px rgba(0,0,0,.06);
  }
  .body {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: break-word;
    unicode-bidi: plaintext;
  }
  time { display: block; margin-top: 4px; font-size: 10px; line-height: 1; opacity: .78; }
  article.mine time { text-align: right; }
  article.theirs time { text-align: left; }
  img, video {
    display: block;
    max-width: min(100%, 240px);
    height: auto;
    border-radius: 12px;
    margin-top: 6px;
  }
  audio { display: block; width: min(100%, 240px); margin-top: 6px; }
  .file, .missing { margin: 6px 0 0; font-size: .82rem; }
  article.mine a { color: #fff; }
  article.theirs a { color: #4c45c6; }
  .missing { opacity: .85; }
  .empty { margin: 28px 8px; text-align: center; color: #6b6c8a; font-size: .875rem; }
</style>
</head>
<body>
<main class="sheet">
<header class="bar">
  <h1>`)
	b.WriteString(html.EscapeString(title))
	b.WriteString(`</h1>
  <p>خروجی پرگار · `)
	b.WriteString(html.EscapeString(formatJalaliStamp(time.Now())))
	b.WriteString(`</p>
</header>
<div class="log">
`)
	if len(messages) == 0 {
		b.WriteString(`<p class="empty">هنوز پیامی در این گفتگو نیست.</p>`)
	}
	var hasPrev bool
	var prevMine bool
	var prevAt time.Time
	for _, item := range messages {
		mine := meExportIsMine(owner.ID, item.msg)
		if !hasPrev || !sameExportDay(prevAt, item.msg.CreatedAt) {
			b.WriteString(`<div class="day"><span>`)
			b.WriteString(html.EscapeString(formatJalaliDay(item.msg.CreatedAt)))
			b.WriteString(`</span></div>`)
		}
		showName := !hasPrev || prevMine != mine || !sameExportDay(prevAt, item.msg.CreatedAt)
		cls := "theirs"
		if mine {
			cls = "mine"
		}
		b.WriteString(`<article class="msg ` + cls + `"><div class="stack">`)
		if showName {
			b.WriteString(`<p class="who">`)
			b.WriteString(html.EscapeString(meExportSenderName(owner, item.msg)))
			b.WriteString(`</p>`)
		}
		b.WriteString(`<div class="bubble">`)
		if strings.TrimSpace(item.msg.Body) != "" {
			b.WriteString(`<p class="body">` + escapeExportBody(item.msg.Body) + `</p>`)
		}
		for i, att := range item.msg.Atts {
			rel := ""
			if i < len(item.rel) {
				rel = item.rel[i]
			}
			b.WriteString(renderExportAttachment(att, rel))
		}
		b.WriteString(`<time datetime="` + html.EscapeString(item.msg.CreatedAt.UTC().Format(time.RFC3339)) + `">`)
		b.WriteString(html.EscapeString(formatJalaliStamp(item.msg.CreatedAt)))
		b.WriteString(`</time></div></div></article>`)
		hasPrev = true
		prevMine = mine
		prevAt = item.msg.CreatedAt
	}
	b.WriteString(`</div>
</main>
</body>
</html>
`)
	return b.String()
}

func meExportSenderName(me *models.User, m meExportMessage) string {
	if meExportIsMine(me.ID, m) {
		name := strings.TrimSpace(me.Name)
		if name == "" {
			return "شما"
		}
		return name
	}
	name := m.StudentName
	if me.ID == m.UserID {
		name = m.MentorName
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return "گفتگو"
	}
	return name
}

func sameExportDay(a, b time.Time) bool {
	al := a.In(tehranLocation())
	bl := b.In(tehranLocation())
	return al.Year() == bl.Year() && al.Month() == bl.Month() && al.Day() == bl.Day()
}

func formatJalaliDay(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	local := t.In(tehranLocation())
	_, jm, jd := gregorianToJalali(local.Year(), int(local.Month()), local.Day())
	month := "ماه"
	if jm >= 1 && jm <= len(jalaliMonthNames) {
		month = jalaliMonthNames[jm-1]
	}
	return persianDigits(jd) + " " + month
}

func meExportIsMine(meID int64, m meExportMessage) bool {
	if m.UserID == m.MentorID {
		return true
	}
	role := models.Role(m.SenderRole)
	if meID == m.UserID && role == models.RoleStudent {
		return true
	}
	if meID == m.MentorID && (role == models.RoleMentor || role == models.RoleAdmin) {
		return true
	}
	return false
}

func escapeExportBody(s string) string {
	return html.EscapeString(s)
}

func renderExportAttachment(att models.Attachment, rel string) string {
	name := strings.TrimSpace(att.Name)
	if name == "" {
		name = "فایل"
	}
	safe := html.EscapeString(name)
	if rel == "" {
		return `<p class="missing">فایل همراه موجود نیست: ` + safe + `</p>`
	}
	src := html.EscapeString(rel)
	switch strings.ToLower(strings.TrimSpace(att.Type)) {
	case "image":
		return `<img src="` + src + `" alt="` + safe + `">`
	case "audio":
		return `<audio controls preload="metadata" src="` + src + `"></audio>`
	case "video":
		return `<video controls preload="metadata" src="` + src + `"></video>`
	default:
		return `<p class="file"><a href="` + src + `">` + safe + `</a></p>`
	}
}

func formatJalaliStamp(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	local := t.In(tehranLocation())
	_, jm, jd := gregorianToJalali(local.Year(), int(local.Month()), local.Day())
	month := "ماه"
	if jm >= 1 && jm <= len(jalaliMonthNames) {
		month = jalaliMonthNames[jm-1]
	}
	return persianDigits(jd) + " " + month + " · " + persianDigits2(local.Hour()) + ":" + persianDigits2(local.Minute())
}

func tehranLocation() *time.Location {
	loc, err := time.LoadLocation("Asia/Tehran")
	if err != nil {
		return time.FixedZone("IRST", 3*3600+30*60)
	}
	return loc
}

var jalaliMonthNames = []string{
	"فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
	"مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
}

func persianDigits(n int) string {
	if n < 0 {
		n = 0
	}
	return strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return '۰' + (r - '0')
		}
		return r
	}, strconv.Itoa(n))
}

func persianDigits2(n int) string {
	if n < 0 {
		n = 0
	}
	return persianDigits(n/10) + persianDigits(n%10)
}

func gregorianToJalali(gy, gm, gd int) (jy, jm, jd int) {
	gdm := [12]int{0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334}
	gy2 := gy
	if gm > 2 {
		gy2 = gy + 1
	}
	days := 355666 + 365*gy + (gy2+3)/4 - (gy2+99)/100 + (gy2+399)/400 + gd + gdm[gm-1]
	jy = -1595 + 33*(days/12053)
	days %= 12053
	jy += 4 * (days / 1461)
	days %= 1461
	if days > 365 {
		jy += (days - 1) / 365
		days = (days - 1) % 365
	}
	if days < 186 {
		jm = 1 + days/31
		jd = 1 + days%31
		return jy, jm, jd
	}
	jm = 7 + (days-186)/30
	jd = 1 + (days-186)%30
	return jy, jm, jd
}
