package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"pargar/backend/internal/models"
	"pargar/backend/internal/store"
)

const maxUploadSize = 25 << 20 // 25 MB

func (s *Server) handleListMentors(w http.ResponseWriter, r *http.Request) {
	actor := currentUser(r)
	page := parsePageParams(r)
	if page.PageSize < 20 {
		page.PageSize = 20
		page.Offset = (page.Page - 1) * page.PageSize
	}
	roles := []string{models.RoleMentor.String(), models.RoleAdmin.String()}
	if actor.Role == models.RoleMentor || actor.Role == models.RoleAdmin {
		roles = []string{models.RoleStudent.String(), models.RoleMentor.String(), models.RoleAdmin.String()}
	}
	people, total, err := s.store.ListActiveByRoles(r.Context(), roles, page.PageSize, page.Offset)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "بارگذاری افراد ممکن نشد")
		return
	}
	ids := make([]int64, 0, len(people))
	for _, m := range people {
		if m.ID != actor.ID {
			ids = append(ids, m.ID)
		}
	}
	seen, _ := s.store.LastSeenByIDs(r.Context(), ids)
	safe := make([]map[string]any, 0, len(people))
	for _, m := range people {
		if m.ID == actor.ID {
			continue
		}
		s.signUserMedia(&m)
		item := map[string]any{
			"id": m.ID, "name": m.Name, "email": m.Email, "role": m.Role,
			"avatarVariant": m.AvatarVariant, "avatarPalette": m.AvatarPalette, "avatarPhoto": m.AvatarPhoto,
			"online": s.hub.Online(m.ID),
		}
		if ts, ok := seen[m.ID]; ok && !ts.IsZero() {
			item["lastSeen"] = ts.UTC()
		}
		safe = append(safe, item)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"mentors":  safe,
		"total":    total,
		"page":     page.Page,
		"pageSize": page.PageSize,
	})
}

type conversation struct {
	Partner      map[string]any      `json:"partner"`
	LastMessage  *models.ChatMessage `json:"lastMessage,omitempty"`
	UnreadCount  int                 `json:"unreadCount"`
	MessageCount int                 `json:"messageCount"`
	PinnedRank   *int                `json:"pinnedRank"`
	Muted        bool                `json:"muted"`
	Archived     bool                `json:"archived"`
}

