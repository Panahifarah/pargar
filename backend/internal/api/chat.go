package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"pargar/backend/internal/models"
	"pargar/backend/internal/store"
)

const maxUploadSize = 25 << 20 // 25 MB

func (s *Server) handleListMentors(w http.ResponseWriter, r *http.Request) {
	actor := currentUser(r)
	var mentors []models.User
	var err error
	if actor.Role == models.RoleMentor || actor.Role == models.RoleAdmin {
		mentors, _, err = s.store.ListUsers(r.Context(), "", "", 100, 0)
	} else {
		mentors, err = s.store.ListMentors(r.Context())
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "بارگذاری منتورها ممکن نشد")
		return
	}
	safe := make([]map[string]any, 0, len(mentors))
	for _, m := range mentors {
		if m.ID == actor.ID || !m.IsActive {
			continue
		}
		if actor.Role == models.RoleStudent && m.Role != models.RoleMentor && m.Role != models.RoleAdmin {
			continue
		}
		s.signUserMedia(&m)
		safe = append(safe, map[string]any{
			"id": m.ID, "name": m.Name, "email": m.Email, "role": m.Role,
			"avatarVariant": m.AvatarVariant, "avatarPalette": m.AvatarPalette, "avatarPhoto": m.AvatarPhoto,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"mentors": safe})
}

type conversation struct {
	Partner     map[string]any      `json:"partner"`
	LastMessage *models.ChatMessage `json:"lastMessage,omitempty"`
	UnreadCount int                 `json:"unreadCount"`
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

	out := make([]conversation, 0, len(partners))
	for _, p := range partners {
		if !s.canChatWith(r.Context(), u, p.ID) {
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
		conv := conversation{
			Partner: map[string]any{
				"id": p.ID, "name": p.Name, "email": p.Email, "role": p.Role,
				"avatarVariant": p.AvatarVariant, "avatarPalette": p.AvatarPalette, "avatarPhoto": photo,
				"online": s.hub.Online(p.ID),
			},
			UnreadCount: unread,
		}
		if last != nil {
			conv.LastMessage = last
		}
		out = append(out, conv)
	}
	if out == nil {
		out = []conversation{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"conversations": out})
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
		Body       string             `json:"body"`
		ReplyTo    *int64             `json:"replyTo"`
		Attachment *models.Attachment `json:"attachment,omitempty"`
	}
	if err := bodyJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "دادهٔ ارسالی نامعتبر است")
		return
	}
	req.Body = strings.TrimSpace(req.Body)
	if att := req.Attachment; att != nil {
		if att.Size > maxUploadSize {
			writeErr(w, http.StatusBadRequest, "حجم پیوست بیش از حد مجاز است")
			return
		}
		att.Type = strings.ToLower(att.Type)
		if att.Type != "image" && att.Type != "video" && att.Type != "audio" && att.Type != "file" {
			writeErr(w, http.StatusBadRequest, "نوع پیوست پشتیبانی نمی‌شود")
			return
		}
		if att.URL == "" || !strings.Contains(att.URL, "/media/") {
			writeErr(w, http.StatusBadRequest, "نشانی پیوست نامعتبر است")
			return
		}
		key := mediaKeyFromURL(att.URL)
		if !mediaKeyOwnedByUser(key, u.ID) {
			writeErr(w, http.StatusBadRequest, "پیوست متعلق به شما نیست")
			return
		}
		// Persist without signature query — re-signed when messages are returned.
		if q := strings.Index(att.URL, "?"); q >= 0 {
			att.URL = att.URL[:q]
		}
		if att.Name == "" {
			att.Name = "file"
		}
	}
	if req.Body == "" && req.Attachment == nil {
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

	msg, err := s.store.AddChatMessage(r.Context(), studentID, mentorID, u.Role, req.Body, req.ReplyTo, req.Attachment)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "ارسال پیام ممکن نشد")
		return
	}
	s.resignChatMessage(msg)

	// live push chat_message to both participants
	s.hub.Push(u.ID, map[string]any{"type": "chat_message", "item": msg, "from": u.ID})
	s.hub.Push(partnerID, map[string]any{"type": "chat_message", "item": msg, "from": u.ID})

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
		Body       string             `json:"body"`
		Attachment *models.Attachment `json:"attachment,omitempty"`
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

	var (
		msg *models.ChatMessage
		err error
	)
	if req.Attachment != nil {
		att := req.Attachment
		att.Type = strings.ToLower(strings.TrimSpace(att.Type))
		if att.Type != "image" && att.Type != "video" && att.Type != "audio" {
			writeErr(w, http.StatusBadRequest, "فقط عکس، ویدیو یا صدا را می‌توان جایگزین کرد")
			return
		}
		key := mediaKeyFromURL(att.URL)
		if key == "" || !mediaKeyOwnedByUser(key, u.ID) {
			writeErr(w, http.StatusBadRequest, "پیوست متعلق به شما نیست")
			return
		}
		if q := strings.Index(att.URL, "?"); q >= 0 {
			att.URL = att.URL[:q]
		}
		if att.Name == "" {
			att.Name = "file"
		}
		msg, err = s.store.ReplaceChatAttachment(r.Context(), u.ID, partner, msgID, u.Role, req.Body, att.Type, att.URL, att.Name, att.Size)
	} else {
		if req.Body == "" {
			writeErr(w, http.StatusBadRequest, "پیام باید بین ۱ تا ۴۰۰۰ نویسه باشد")
			return
		}
		msg, err = s.store.EditChatMessage(r.Context(), u.ID, partner, msgID, u.Role, req.Body)
	}
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
	if actor == nil || partnerID <= 0 || actor.ID == partnerID {
		return false
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
	if msg == nil || msg.Attachment == nil || msg.Attachment.URL == "" {
		return
	}
	msg.Attachment.URL = s.signExistingMediaURL(msg.Attachment.URL)
}

func itoa(v int64) string {
	return strconvFormatInt(v)
}
