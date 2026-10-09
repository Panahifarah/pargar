package api

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"pargar/backend/internal/models"
	"pargar/backend/internal/observability"
	"pargar/backend/internal/store"
)

const (
	chatExportPayloadVersion = 4
	chatExportSchema         = "pargar.chat-export"
)

type chatExportParticipant struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
	Role string `json:"role"`
}

type chatExportParticipants struct {
	Student chatExportParticipant `json:"student"`
	Mentor  chatExportParticipant `json:"mentor"`
}

// chatExportAttachment is the v4 archive attachment descriptor.
// Path is relative inside the ZIP (e.g. attachments/1-2/42-photo.jpg).
type chatExportAttachment struct {
	Type    string `json:"type"`
	Name    string `json:"name"`
	Size    int64  `json:"size"`
	Path    string `json:"path,omitempty"`
	Missing bool   `json:"missing,omitempty"`
	// URL kept for restore of legacy JSON exports (v2/v3) only.
	URL string `json:"url,omitempty"`
}

type chatExportMessage struct {
	ID         int64                 `json:"id,omitempty"`
	Body       string                `json:"body"`
	SenderRole string                `json:"senderRole"`
	CreatedAt  time.Time             `json:"createdAt"`
	ReadAt     *time.Time            `json:"readAt,omitempty"`
	ReplyTo    *int64                `json:"replyTo,omitempty"`
	Pinned     bool                  `json:"pinned"`
	PinnedAt   *time.Time            `json:"pinnedAt,omitempty"`
	EditedAt   *time.Time            `json:"editedAt,omitempty"`
	Attachment *chatExportAttachment `json:"attachment,omitempty"`
}

type chatExportConversation struct {
	StudentID    int64                  `json:"studentId"`
	StudentName  string                 `json:"studentName"`
	MentorID     int64                  `json:"mentorId"`
	MentorName   string                 `json:"mentorName"`
	Participants chatExportParticipants `json:"participants"`
	MessageCount int                    `json:"messageCount"`
	Messages     []chatExportMessage    `json:"messages"`
}

type chatExportPayload struct {
	Version       int                      `json:"version"`
	Schema        string                   `json:"schema"`
	ExportedAt    time.Time                `json:"exportedAt"`
	Format        string                   `json:"format,omitempty"`
	ConversationN int                      `json:"conversationCount"`
	Conversations []chatExportConversation `json:"conversations"`
}

type zipAttachmentFile struct {
	Path string
	Key  string
}

var unsafeFilenameChars = regexp.MustCompile(`[^a-zA-Z0-9._\-\p{L}]+`)

func (s *Server) chatExportDownloadURL(rawToken string) string {
	base := strings.TrimRight(s.cfg.PublicURL, "/")
	path := "/api/exports/chats/" + rawToken
	if base == "" {
		return path
	}
	return base + path
}

func (s *Server) decorateChatExportToken(tok *models.ChatExportToken) {
	if tok == nil {
		return
	}
	enc := tok.Token
	if enc == "" {
		return
	}
	raw, err := store.DecryptInviteToken(s.cfg.JWTSecret, enc)
	if err != nil {
		tok.Token = ""
		return
	}
	tok.Token = raw
	tok.URL = s.chatExportDownloadURL(raw)
	tok.Active = tok.RevokedAt == nil && tok.UsedAt == nil && tok.ExpiresAt.After(time.Now().UTC())
}

func safeExportFilename(name string) string {
	base := filepath.Base(strings.TrimSpace(name))
	if base == "" || base == "." || base == ".." {
		base = "file"
	}
	base = unsafeFilenameChars.ReplaceAllString(base, "_")
	base = strings.Trim(base, "._")
	if base == "" {
		base = "file"
	}
	if len(base) > 120 {
		ext := filepath.Ext(base)
		base = base[:120-len(ext)] + ext
	}
	return base
}

func conversationExportKey(studentID, mentorID int64) string {
	return fmt.Sprintf("%d-%d", studentID, mentorID)
}