func (s *Server) handleConversations(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	rows, err := s.store.Pool().Query(r.Context(), `
		SELECT DISTINCT partner, u2.id, u2.name, u2.email, u2.role,
			u2.avatar_variant, u2.avatar_palette, u2.avatar_photo
		FROM (
			SELECT user_id AS partner FROM chat_messages WHERE mentor_id=$1
			UNION
			SELECT mentor_id FROM chat_messages WHERE user_id=$1
		) p
		JOIN users u2 ON u2.id = p.partner
		ORDER BY u2.id`, u.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "بارگذاری گفتگوها ممکن نشد")
		return
	}
	type pmeta struct {
		ID            int64
		Name          string
		Email         string
		Role          models.Role
		AvatarVariant string
		AvatarPalette string
		AvatarPhoto   string
	}
	var partners []pmeta
	for rows.Next() {
		var p pmeta
		if err := rows.Scan(&p.ID, &p.ID, &p.Name, &p.Email, &p.Role,
			&p.AvatarVariant, &p.AvatarPalette, &p.AvatarPhoto); err != nil {
			rows.Close()
			writeErr(w, http.StatusInternalServerError, "بارگذاری گفتگوها ممکن نشد")
			return
		}
		partners = append(partners, p)
	}
	rows.Close()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "بارگذاری گفتگوها ممکن نشد")
		return
	}

	showArchived := r.URL.Query().Get("archived") == "1"
	partnerIDs := make([]int64, 0, len(partners))
	for _, p := range partners {
		if p.ID != u.ID {
			partnerIDs = append(partnerIDs, p.ID)
		}
	}
	seen, _ := s.store.LastSeenByIDs(r.Context(), partnerIDs)
	out := make([]conversation, 0, len(partners))
	for _, p := range partners {
		if !s.canChatWith(r.Context(), u, p.ID) {
			continue
		}
		pref := s.store.ChatPref(r.Context(), u.ID, p.ID)
		if pref.Archived != showArchived {
			continue
		}
		msgs, err := s.store.ListChatMessages(r.Context(), u.ID, p.ID, 0, 100)
		if err != nil {
			continue
		}
		var last *models.ChatMessage
		unread := 0
		for i := range msgs {
			m := msgs[i]
			last = &m
			if m.ReadAt == nil && m.SenderRole != u.Role {
				unread++
			}
		}
		photo := p.AvatarPhoto
		if photo != "" {
			tmp := &models.User{ID: p.ID, AvatarPhoto: photo}
			s.signUserMedia(tmp)
			photo = tmp.AvatarPhoto
		}
		name := p.Name
		saved := p.ID == u.ID
		if saved {
			name = "پیام‌های ذخیره‌شده"
		}
		partner := map[string]any{
			"id": p.ID, "name": name, "email": p.Email, "role": p.Role,
			"avatarVariant": p.AvatarVariant, "avatarPalette": p.AvatarPalette, "avatarPhoto": photo,
			"online": !saved && s.hub.Online(p.ID), "saved": saved,
		}
		if !saved {
			if ts, ok := seen[p.ID]; ok && !ts.IsZero() {
				partner["lastSeen"] = ts.UTC()
			}
		}
		conv := conversation{
			Partner:      partner,
			UnreadCount:  unread,
			MessageCount: len(msgs),
			PinnedRank:   pref.PinnedRank,
			Muted:        pref.Muted,
			Archived:     pref.Archived,
		}
		if last != nil {
			conv.LastMessage = last
		}
		out = append(out, conv)
	}
	if !showArchived {
		hasSelf := false
		for _, c := range out {
			if id, _ := c.Partner["id"].(int64); id == u.ID {
				hasSelf = true
				break
			}
		}
		if !hasSelf {
			out = append(out, conversation{
				Partner: map[string]any{
					"id": u.ID, "name": "پیام‌های ذخیره‌شده", "email": u.Email, "role": u.Role,
					"avatarVariant": u.AvatarVariant, "avatarPalette": u.AvatarPalette, "avatarPhoto": u.AvatarPhoto,
					"online": false, "saved": true,
				},
			})
		}
	}
	if out == nil {
		out = []conversation{}
	}
	sort.SliceStable(out, func(i, j int) bool {
		pi, pj := out[i].PinnedRank, out[j].PinnedRank
		if (pi != nil) != (pj != nil) {
			return pi != nil
		}
		if pi != nil && pj != nil && *pi != *pj {
			return *pi < *pj
		}
		ti := time.Time{}
		tj := time.Time{}
		if out[i].LastMessage != nil {
			ti = out[i].LastMessage.CreatedAt
		}
		if out[j].LastMessage != nil {
			tj = out[j].LastMessage.CreatedAt
		}
		return ti.After(tj)
	})
	total := len(out)
	slice := out
	page := pageParams{Page: 1, PageSize: total}
	if r.URL.Query().Get("page") != "" || r.URL.Query().Get("pageSize") != "" {
		page = parsePageParams(r)
		start := page.Offset
		if start > total {
			start = total
		}
		end := start + page.PageSize
		if end > total {
			end = total
		}
		slice = out[start:end]
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"conversations": slice,
		"total":         total,
		"page":          page.Page,
		"pageSize":      page.PageSize,
		"mutedAll":      s.store.ChatMutedAll(r.Context(), u.ID),
	})
}

