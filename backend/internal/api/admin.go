package api

import (
	"context"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"pargar/backend/internal/models"
	"pargar/backend/internal/observability"
)

func (s *Server) handleAdminStats(w http.ResponseWriter, r *http.Request) {
	stats, err := s.store.Stats(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "بارگذاری آمار ممکن نشد")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"stats": stats})
}

func (s *Server) handleAdminListUsers(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("q")
	role := r.URL.Query().Get("role")
	p := parsePageParams(r)
	users, total, err := s.store.ListUsers(r.Context(), query, role, p.PageSize, p.Offset)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "بارگذاری کاربران ممکن نشد")
		return
	}
	writePage(w, users, total, p)
}

func (s *Server) handleAdminCreateUser(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name             string `json:"name"`
		Email            string `json:"email"`
		Username         string `json:"username"`
		Password         string `json:"password"`
		Role             string `json:"role"`
		Phone            string `json:"phone"`
		SecurityQuestion string `json:"securityQuestion"`
		SecurityAnswer   string `json:"securityAnswer"`
	}
	if err := bodyJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "دادهٔ ارسالی نامعتبر است")
		return
	}
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	req.Username = strings.ToLower(strings.TrimSpace(req.Username))
	name := strings.TrimSpace(req.Name)
	phone := normalizePhone(req.Phone)
	secQ := strings.TrimSpace(req.SecurityQuestion)
	secA := strings.TrimSpace(req.SecurityAnswer)

	if msg := validatePersonName(name); msg != "" {
		writeErr(w, http.StatusBadRequest, msg)
		return
	}
	if !validEmail(req.Email) {
		writeErr(w, http.StatusBadRequest, msgEmailInvalid)
		return
	}
	if !validUsername(req.Username) {
		writeErr(w, http.StatusBadRequest, msgUsernameInvalid)
		return
	}
	if !validPhone(phone) {
		writeErr(w, http.StatusBadRequest, msgPhoneInvalid)
		return
	}
	if msg := validatePasswordOnly(req.Password); msg != "" {
		writeErr(w, http.StatusBadRequest, msg)
		return
	}
	if msg := validateSecurityQA(secQ, secA); msg != "" {
		writeErr(w, http.StatusBadRequest, msg)
		return
	}
	var role models.Role
	switch req.Role {
	case "", "student":
		role = models.RoleStudent
	case "mentor":
		role = models.RoleMentor
	case "admin":
		role = models.RoleAdmin
	default:
		writeErr(w, http.StatusBadRequest, "نقش نامعتبر است")
		return
	}
	if actor := currentUser(r); actor.Role != models.RoleAdmin && role != models.RoleStudent {
		writeErr(w, http.StatusForbidden, "منتور فقط می‌تواند حساب هنرجو بسازد")
		return
	}
	if _, err := s.store.GetUserByEmail(r.Context(), req.Email); err == nil {
		writeErr(w, http.StatusConflict, "این ایمیل قبلاً ثبت شده است")
		return
	}
	if _, err := s.store.GetUserByUsername(r.Context(), req.Username); err == nil {
		writeErr(w, http.StatusConflict, "این شناسهٔ کاربری قبلاً گرفته شده است")
		return
	}
	if phone != "" {
		if _, err := s.store.GetUserByPhone(r.Context(), phone); err == nil {
			writeErr(w, http.StatusConflict, "این شماره تلفن قبلاً ثبت شده است")
			return
		}
	}
	hash, err := s.auth.HashPassword(req.Password)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "پردازش گذرواژه ممکن نشد")
		return
	}
	answerHash, err := s.auth.HashPassword(strings.ToLower(secA))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "پردازش جواب امنیتی ممکن نشد")
		return
	}
	user, err := s.store.CreateUser(r.Context(), name, req.Email, req.Username, hash, phone, secQ, answerHash, role)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "ساخت کاربر ممکن نشد")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"user": user})
}