func (s *Server) buildProjectChatExport(r *http.Request) (*chatExportPayload, []zipAttachmentFile, error) {
	pairs, err := s.store.ListChatExportPairs(r.Context())
	if err != nil {
		return nil, nil, err
	}
	out := &chatExportPayload{
		Version:    chatExportPayloadVersion,
		Schema:     chatExportSchema,
		ExportedAt: time.Now().UTC(),
		Format:     "zip",
	}
	var files []zipAttachmentFile
	const pageSize int64 = 2000
	for _, p := range pairs {
		convKey := conversationExportKey(p.StudentID, p.MentorID)
		conv := chatExportConversation{
			StudentID:   p.StudentID,
			StudentName: p.StudentName,
			MentorID:    p.MentorID,
			MentorName:  p.MentorName,
			Participants: chatExportParticipants{
				Student: chatExportParticipant{
					ID: p.StudentID, Name: p.StudentName, Role: string(models.RoleStudent),
				},
				Mentor: chatExportParticipant{
					ID: p.MentorID, Name: p.MentorName, Role: string(models.RoleMentor),
				},
			},
		}
		var before int64
		for {
			msgs, err := s.store.ListChatMessages(r.Context(), p.StudentID, p.MentorID, before, pageSize)
			if err != nil {
				return nil, nil, err
			}
			if len(msgs) == 0 {
				break
			}
			batch := make([]chatExportMessage, 0, len(msgs))
			for _, m := range msgs {
				item := chatExportMessage{
					ID:         m.ID,
					Body:       m.Body,
					SenderRole: string(m.SenderRole),
					CreatedAt:  m.CreatedAt,
					ReadAt:     m.ReadAt,
					ReplyTo:    m.ReplyTo,
					Pinned:     m.PinnedAt != nil,
					PinnedAt:   m.PinnedAt,
					EditedAt:   m.EditedAt,
				}
				if m.Attachment != nil {
					att := &chatExportAttachment{
						Type: m.Attachment.Type,
						Name: m.Attachment.Name,
						Size: m.Attachment.Size,
					}
					key := mediaKeyFromURL(m.Attachment.URL)
					if key == "" {
						att.Missing = true
					} else {
						rel := filepath.ToSlash(filepath.Join(
							"attachments",
							convKey,
							fmt.Sprintf("%d-%s", m.ID, safeExportFilename(m.Attachment.Name)),
						))
						rc, _, _, err := s.storage.Open(key)
						if err != nil {
							att.Missing = true
						} else {
							_ = rc.Close()
							att.Path = rel
							files = append(files, zipAttachmentFile{Path: rel, Key: key})
						}
					}
					item.Attachment = att
				}
				batch = append(batch, item)
			}
			conv.Messages = append(batch, conv.Messages...)
			if int64(len(msgs)) < pageSize {
				break
			}
			before = msgs[0].ID
		}
		if conv.Messages == nil {
			conv.Messages = []chatExportMessage{}
		}
		conv.MessageCount = len(conv.Messages)
		out.Conversations = append(out.Conversations, conv)
	}
	if out.Conversations == nil {
		out.Conversations = []chatExportConversation{}
	}
	out.ConversationN = len(out.Conversations)
	return out, files, nil
}