func (s *Server) handleChatMessages(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	partner := routeID(r, "partner")
	if !s.canChatWith(r.Context(), u, partner) {
		writeErr(w, http.StatusForbidden, "شما اجازهٔ گفتگو با این کاربر را ندارید")
		return
	}
	_ = s.markIncomingChatRead(r.Context(), u, partner)

	if raw := r.URL.Query().Get("around"); raw != "" {
		aroundID, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || aroundID <= 0 {
			writeErr(w, http.StatusBadRequest, "شناسهٔ پیام نامعتبر است")
			return
		}
		ok, err := s.store.ChatMessageInPair(r.Context(), u.ID, partner, aroundID)
		if err != nil || !ok {
			writeErr(w, http.StatusNotFound, "پیام پیدا نشد")
			return
		}
		const pageSize = 60
		msgs, hasMoreBefore, hasMoreAfter, err := s.store.ListChatMessagesAround(r.Context(), u.ID, partner, aroundID, pageSize)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "بارگذاری پیام‌ها ممکن نشد")
			return
		}
		_ = s.store.FillReactions(r.Context(), u.ID, msgs)
		s.resignChatMessages(msgs)
		pinned, _ := s.store.ListPinnedChatMessages(r.Context(), u.ID, partner)
		if pinned == nil {
			pinned = []models.ChatMessage{}
		}
		_ = s.store.FillReactions(r.Context(), u.ID, pinned)
		s.resignChatMessages(pinned)
		writeJSON(w, http.StatusOK, map[string]any{
			"messages":      msgs,
			"hasMore":       hasMoreBefore,
			"hasMoreBefore": hasMoreBefore,
			"hasMoreAfter":  hasMoreAfter,
			"around":        aroundID,
			"pinned":        pinned,
		})
		return
	}

	before := int64(0)
	if raw := r.URL.Query().Get("before"); raw != "" {
		v, err := strconv.ParseInt(raw, 10, 64)
		if err == nil && v > 0 {
			before = v
		}
	}
	const pageSize = 60
	msgs, err := s.store.ListChatMessages(r.Context(), u.ID, partner, before, pageSize+1)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "بارگذاری پیام‌ها ممکن نشد")
		return
	}
	hasMore := int64(len(msgs)) > pageSize
	nextBefore := int64(0)
	if hasMore {
		msgs = msgs[1:]
		if len(msgs) > 0 {
			nextBefore = msgs[0].ID
		}
	}
	_ = s.store.FillReactions(r.Context(), u.ID, msgs)
	s.resignChatMessages(msgs)
	pinned, _ := s.store.ListPinnedChatMessages(r.Context(), u.ID, partner)
	if pinned == nil {
		pinned = []models.ChatMessage{}
	}
	_ = s.store.FillReactions(r.Context(), u.ID, pinned)
	s.resignChatMessages(pinned)
	writeJSON(w, http.StatusOK, map[string]any{
		"messages": msgs, "hasMore": hasMore, "nextBefore": nextBefore, "pinned": pinned,
	})
}