func (s *Server) handleAdminLockUser(w http.ResponseWriter, r *http.Request) {
	actor := currentUser(r)
	id := routeID(r, "id")
	if id == actor.ID {
		writeErr(w, http.StatusBadRequest, "نمی‌توانید حساب خودتان را قفل کنید")
		return
	}
	if err := s.canActOn(actor, id); err != nil {
		writeErr(w, http.StatusForbidden, "دسترسی کافی ندارید")
		return
	}
	target, err := s.store.GetUserByID(r.Context(), id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "کاربر پیدا نشد")
		return
	}
	if target.Role.IsStaff() {
		writeErr(w, http.StatusBadRequest, "حساب ادمین و منتور قابل قفل نیست")
		return
	}
	u, err := s.store.LockUser(r.Context(), id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "کاربر پیدا نشد")
		return
	}
	observability.Activity("account.locked", "user_id", id, "actor_id", actor.ID, "reason", "staff")
	go func() {
		_ = s.notify.Notify(context.Background(), id, "progress", "account_locked",
			"حساب توسط منتور محدود شد", "حساب شما توسط "+actor.Name+" محدود شد.", "/unwrap?tab=chats", nil)
	}()
	writeJSON(w, http.StatusOK, map[string]any{"user": u})
}

func (s *Server) handleAdminUnlockUser(w http.ResponseWriter, r *http.Request) {
	actor := currentUser(r)
	id := routeID(r, "id")
	if err := s.canActOn(actor, id); err != nil {
		writeErr(w, http.StatusForbidden, "دسترسی کافی ندارید")
		return
	}
	u, err := s.store.UnlockUser(r.Context(), id, actor.ID)
	if err != nil {
		writeErr(w, http.StatusNotFound, "کاربر پیدا نشد")
		return
	}
	_ = s.store.ResolveUnlockRequests(r.Context(), id)
	observability.Activity("account.unlocked", "user_id", id, "actor_id", actor.ID)
	go func() {
		_ = s.notify.Notify(context.Background(), id, "progress", "account_unlocked",
			"محدودیت حساب برداشته شد", "محدودیت حساب شما توسط "+actor.Name+" برداشته شد. ۳ جان شما بازگردانده شد.", "/cap", nil)
	}()
	writeJSON(w, http.StatusOK, map[string]any{"user": u})
}