func (s *Server) writeChatExportZip(w http.ResponseWriter, payload *chatExportPayload, files []zipAttachmentFile) error {
	tmp, err := os.CreateTemp("", "pargar-chat-export-*.zip")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer func() {
		_ = tmp.Close()
		_ = os.Remove(tmpName)
	}()

	zw := zip.NewWriter(tmp)
	manifestBytes, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}
	mw, err := zw.Create("manifest.json")
	if err != nil {
		return err
	}
	if _, err := mw.Write(manifestBytes); err != nil {
		return err
	}

	seen := map[string]bool{}
	for _, f := range files {
		if f.Path == "" || f.Key == "" || seen[f.Path] {
			continue
		}
		seen[f.Path] = true
		rc, _, _, err := s.storage.Open(f.Key)
		if err != nil {
			continue
		}
		hdr := &zip.FileHeader{
			Name:     f.Path,
			Method:   zip.Deflate,
			Modified: time.Now().UTC(),
		}
		aw, err := zw.CreateHeader(hdr)
		if err != nil {
			_ = rc.Close()
			return err
		}
		_, copyErr := io.Copy(aw, rc)
		_ = rc.Close()
		if copyErr != nil {
			return copyErr
		}
	}
	if err := zw.Close(); err != nil {
		return err
	}
	if err := tmp.Sync(); err != nil {
		return err
	}
	if _, err := tmp.Seek(0, io.SeekStart); err != nil {
		return err
	}
	info, err := tmp.Stat()
	if err != nil {
		return err
	}

	filename := fmt.Sprintf("chat-export-%s.zip", time.Now().UTC().Format("2006-01-02"))
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Content-Length", strconv.FormatInt(info.Size(), 10))
	w.WriteHeader(http.StatusOK)
	_, err = io.Copy(w, tmp)
	return err
}

func (s *Server) handleAdminChatExport(w http.ResponseWriter, r *http.Request) {
	out, files, err := s.buildProjectChatExport(r)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "ساخت خروجی گفتگوها ممکن نشد")
		return
	}
	observability.Activity("chat.export", "actor_id", currentUser(r).ID, "conversations", len(out.Conversations), "files", len(files))
	if err := s.writeChatExportZip(w, out, files); err != nil {
		observability.L().Error("chat.export_zip", "error", err)
	}
}

func (s *Server) handleAdminChatExportStats(w http.ResponseWriter, r *http.Request) {
	stats, err := s.store.ChatExportStats(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "خواندن آمار آرشیو گفتگوها ممکن نشد")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"stats": stats})
}

func (s *Server) handleAdminChatExportRestore(w http.ResponseWriter, r *http.Request) {
	payload, zipFiles, err := s.readChatExportRestore(r)
	if err != nil {
		writeValidationErr(w, err.Error())
		return
	}
	if payload.Version != 0 && payload.Version != 2 && payload.Version != 3 && payload.Version != chatExportPayloadVersion {
		writeErr(w, http.StatusBadRequest, "نسخهٔ خروجی گفتگوها پشتیبانی نمی‌شود")
		return
	}
	imported := 0
	for _, conv := range payload.Conversations {
		studentID := conv.StudentID
		mentorID := conv.MentorID
		if studentID <= 0 && conv.Participants.Student.ID > 0 {
			studentID = conv.Participants.Student.ID
		}
		if mentorID <= 0 && conv.Participants.Mentor.ID > 0 {
			mentorID = conv.Participants.Mentor.ID
		}
		if studentID <= 0 || mentorID <= 0 {
			continue
		}
		student, err := s.store.GetUserByID(r.Context(), studentID)
		if err != nil || student == nil {
			continue
		}
		mentor, err := s.store.GetUserByID(r.Context(), mentorID)
		if err != nil || mentor == nil {
			continue
		}
		for _, m := range conv.Messages {
			role := models.Role(m.SenderRole)
			if role != student.Role && role != mentor.Role {
				if student.Role == models.RoleStudent {
					role = student.Role
				} else {
					role = mentor.Role
				}
			}
			created := m.CreatedAt
			if created.IsZero() {
				created = time.Now().UTC()
			}
			var att *models.Attachment
			if m.Attachment != nil {
				att = s.materializeRestoredAttachment(studentID, m.Attachment, zipFiles)
			}
			if _, err := s.store.ImportChatMessage(r.Context(), studentID, mentorID, role, m.Body, att, created, m.Pinned); err != nil {
				continue
			}
			imported++
		}
	}
	observability.Activity("chat.export_restored", "actor_id", currentUser(r).ID, "imported", imported)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "imported": imported})
}