func (s *Server) handleChatSend(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	partnerID := routeID(r, "partner")
	if !s.canChatWith(r.Context(), u, partnerID) {
		writeErr(w, http.StatusForbidden, "شما اجازهٔ گفتگو با این کاربر را ندارید")
		return
	}
	var req struct {
		Body        string              `json:"body"`
		ReplyTo     *int64              `json:"replyTo"`
		Attachment  *models.Attachment  `json:"attachment,omitempty"`
		Attachments []models.Attachment `json:"attachments,omitempty"`
	}
	if err := bodyJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "دادهٔ ارسالی نامعتبر است")
		return
	}
	req.Body = strings.TrimSpace(req.Body)
	atts, attErr := prepareChatAttachments(u.ID, req.Attachment, req.Attachments)
	if attErr != "" {
		writeErr(w, http.StatusBadRequest, attErr)
		return
	}
	if req.Body == "" && len(atts) == 0 {
		writeErr(w, http.StatusBadRequest, "پیام باید شامل متن یا فایل باشد")
		return
	}
	if len(req.Body) > 4000 {
		writeErr(w, http.StatusBadRequest, "پیام باید بین ۱ تا ۴۰۰۰ نویسه باشد")
		return
	}

	partner, err := s.store.GetUserByID(r.Context(), partnerID)
	if err != nil {
		writeErr(w, http.StatusNotFound, "طرف گفتگو پیدا نشد")
		return
	}
	studentID := u.ID
	mentorID := partner.ID
	if u.Role == models.RoleMentor || u.Role == models.RoleAdmin {
		studentID = partner.ID
		mentorID = u.ID
	}

	msg, err := s.store.AddChatMessage(r.Context(), studentID, mentorID, u.Role, req.Body, req.ReplyTo, atts)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "ارسال پیام ممکن نشد")
		return
	}
	s.resignChatMessage(msg)

	// live push chat_message to both participants
	s.hub.Push(u.ID, map[string]any{"type": "chat_message", "item": msg, "from": u.ID})
	s.hub.Push(partnerID, map[string]any{"type": "chat_message", "item": msg, "from": u.ID})
	s.noteBotReply(r, partnerID, req.Body)

	// notify the recipient
	if u.Role == models.RoleMentor || u.Role == models.RoleAdmin {
		_ = s.notify.Notify(context.Background(), studentID, "mentor", "mentor_reply",
			"پاسخ منتور", u.Name+" برای شما پیام فرستاد.", "/unwrap?tab=chats&with="+itoa(u.ID), nil)
	} else {
		_ = s.notify.Notify(context.Background(), mentorID, "mentor", "student_message",
			"پیام از "+u.Name, "یک هنرجو به کمک شما نیاز دارد.", "/unwrap?tab=chats&with="+itoa(u.ID), nil)
	}
	writeJSON(w, http.StatusCreated, map[string]any{"message": msg})
}

func (s *Server) handleChatReact(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	partner := routeID(r, "partner")
	if !s.canChatWith(r.Context(), u, partner) {
		writeErr(w, http.StatusForbidden, "شما اجازهٔ گفتگو با این کاربر را ندارید")
		return
	}
	msgID := routeID(r, "id")
	var req struct {
		Emoji string `json:"emoji"`
	}
	if err := bodyJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "دادهٔ ارسالی نامعتبر است")
		return
	}
	req.Emoji = strings.TrimSpace(req.Emoji)
	if len(req.Emoji) > 16 {
		writeErr(w, http.StatusBadRequest, "شکلک نامعتبر است")
		return
	}
	ok, err := s.store.MessageInConversation(r.Context(), msgID, u.ID, partner)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "بارگذاری پیام ممکن نشد")
		return
	}
	if !ok {
		writeErr(w, http.StatusNotFound, "پیام پیدا نشد")
		return
	}
	emoji, reactions, err := s.store.ReactToChatMessage(r.Context(), msgID, u.ID, req.Emoji)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "ذخیرهٔ واکنش ممکن نشد")
		return
	}
	event := map[string]any{"type": "chat_reaction", "messageId": msgID, "from": u.ID, "emoji": emoji}
	s.hub.Push(u.ID, event)
	s.hub.Push(partner, event)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "emoji": emoji, "reactions": reactions})
}