func (s *Server) handleAdminSetRole(w http.ResponseWriter, r *http.Request) {
	actor := currentUser(r)
	id := routeID(r, "id")
	if id == actor.ID {
		writeErr(w, http.StatusBadRequest, "نمی‌توانید نقش حساب خودتان را تغییر دهید")
		return
	}
	if err := s.canActOn(actor, id); err != nil {
		writeErr(w, http.StatusForbidden, "دسترسی کافی ندارید")
		return
	}
	var req struct {
		Role string `json:"role"`
	}
	if err := bodyJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "دادهٔ ارسالی نامعتبر است")
		return
	}
	var role models.Role
	switch req.Role {
	case "student", "mentor", "admin":
		role = models.Role(req.Role)
	default:
		writeErr(w, http.StatusBadRequest, "نقش نامعتبر است")
		return
	}
	if actor.Role != models.RoleAdmin && role != models.RoleStudent {
		writeErr(w, http.StatusForbidden, "منتور فقط می‌تواند نقش هنرجو را تنظیم کند")
		return
	}
	if _, err := s.store.Pool().Exec(r.Context(), `UPDATE users SET role=$1 WHERE id=$2`, role.String(), id); err != nil {
		writeErr(w, http.StatusInternalServerError, "تغییر نقش ممکن نشد")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleAdminUpdateUser(w http.ResponseWriter, r *http.Request) {
	actor := currentUser(r)
	id := routeID(r, "id")
	if err := s.canActOn(actor, id); err != nil {
		writeErr(w, http.StatusForbidden, "دسترسی کافی ندارید")
		return
	}
	target, err := s.store.GetUserByID(r.Context(), id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "کاربر پیدا نشد")
		return
	}
	var req struct {
		Name             *string `json:"name"`
		Email            *string `json:"email"`
		Username         *string `json:"username"`
		Password         *string `json:"password"`
		Role             *string `json:"role"`
		Hearts           *int    `json:"hearts"`
		XP               *int    `json:"xp"`
		Phone            *string `json:"phone"`
		SecurityQuestion *string `json:"securityQuestion"`
		SecurityAnswer   *string `json:"securityAnswer"`
	}
	if err := bodyJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "دادهٔ ارسالی نامعتبر است")
		return
	}
	name := target.Name
	if req.Name != nil {
		name = strings.TrimSpace(*req.Name)
		if msg := validatePersonName(name); msg != "" {
			writeErr(w, http.StatusBadRequest, msg)
			return
		}
	}
	email := target.Email
	if req.Email != nil && strings.TrimSpace(*req.Email) != "" {
		email = strings.ToLower(strings.TrimSpace(*req.Email))
		if !validEmail(email) {
			writeErr(w, http.StatusBadRequest, msgEmailInvalid)
			return
		}
		if email != target.Email {
			if _, err := s.store.GetUserByEmail(r.Context(), email); err == nil {
				writeErr(w, http.StatusConflict, "این ایمیل قبلاً ثبت شده است")
				return
			}
		}
	}
	username := target.Username
	if req.Username != nil && strings.TrimSpace(*req.Username) != "" {
		username = strings.ToLower(strings.TrimSpace(*req.Username))
		if !validUsername(username) {
			writeErr(w, http.StatusBadRequest, msgUsernameInvalid)
			return
		}
		if username != target.Username {
			if _, err := s.store.GetUserByUsername(r.Context(), username); err == nil {
				writeErr(w, http.StatusConflict, "این شناسهٔ کاربری قبلاً گرفته شده است")
				return
			}
		}
	}
	phone := target.Phone
	if req.Phone != nil {
		phone = normalizePhone(*req.Phone)
		if !validPhone(phone) {
			writeErr(w, http.StatusBadRequest, msgPhoneInvalid)
			return
		}
		if phone != "" && phone != target.Phone {
			if _, err := s.store.GetUserByPhone(r.Context(), phone); err == nil {
				writeErr(w, http.StatusConflict, "این شماره تلفن قبلاً ثبت شده است")
				return
			}
		}
	}
	hash := ""
	if req.Password != nil && *req.Password != "" {
		writeErr(w, http.StatusBadRequest, "برای تغییر رمز از مسیر ریست با سوال امنیتی استفاده کنید")
		return
	}
	secQ := ""
	secAHash := ""
	if req.SecurityQuestion != nil {
		secQ = strings.TrimSpace(*req.SecurityQuestion)
		if secQ != "" {
			qn := utf8.RuneCountInString(secQ)
			if qn < minSecQLen {
				writeErr(w, http.StatusBadRequest, msgSecQShort)
				return
			}
			if qn > maxSecQLen {
				writeErr(w, http.StatusBadRequest, msgSecQLong)
				return
			}
		}
	}
	if req.SecurityAnswer != nil && strings.TrimSpace(*req.SecurityAnswer) != "" {
		if secQ == "" && target.SecurityQuestion == "" {
			writeErr(w, http.StatusBadRequest, "برای تنظیم جواب، سوال امنیتی هم لازم است")
			return
		}
		if secQ == "" {
			secQ = target.SecurityQuestion
		}
		ans := strings.TrimSpace(*req.SecurityAnswer)
		an := utf8.RuneCountInString(ans)
		if an < minSecALen {
			writeErr(w, http.StatusBadRequest, msgSecAShort)
			return
		}
		if an > maxSecALen {
			writeErr(w, http.StatusBadRequest, msgSecALong)
			return
		}
		var err error
		secAHash, err = s.auth.HashPassword(strings.ToLower(ans))
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "پردازش جواب امنیتی ممکن نشد")
			return
		}
	}
	role := target.Role
	if req.Role != nil {
		switch *req.Role {
		case "student", "mentor", "admin":
			newRole := models.Role(*req.Role)
			if id == actor.ID && newRole != target.Role {
				writeErr(w, http.StatusBadRequest, "نمی‌توانید نقش حساب خودتان را تغییر دهید")
				return
			}
			if actor.Role != models.RoleAdmin && newRole != models.RoleStudent {
				writeErr(w, http.StatusForbidden, "منتور فقط می‌تواند نقش هنرجو را تنظیم کند")
				return
			}
			role = newRole
		default:
			writeErr(w, http.StatusBadRequest, "نقش نامعتبر است")
			return
		}
	}
	hearts, xp := target.Hearts, target.XP
	if id == actor.ID {
		// Self-service via admin panel must not mint XP/hearts.
		req.Hearts = nil
		req.XP = nil
	}
	if req.Hearts != nil {
		hearts = *req.Hearts
	}
	if req.XP != nil {
		xp = *req.XP
	}
	user, err := s.store.UpdateUser(r.Context(), id, name, email, username, hash, phone, secQ, secAHash, role, hearts, xp)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "به‌روزرسانی کاربر ممکن نشد")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": user})
}