func (s *Server) readChatExportRestore(r *http.Request) (*chatExportPayload, map[string][]byte, error) {
	ct := strings.ToLower(r.Header.Get("Content-Type"))
	const maxRestore = 64 << 20
	r.Body = http.MaxBytesReader(nil, r.Body, maxRestore)
	data, err := io.ReadAll(r.Body)
	if err != nil {
		return nil, nil, errors.New("خواندن فایل ممکن نشد")
	}
	if len(data) == 0 {
		return nil, nil, errors.New("فایل خالی است")
	}

	// ZIP magic
	if len(data) >= 4 && data[0] == 'P' && data[1] == 'K' {
		return s.parseChatExportZip(data)
	}
	if strings.Contains(ct, "zip") {
		return s.parseChatExportZip(data)
	}

	var payload chatExportPayload
	if err := json.Unmarshal(data, &payload); err != nil {
		return nil, nil, errors.New("فایل خروجی گفتگوها نامعتبر است")
	}
	return &payload, nil, nil
}

func (s *Server) parseChatExportZip(data []byte) (*chatExportPayload, map[string][]byte, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, nil, errors.New("آرشیو ZIP نامعتبر است")
	}
	files := map[string][]byte{}
	var manifest []byte
	for _, f := range zr.File {
		name := filepath.ToSlash(f.Name)
		if strings.HasPrefix(name, "__MACOSX/") || strings.HasSuffix(name, "/") {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			continue
		}
		body, err := io.ReadAll(io.LimitReader(rc, 32<<20))
		_ = rc.Close()
		if err != nil {
			continue
		}
		if name == "manifest.json" {
			manifest = body
			continue
		}
		if strings.HasPrefix(name, "attachments/") {
			files[name] = body
		}
	}
	if len(manifest) == 0 {
		return nil, nil, errors.New("manifest.json در آرشیو یافت نشد")
	}
	var payload chatExportPayload
	if err := json.Unmarshal(manifest, &payload); err != nil {
		return nil, nil, errors.New("manifest.json نامعتبر است")
	}
	return &payload, files, nil
}

type bytesFile struct {
	*bytes.Reader
}

func (b bytesFile) Close() error { return nil }

func (s *Server) materializeRestoredAttachment(ownerID int64, src *chatExportAttachment, zipFiles map[string][]byte) *models.Attachment {
	if src == nil {
		return nil
	}
	name := safeExportFilename(src.Name)
	if name == "" {
		name = "file"
	}
	attType := src.Type
	if attType == "" {
		attType = attachmentType("", filepath.Ext(name))
	}

	// Prefer embedded zip bytes.
	if src.Path != "" && zipFiles != nil {
		path := filepath.ToSlash(src.Path)
		if raw, ok := zipFiles[path]; ok && len(raw) > 0 {
			key := fmt.Sprintf("chats/%d-%d%s", ownerID, time.Now().UnixNano(), filepath.Ext(name))
			url, err := s.storage.Save(key, bytesFile{Reader: bytes.NewReader(raw)}, int64(len(raw)))
			if err == nil {
				return &models.Attachment{
					Type: attType,
					URL:  s.signExistingMediaURL(url),
					Name: name,
					Size: int64(len(raw)),
				}
			}
		}
	}

	// Legacy JSON: keep original URL reference if present.
	if src.URL != "" {
		return &models.Attachment{
			Type: attType,
			URL:  src.URL,
			Name: name,
			Size: src.Size,
		}
	}
	return nil
}

type createChatExportTokenRequest struct {
	ExpiresInHours int    `json:"expiresInHours"`
	Label          string `json:"label"`
}