func (s *Server) handleChatEdit(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	partner := routeID(r, "partner")
	if !s.canChatWith(r.Context(), u, partner) {
		writeErr(w, http.StatusForbidden, "شما اجازهٔ گفتگو با این کاربر را ندارید")
		return
	}
	msgID := routeID(r, "id")
	var req struct {
		Body           string              `json:"body"`
		Attachment     *models.Attachment  `json:"attachment,omitempty"`
		AddAttachments []models.Attachment `json:"addAttachments,omitempty"`
		RemoveIndexes  []int               `json:"removeIndexes,omitempty"`
		Replacements   []struct {
			Index      int               `json:"index"`
			Attachment models.Attachment `json:"attachment"`
		} `json:"replacements,omitempty"`
	}
	if err := bodyJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "دادهٔ ارسالی نامعتبر است")
		return
	}
	req.Body = strings.TrimSpace(req.Body)
	if len(req.Body) > 4000 {
		writeErr(w, http.StatusBadRequest, "پیام باید بین ۱ تا ۴۰۰۰ نویسه باشد")
		return
	}

	current, err := s.store.GetOwnChatMessage(r.Context(), u.ID, partner, msgID, u.Role)
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "پیام پیدا نشد")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "ویرایش پیام ممکن نشد")
		return
	}

	existing := storedAttachments(current)
	drop := map[int]struct{}{}
	for _, index := range req.RemoveIndexes {
		if index < 0 || index >= len(existing) {
			writeErr(w, http.StatusBadRequest, "پیوست انتخاب‌شده پیدا نشد")
			return
		}
		drop[index] = struct{}{}
	}
	for _, rep := range req.Replacements {
		if _, removed := drop[rep.Index]; removed {
			continue
		}
		if rep.Index < 0 || rep.Index >= len(existing) {
			writeErr(w, http.StatusBadRequest, "پیوست انتخاب‌شده پیدا نشد")
			return
		}
		prepared, attErr := prepareChatAttachments(u.ID, &rep.Attachment, nil)
		if attErr != "" {
			writeErr(w, http.StatusBadRequest, attErr)
			return
		}
		if prepared[0].Type != existing[rep.Index].Type {
			writeErr(w, http.StatusBadRequest, "فایل جدید باید از همان نوع باشد")
			return
		}
		existing[rep.Index] = prepared[0]
	}

	toAdd := req.AddAttachments
	if req.Attachment != nil {
		toAdd = append(toAdd, *req.Attachment)
	}
	added, attErr := prepareChatAttachments(u.ID, nil, toAdd)
	if attErr != "" {
		writeErr(w, http.StatusBadRequest, attErr)
		return
	}

	final := make([]models.Attachment, 0, len(existing)+len(added))
	for i, att := range existing {
		if _, removed := drop[i]; removed {
			continue
		}
		final = append(final, att)
	}
	final = append(final, added...)
	if len(final) > maxChatAttachments {
		writeErr(w, http.StatusBadRequest, "در هر پیام حداکثر ۱۰ پیوست می‌توان فرستاد")
		return
	}
	if req.Body == "" && len(final) == 0 {
		writeErr(w, http.StatusBadRequest, "پیام باید متن یا پیوست داشته باشد")
		return
	}

	msg, err := s.store.SaveEditedChatMessage(r.Context(), u.ID, partner, msgID, u.Role, req.Body, final)
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "پیام پیدا نشد")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "ویرایش پیام ممکن نشد")
		return
	}
	s.resignChatMessage(msg)
	event := map[string]any{"type": "chat_edit", "item": msg, "from": u.ID}
	s.hub.Push(u.ID, event)
	s.hub.Push(partner, event)
	writeJSON(w, http.StatusOK, map[string]any{"message": msg})
}