func (s *Server) handleAdminResetPassword(w http.ResponseWriter, r *http.Request) {
	actor := currentUser(r)
	id := routeID(r, "id")
	if err := s.canActOn(actor, id); err != nil {
		writeErr(w, http.StatusForbidden, "دسترسی کافی ندارید")
		return
	}
	target, err := s.store.GetUserByID(r.Context(), id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "کاربر پیدا نشد")
		return
	}
	var req struct {
		SecurityAnswer string `json:"securityAnswer"`
		NewPassword    string `json:"newPassword"`
	}
	if err := bodyJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "دادهٔ ارسالی نامعتبر است")
		return
	}
	if target.SecurityAnswerHash == "" {
		writeErr(w, http.StatusBadRequest, "برای این کاربر سوال امنیتی تعریف نشده است")
		return
	}
	if !s.auth.CheckPassword(target.SecurityAnswerHash, strings.ToLower(strings.TrimSpace(req.SecurityAnswer))) {
		writeErr(w, http.StatusForbidden, "جواب سوال امنیتی نادرست است")
		return
	}
	if msg := validatePasswordOnly(req.NewPassword); msg != "" {
		writeErr(w, http.StatusBadRequest, msg)
		return
	}
	hash, err := s.auth.HashPassword(req.NewPassword)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "پردازش گذرواژه ممکن نشد")
		return
	}
	if err := s.store.SetUserPassword(r.Context(), id, hash); err != nil {
		writeErr(w, http.StatusInternalServerError, "ریست گذرواژه ممکن نشد")
		return
	}
	observability.Activity("account.password_reset", "user_id", id, "actor_id", actor.ID)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleAdminDeleteUser(w http.ResponseWriter, r *http.Request) {
	actor := currentUser(r)
	id := routeID(r, "id")
	if id == actor.ID {
		writeErr(w, http.StatusBadRequest, "نمی‌توانید حساب خودتان را حذف کنید")
		return
	}
	if err := s.canActOn(actor, id); err != nil {
		writeErr(w, http.StatusForbidden, "دسترسی کافی ندارید")
		return
	}
	if err := s.store.DeleteUser(r.Context(), id); err != nil {
		writeErr(w, http.StatusInternalServerError, "حذف کاربر ممکن نشد")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// canActOn verifies a non-admin actor may only mutate student accounts.
func (s *Server) canActOn(actor *models.User, targetID int64) error {
	if actor.Role == models.RoleAdmin {
		return nil
	}
	target, err := s.store.GetUserByID(context.Background(), targetID)
	if err != nil {
		return err
	}
	if target.Role != models.RoleStudent {
		return fmt.Errorf("فقط می‌توانید روی حساب هنرجویان عمل کنید")
	}
	return nil
}

// ---- chapters ----

func (s *Server) handleAdminListChapters(w http.ResponseWriter, r *http.Request) {
	chapters, err := s.store.ListChapters(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "بارگذاری فصل‌ها ممکن نشد")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"chapters": chapters})
}

func (s *Server) handleAdminCreateChapter(w http.ResponseWriter, r *http.Request) {
	var c models.Chapter
	if err := bodyJSON(r, &c); err != nil {
		writeErr(w, http.StatusBadRequest, "دادهٔ ارسالی نامعتبر است")
		return
	}
	id, err := s.store.CreateChapter(r.Context(), &c)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "ساخت فصل ممکن نشد")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"chapter": c, "id": id})
}