func (s *Server) handleAdminCreateChatExportToken(w http.ResponseWriter, r *http.Request) {
	var req createChatExportTokenRequest
	if err := bodyJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "دادهٔ ارسالی نامعتبر است")
		return
	}
	hours := req.ExpiresInHours
	if hours != 1 && hours != 24 {
		writeErr(w, http.StatusBadRequest, "مهلت باید ۱ یا ۲۴ ساعت باشد")
		return
	}
	raw, err := store.NewInviteToken()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "ساخت توکن ممکن نشد")
		return
	}
	enc, err := store.EncryptInviteToken(s.cfg.JWTSecret, raw)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "رمزنگاری توکن ممکن نشد")
		return
	}
	expiresAt := time.Now().UTC().Add(time.Duration(hours) * time.Hour)
	admin := currentUser(r)
	tok, err := s.store.CreateChatExportToken(
		r.Context(),
		store.HashInviteToken(raw),
		enc,
		req.Label,
		expiresAt,
		admin.ID,
	)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "ذخیره لینک دانلود ممکن نشد")
		return
	}
	tok.Token = raw
	tok.URL = s.chatExportDownloadURL(raw)
	tok.Active = true
	observability.Activity("chat.export_token_create", "token_id", tok.ID, "admin_id", admin.ID, "hours", hours)
	writeJSON(w, http.StatusCreated, map[string]any{"token": tok})
}

func (s *Server) handleAdminListChatExportTokens(w http.ResponseWriter, r *http.Request) {
	tokens, err := s.store.ListChatExportTokens(r.Context(), 100)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "بارگذاری لینک‌های دانلود ممکن نشد")
		return
	}
	for i := range tokens {
		s.decorateChatExportToken(&tokens[i])
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": tokens})
}

func (s *Server) handleAdminRevokeChatExportToken(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id < 1 {
		writeErr(w, http.StatusBadRequest, "شناسه نامعتبر است")
		return
	}
	tok, err := s.store.RevokeChatExportToken(r.Context(), id)
	if err != nil {
		if errors.Is(err, store.ErrChatExportTokenNotFound) {
			writeErr(w, http.StatusNotFound, "لینک دانلود یافت نشد")
			return
		}
		if errors.Is(err, store.ErrChatExportTokenInvalid) {
			s.decorateChatExportToken(tok)
			writeJSON(w, http.StatusOK, map[string]any{"token": tok, "alreadyInactive": true})
			return
		}
		writeErr(w, http.StatusInternalServerError, "لغو لینک ممکن نشد")
		return
	}
	s.decorateChatExportToken(tok)
	observability.Activity("chat.export_token_revoke", "token_id", tok.ID, "admin_id", currentUser(r).ID)
	writeJSON(w, http.StatusOK, map[string]any{"token": tok})
}

func (s *Server) handleExternalChatExport(w http.ResponseWriter, r *http.Request) {
	raw := strings.TrimSpace(r.PathValue("token"))
	if raw == "" {
		writeErr(w, http.StatusUnauthorized, "توکن لازم است")
		return
	}
	tok, err := s.store.GetChatExportTokenByHash(r.Context(), store.HashInviteToken(raw))
	if err != nil {
		if errors.Is(err, store.ErrChatExportTokenNotFound) {
			writeErr(w, http.StatusUnauthorized, "لینک نامعتبر یا منقضی است")
			return
		}
		writeErr(w, http.StatusInternalServerError, "بررسی توکن ممکن نشد")
		return
	}
	if err := store.ValidateChatExportToken(tok, time.Now().UTC()); err != nil {
		writeErr(w, http.StatusUnauthorized, "لینک نامعتبر یا منقضی است")
		return
	}
	// Consume before building the ZIP so a second concurrent hit cannot reuse the link.
	if _, err := s.store.ConsumeChatExportToken(r.Context(), tok.ID); err != nil {
		writeErr(w, http.StatusUnauthorized, "لینک نامعتبر یا منقضی است")
		return
	}
	out, files, err := s.buildProjectChatExport(r)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "ساخت خروجی گفتگوها ممکن نشد")
		return
	}
	observability.Activity("chat.export_external", "token_id", tok.ID, "conversations", len(out.Conversations), "files", len(files), "ip", clientAddress(r))
	if err := s.writeChatExportZip(w, out, files); err != nil {
		observability.L().Error("chat.export_zip", "error", err)
	}
}