func (s *Server) handleChatDelete(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	partner := routeID(r, "partner")
	if !s.canChatWith(r.Context(), u, partner) {
		writeErr(w, http.StatusForbidden, "شما اجازهٔ گفتگو با این کاربر را ندارید")
		return
	}
	msgID := routeID(r, "id")
	ok, err := s.store.DeleteChatMessage(r.Context(), u.ID, partner, msgID, u.Role)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "حذف پیام ممکن نشد")
		return
	}
	if !ok {
		writeErr(w, http.StatusNotFound, "پیام پیدا نشد")
		return
	}
	s.hub.Push(u.ID, map[string]any{"type": "chat_delete", "id": msgID, "from": u.ID})
	s.hub.Push(partner, map[string]any{"type": "chat_delete", "id": msgID, "from": u.ID})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleChatPin(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	partner := routeID(r, "partner")
	if !s.canChatWith(r.Context(), u, partner) {
		writeErr(w, http.StatusForbidden, "شما اجازهٔ گفتگو با این کاربر را ندارید")
		return
	}
	msgID := routeID(r, "id")
	msg, err := s.store.TogglePinChatMessage(r.Context(), u.ID, partner, msgID)
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "پیام پیدا نشد")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "پین پیام ممکن نشد")
		return
	}
	s.resignChatMessage(msg)
	event := map[string]any{"type": "chat_pin", "from": u.ID, "message": msg}
	s.hub.Push(u.ID, event)
	s.hub.Push(partner, event)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "message": msg})
}

func (s *Server) handleChatUpload(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadSize+1<<20)
	if err := r.ParseMultipartForm(maxUploadSize + 1<<20); err != nil {
		writeErr(w, http.StatusBadRequest, "حجم فایل باید کمتر از ۲۵ مگابایت باشد")
		return
	}
	file, h, err := r.FormFile("file")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "فایلی ارسال نشده است")
		return
	}
	defer file.Close()
	if h.Size == 0 {
		writeErr(w, http.StatusBadRequest, "فایل خالی است")
		return
	}
	if h.Size > maxUploadSize {
		writeErr(w, http.StatusRequestEntityTooLarge, "حجم فایل باید کمتر از ۲۵ مگابایت باشد")
		return
	}

	name := filepath.Base(strings.TrimSpace(h.Filename))
	if name == "" {
		writeErr(w, http.StatusBadRequest, "نام فایل نامعتبر است")
		return
	}
	accepted, err := acceptChatUpload(h, file)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	key := fmt.Sprintf("chats/%d-%d%s", u.ID, time.Now().UnixNano(), accepted.Ext)
	rawURL, err := s.storage.Save(key, file, h.Size)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "ذخیرهٔ فایل ممکن نشد")
		return
	}

	att := models.Attachment{
		Type: accepted.Kind,
		URL:  s.signExistingMediaURL(rawURL), Name: name, Size: h.Size,
	}
	if att.Type == "pdf" || att.Type == "office" || att.Type == "text" {
		att.Type = "file"
	}
	writeJSON(w, http.StatusCreated, map[string]any{"attachment": att})
}

var allowedExts = map[string]bool{
	".jpg": true, ".jpeg": true, ".png": true, ".gif": true, ".webp": true,
	".mp4": true, ".webm": true, ".mov": true, ".m4v": true,
	".mp3": true, ".wav": true, ".m4a": true, ".aac": true, ".ogg": true, ".opus": true, ".weba": true,
	".pdf": true, ".txt": true, ".md": true, ".csv": true, ".json": true,
	".doc": true, ".docx": true, ".xls": true, ".xlsx": true, ".ppt": true, ".pptx": true,
}

func allowedExtension(ext string) bool {
	return allowedExts[ext]
}

func attachmentType(mime, ext string) string {
	switch {
	case strings.HasPrefix(mime, "image/"):
		return "image"
	case strings.HasPrefix(mime, "video/"):
		return "video"
	case strings.HasPrefix(mime, "audio/"):
		return "audio"
	}
	// Some browsers send a generic MIME (application/octet-stream); fall back to extension.
	switch ext {
	case ".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif":
		return "image"
	case ".mp4", ".webm", ".mov", ".m4v":
		return "video"
	case ".mp3", ".wav", ".m4a", ".aac", ".ogg", ".opus", ".weba":
		return "audio"
	}
	return "file"
}