func (s *Server) handleAdminUpdateChapter(w http.ResponseWriter, r *http.Request) {
	id := routeID(r, "id")
	var c models.Chapter
	if err := bodyJSON(r, &c); err != nil {
		writeErr(w, http.StatusBadRequest, "دادهٔ ارسالی نامعتبر است")
		return
	}
	if err := s.store.UpdateChapter(r.Context(), id, &c); err != nil {
		writeErr(w, http.StatusInternalServerError, "به‌روزرسانی فصل ممکن نشد")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleAdminDeleteChapter(w http.ResponseWriter, r *http.Request) {
	id := routeID(r, "id")
	if err := s.store.DeleteChapter(r.Context(), id); err != nil {
		writeErr(w, http.StatusInternalServerError, "حذف فصل ممکن نشد")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// ---- lessons ----

func (s *Server) handleAdminListLessons(w http.ResponseWriter, r *http.Request) {
	lessons, err := s.store.ListLessons(r.Context(), true)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "بارگذاری درس‌ها ممکن نشد")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"lessons": lessons})
}

func (s *Server) handleAdminCreateLesson(w http.ResponseWriter, r *http.Request) {
	var l models.Lesson
	if err := bodyJSON(r, &l); err != nil {
		writeErr(w, http.StatusBadRequest, "دادهٔ ارسالی نامعتبر است")
		return
	}
	if l.DurationSeconds <= 0 {
		writeErr(w, http.StatusBadRequest, "مدت درس الزامی است")
		return
	}
	id, err := s.store.CreateLesson(r.Context(), &l)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "ساخت درس ممکن نشد")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"lesson": l, "id": id})
}

func (s *Server) handleAdminUpdateLesson(w http.ResponseWriter, r *http.Request) {
	id := routeID(r, "id")
	var l models.Lesson
	if err := bodyJSON(r, &l); err != nil {
		writeErr(w, http.StatusBadRequest, "دادهٔ ارسالی نامعتبر است")
		return
	}
	if err := s.store.UpdateLesson(r.Context(), id, &l); err != nil {
		writeErr(w, http.StatusInternalServerError, "به‌روزرسانی درس ممکن نشد")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleAdminDeleteLesson(w http.ResponseWriter, r *http.Request) {
	id := routeID(r, "id")
	if err := s.store.DeleteLesson(r.Context(), id); err != nil {
		writeErr(w, http.StatusInternalServerError, "حذف درس ممکن نشد")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// ---- questions ----

func (s *Server) handleAdminListQuestions(w http.ResponseWriter, r *http.Request) {
	lessonID := routeID(r, "id")
	questions, err := s.store.ListQuestions(r.Context(), lessonID, true)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "بارگذاری پرسش‌ها ممکن نشد")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"questions": questions})
}

func (s *Server) handleAdminCreateQuestion(w http.ResponseWriter, r *http.Request) {
	lessonID := routeID(r, "id")
	var q models.MCQQuestion
	if err := bodyJSON(r, &q); err != nil {
		writeErr(w, http.StatusBadRequest, "دادهٔ ارسالی نامعتبر است")
		return
	}
	q.LessonID = lessonID
	if len(q.Options) < 2 {
		writeErr(w, http.StatusBadRequest, "دست‌کم ۲ گزینه لازم است")
		return
	}
	if q.AnswerIndex < 0 || q.AnswerIndex >= len(q.Options) {
		writeErr(w, http.StatusBadRequest, "شاخص پاسخ نامعتبر است")
		return
	}
	id, err := s.store.CreateQuestion(r.Context(), &q)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "ساخت پرسش ممکن نشد")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"question": q, "id": id})
}

func (s *Server) handleAdminUpdateQuestion(w http.ResponseWriter, r *http.Request) {
	id := routeID(r, "id")
	var q models.MCQQuestion
	if err := bodyJSON(r, &q); err != nil {
		writeErr(w, http.StatusBadRequest, "دادهٔ ارسالی نامعتبر است")
		return
	}
	if len(q.Options) < 2 {
		writeErr(w, http.StatusBadRequest, "دست‌کم ۲ گزینه لازم است")
		return
	}
	if q.AnswerIndex < 0 || q.AnswerIndex >= len(q.Options) {
		writeErr(w, http.StatusBadRequest, "شاخص پاسخ نامعتبر است")
		return
	}
	if err := s.store.UpdateQuestion(r.Context(), id, &q); err != nil {
		writeErr(w, http.StatusInternalServerError, "به‌روزرسانی پرسش ممکن نشد")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleAdminDeleteQuestion(w http.ResponseWriter, r *http.Request) {
	id := routeID(r, "id")
	if err := s.store.DeleteQuestion(r.Context(), id); err != nil {
		writeErr(w, http.StatusInternalServerError, "حذف پرسش ممکن نشد")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// ---- video library ----

func (s *Server) handleAdminListVideos(w http.ResponseWriter, r *http.Request) {
	rows, err := s.store.ListVideoAssets(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "بارگذاری ویدیوها ممکن نشد")
		return
	}
	videos := make([]map[string]any, 0, len(rows))
	for _, v := range rows {
		videos = append(videos, map[string]any{
			"key":          v.Key,
			"mime":         v.Mime,
			"size":         v.SizeBytes,
			"lastModified": v.CreatedAt,
		})
	}
	// Also surface keys that exist only on lessons (legacy uploads).
	lessons, _ := s.store.ListLessons(r.Context(), true)
	seen := map[string]struct{}{}
	for _, v := range videos {
		if k, ok := v["key"].(string); ok {
			seen[k] = struct{}{}
		}
	}
	for _, l := range lessons {
		if l.VideoKey == "" {
			continue
		}
		if _, ok := seen[l.VideoKey]; ok {
			continue
		}
		seen[l.VideoKey] = struct{}{}
		videos = append(videos, map[string]any{
			"key":  l.VideoKey,
			"mime": "video/mp4",
			"size": 0,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"videos": videos})
}

func (s *Server) handleAdminDeleteVideo(w http.ResponseWriter, r *http.Request) {
	key := strings.TrimSpace(r.URL.Query().Get("key"))
	if key == "" {
		writeErr(w, http.StatusBadRequest, "کلید ویدیو الزامی است")
		return
	}
	key = filepath.Base(key)
	if err := s.store.DeleteVideoAsset(r.Context(), key); err != nil {
		writeErr(w, http.StatusInternalServerError, "حذف ویدیو ممکن نشد")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleAdminUploadVideo(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxAdminVideoBytes+1<<20)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeErr(w, http.StatusRequestEntityTooLarge, "حجم ویدیو باید کمتر از ۲۰۰ مگابایت باشد")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "فایل ارسال نشده است")
		return
	}
	defer file.Close()

	accepted, err := acceptAdminVideo(header, file)
	if err != nil {
		if strings.Contains(err.Error(), "۲۰۰ مگابایت") {
			writeErrCode(w, http.StatusRequestEntityTooLarge, CodePayloadTooLarge, err.Error())
			return
		}
		writeValidationErr(w, err.Error())
		return
	}

	// Prefer stable mp4-first naming; keep real extension for playback.
	key := fmt.Sprintf("lesson-%d%s", time.Now().UnixNano(), accepted.Ext)
	key = filepath.Base(key)
	url, err := s.storage.Save(key, file, header.Size)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "ذخیرهٔ ویدیو ممکن نشد")
		return
	}
	if err := s.store.CreateVideoAsset(r.Context(), key, accepted.Mime, header.Size); err != nil {
		writeErr(w, http.StatusInternalServerError, "ثبت ویدیو در کتابخانه ممکن نشد")
		return
	}
	observability.VideoUploads.Inc()
	if actor := currentUser(r); actor != nil {
		observability.Activity("video.upload", "user_id", actor.ID, "key", key, "size", header.Size, "mime", accepted.Mime)
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"url":  s.signExistingMediaURL(url),
		"key":  key,
		"size": header.Size,
		"mime": accepted.Mime,
	})
}

// ---- events (admin) ----

func (s *Server) handleAdminListEvents(w http.ResponseWriter, r *http.Request) {
	rows, err := s.store.Pool().Query(r.Context(), `
		SELECT id, title, description, event_type, external_url, starts_at, ends_at, is_active, created_at
		FROM events ORDER BY starts_at DESC LIMIT 200`)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "بارگذاری رویدادها ممکن نشد")
		return
	}
	var events []models.Event
	for rows.Next() {
		var e models.Event
		if err := rows.Scan(&e.ID, &e.Title, &e.Description, &e.EventType, &e.ExternalURL, &e.StartsAt, &e.EndsAt, &e.IsActive, &e.CreatedAt); err != nil {
			rows.Close()
			writeErr(w, http.StatusInternalServerError, "بارگذاری رویدادها ممکن نشد")
			return
		}
		events = append(events, e)
	}
	rows.Close()
	if events == nil {
		events = []models.Event{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"events": events})
}

func (s *Server) handleAdminCreateEvent(w http.ResponseWriter, r *http.Request) {
	admin := currentUser(r)
	var e models.Event
	if err := bodyJSON(r, &e); err != nil {
		writeErr(w, http.StatusBadRequest, "دادهٔ ارسالی نامعتبر است")
		return
	}
	if msg := validateAdminEvent(&e, true); msg != "" {
		writeValidationErr(w, msg)
		return
	}
	e.CreatedBy = &admin.ID
	id, err := s.store.CreateEvent(r.Context(), &e)
	if err != nil {
		writeInternalErr(w, "admin.events.create", err, "ساخت رویداد ممکن نشد")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"event": e, "id": id})
}