func (s *Server) handleChatRead(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	partner := routeID(r, "partner")
	if !s.canChatWith(r.Context(), u, partner) {
		writeErr(w, http.StatusForbidden, "شما اجازهٔ گفتگو با این کاربر را ندارید")
		return
	}
	if err := s.markIncomingChatRead(r.Context(), u, partner); err != nil {
		writeErr(w, http.StatusInternalServerError, "به‌روزرسانی وضعیت خوانده‌شدن ممکن نشد")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) markIncomingChatRead(ctx context.Context, reader *models.User, partnerID int64) error {
	if reader == nil {
		return nil
	}
	n, err := s.store.MarkChatRead(ctx, reader.ID, partnerID, reader.Role)
	if err != nil || n == 0 {
		return err
	}
	s.hub.Push(partnerID, map[string]any{"type": "chat_read", "from": reader.ID})
	return nil
}

func (s *Server) canChatWith(ctx context.Context, actor *models.User, partnerID int64) bool {
	if actor == nil || partnerID <= 0 {
		return false
	}
	if actor.ID == partnerID {
		return true
	}
	partner, err := s.store.GetUserByID(ctx, partnerID)
	if err != nil || !partner.IsActive {
		return false
	}
	if actor.Role == models.RoleStudent {
		return partner.Role == models.RoleMentor || partner.Role == models.RoleAdmin
	}
	return actor.Role == models.RoleMentor || actor.Role == models.RoleAdmin
}

func (s *Server) resignChatMessages(msgs []models.ChatMessage) {
	for i := range msgs {
		s.resignChatMessage(&msgs[i])
	}
}

func (s *Server) resignChatMessage(msg *models.ChatMessage) {
	if msg == nil {
		return
	}
	for i := range msg.Attachments {
		if msg.Attachments[i].URL != "" {
			msg.Attachments[i].URL = s.signExistingMediaURL(msg.Attachments[i].URL)
		}
	}
	if len(msg.Attachments) > 0 {
		first := msg.Attachments[0]
		msg.Attachment = &first
		return
	}
	if msg.Attachment != nil && msg.Attachment.URL != "" {
		msg.Attachment.URL = s.signExistingMediaURL(msg.Attachment.URL)
	}
}

func storedAttachments(m *models.ChatMessage) []models.Attachment {
	if m == nil {
		return nil
	}
	if len(m.Attachments) > 0 {
		out := make([]models.Attachment, len(m.Attachments))
		copy(out, m.Attachments)
		return out
	}
	if m.Attachment != nil && m.Attachment.URL != "" {
		return []models.Attachment{*m.Attachment}
	}
	return nil
}

const maxChatAttachments = 10

func prepareChatAttachments(ownerID int64, single *models.Attachment, many []models.Attachment) ([]models.Attachment, string) {
	atts := many
	if len(atts) == 0 && single != nil {
		atts = []models.Attachment{*single}
	}
	if len(atts) > maxChatAttachments {
		return nil, "در هر پیام حداکثر ۱۰ پیوست می‌توان فرستاد"
	}
	out := make([]models.Attachment, 0, len(atts))
	for i := range atts {
		att := atts[i]
		if att.Size > maxUploadSize {
			return nil, "حجم پیوست بیش از حد مجاز است"
		}
		att.Type = strings.ToLower(strings.TrimSpace(att.Type))
		if att.Type != "image" && att.Type != "video" && att.Type != "audio" && att.Type != "file" {
			return nil, "نوع پیوست پشتیبانی نمی‌شود"
		}
		if att.URL == "" || !strings.Contains(att.URL, "/media/") {
			return nil, "نشانی پیوست نامعتبر است"
		}
		key := mediaKeyFromURL(att.URL)
		if !mediaKeyOwnedByUser(key, ownerID) {
			return nil, "پیوست متعلق به شما نیست"
		}
		if q := strings.Index(att.URL, "?"); q >= 0 {
			att.URL = att.URL[:q]
		}
		if strings.TrimSpace(att.Name) == "" {
			att.Name = "file"
		}
		out = append(out, att)
	}
	return out, ""
}

func itoa(v int64) string {
	return strconvFormatInt(v)
}