func (s *Server) handleAdminUpdateEvent(w http.ResponseWriter, r *http.Request) {
	id := routeID(r, "id")
	var e models.Event
	if err := bodyJSON(r, &e); err != nil {
		writeErr(w, http.StatusBadRequest, "دادهٔ ارسالی نامعتبر است")
		return
	}
	if msg := validateAdminEvent(&e, false); msg != "" {
		writeValidationErr(w, msg)
		return
	}
	if err := s.store.UpdateEvent(r.Context(), id, &e); err != nil {
		writeInternalErr(w, "admin.events.update", err, "به‌روزرسانی رویداد ممکن نشد")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleAdminDeleteEvent(w http.ResponseWriter, r *http.Request) {
	id := routeID(r, "id")
	if err := s.store.DeleteEvent(r.Context(), id); err != nil {
		writeInternalErr(w, "admin.events.delete", err, "حذف رویداد ممکن نشد")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// validateAdminEvent normalizes and checks event fields. create=true defaults isActive to true when unset via zero-value ambiguity is handled by callers sending explicit bool.
func validateAdminEvent(e *models.Event, create bool) string {
	e.Title = strings.TrimSpace(e.Title)
	e.Description = strings.TrimSpace(e.Description)
	e.ExternalURL = strings.TrimSpace(e.ExternalURL)
	e.EventType = strings.TrimSpace(e.EventType)
	if e.EventType == "" {
		e.EventType = "meet"
	}
	switch e.EventType {
	case "meet", "zoom", "workshop":
	default:
		return "نوع رویداد نامعتبر است"
	}
	if e.Title == "" || e.StartsAt.IsZero() || e.EndsAt.IsZero() {
		return "عنوان، زمان شروع و زمان پایان الزامی هستند"
	}
	if utf8.RuneCountInString(e.Title) > 200 {
		return "عنوان رویداد خیلی طولانی است"
	}
	if utf8.RuneCountInString(e.Description) > 5000 {
		return "توضیح رویداد خیلی طولانی است"
	}
	if e.EndsAt.Before(e.StartsAt) {
		return "زمان پایان باید پس از زمان شروع باشد"
	}
	_ = create
	return ""
}

// ---- announcements ----

func (s *Server) handleAdminAnnounce(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Title    string `json:"title"`
		Body     string `json:"body"`
		Route    string `json:"route"`
		Category string `json:"category"`
	}
	if err := bodyJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "دادهٔ ارسالی نامعتبر است")
		return
	}
	req.Title = strings.TrimSpace(req.Title)
	req.Body = strings.TrimSpace(req.Body)
	req.Route = strings.TrimSpace(req.Route)
	if utf8.RuneCountInString(req.Title) < 3 {
		writeErr(w, http.StatusBadRequest, "عنوان اطلاعیه خیلی کوتاه است")
		return
	}
	if utf8.RuneCountInString(req.Title) > 200 {
		writeErr(w, http.StatusBadRequest, "عنوان اطلاعیه خیلی طولانی است")
		return
	}
	if utf8.RuneCountInString(req.Body) < 8 {
		writeErr(w, http.StatusBadRequest, "متن اطلاعیه خیلی کوتاه است")
		return
	}
	if utf8.RuneCountInString(req.Body) > 500 {
		writeErr(w, http.StatusBadRequest, "متن اطلاعیه خیلی طولانی است")
		return
	}
	if req.Category == "" {
		req.Category = "event"
	}
	switch req.Category {
	case "event", "progress", "gamification", "mentor":
	default:
		writeErr(w, http.StatusBadRequest, "دستهٔ اطلاعیه نامعتبر است")
		return
	}
	userIDs, err := s.store.AllActiveUserIDs(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "بارگذاری کاربران ممکن نشد")
		return
	}
	go func() {
		for _, uid := range userIDs {
			_ = s.notify.Notify(context.Background(), uid, req.Category, "announcement",
				req.Title, req.Body, req.Route, nil)
		}
	}()
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "recipients": len(userIDs)})
}
