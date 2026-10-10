package api

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

	"pargar/backend/internal/models"
	"pargar/backend/internal/observability"
	"pargar/backend/internal/service"
	"pargar/backend/internal/store"
)

func (s *Server) handleQuiz(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	id := routeID(r, "id")
	lesson, err := s.store.GetLesson(r.Context(), id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "درس پیدا نشد")
		return
	}
	if !s.allowLessonAccess(w, r, lesson) {
		return
	}
	pg, _ := s.store.GetProgress(r.Context(), u.ID, id)
	if pg == nil || !pg.QuizUnlocked {
		writeErr(w, http.StatusForbidden, service.ErrQuizNotUnlocked.Error())
		return
	}
	questions, err := s.store.ListQuestions(r.Context(), id, false)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "بارگذاری پرسش‌ها ممکن نشد")
		return
	}
	views := make([]models.QuizQuestionView, 0, len(questions))
	for _, q := range questions {
		views = append(views, models.QuizQuestionView{ID: q.ID, Position: q.Position, Question: q.Question, Options: q.Options})
	}
	lastAttempt, _ := s.store.LastAttempt(r.Context(), u.ID, id)
	writeJSON(w, http.StatusOK, map[string]any{
		"lessonID":    id,
		"duration":    lesson.DurationSeconds,
		"questions":   views,
		"lastAttempt": lastAttempt,
		"passed":      pg.PassedQuiz,
		"quizStatus":  attemptStatus(lastAttempt),
	})
}

type quizSubmitRequest struct {
	Answers []int `json:"answers"`
}

func (s *Server) handleQuizSubmit(w http.ResponseWriter, r *http.Request) {
	ctx, span := observability.StartSpan(r.Context(), "quiz.submit")
	defer span.End()
	r = r.WithContext(ctx)

	u := currentUser(r)
	id := routeID(r, "id")

	// refresh any regenerated hearts before consuming
	u, _ = s.hearts.RefreshHearts(r.Context(), u)

	lesson, err := s.store.GetLesson(r.Context(), id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "درس پیدا نشد")
		return
	}
	if !s.allowLessonAccess(w, r, lesson) {
		return
	}
	pg, err := s.store.GetProgress(r.Context(), u.ID, id)
	if err != nil || !pg.QuizUnlocked {
		writeErr(w, http.StatusForbidden, service.ErrQuizNotUnlocked.Error())
		return
	}
	if !pg.PassedQuiz && !u.Role.IsStaff() && u.Hearts <= 0 {
		writeErr(w, http.StatusForbidden, "جان‌ها تمام شده است. تا بازگشت یک جان صبر کنید.")
		return
	}

	var req quizSubmitRequest
	if err := bodyJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "پاسخ‌ها نامعتبر هستند")
		return
	}
	if len(req.Answers) == 0 {
		writeErr(w, http.StatusBadRequest, "هیچ پاسخی ارسال نشده است")
		return
	}

	questions, err := s.store.ListQuestions(r.Context(), id, true)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "بارگذاری پرسش‌ها ممکن نشد")
		return
	}
	if len(questions) == 0 {
		writeErr(w, http.StatusBadRequest, "این درس پرسشی ندارد")
		return
	}

	// grade server-side; answer keys never leave the server
	correct, wrong := 0, 0
	for i, q := range questions {
		if i >= len(req.Answers) || req.Answers[i] < 0 {
			wrong++
			continue
		}
		if req.Answers[i] >= len(q.Options) {
			wrong++
			continue
		}
		if req.Answers[i] == q.AnswerIndex {
			correct++
		} else {
			wrong++
		}
	}
	total := len(questions)
	passed := correct == total // strict: every answer must be correct

	// record attempt
	attempt, err := s.store.CreateAttempt(r.Context(), u.ID, id, req.Answers)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "ثبت تلاش ممکن نشد")
		return
	}
	status := "failed"
	if passed {
		status = "passed"
	}
	if err := s.store.FinalizeAttempt(r.Context(), attempt.ID, correct, total, float64(correct)/float64(total)*100, status, wrong); err != nil {
		observability.L().Error("finalize attempt", "error", err, "attempt_id", attempt.ID)
		writeErr(w, http.StatusInternalServerError, "نهایی‌سازی تلاش ممکن نشد")
		return
	}

	activeUser := u
	heartsLost := 0
	xpEarned := 0
	wasLocked := false

	if passed {
		firstPass, claimErr := s.store.ClaimFirstQuizPass(r.Context(), u.ID, id)
		if claimErr != nil {
			writeErr(w, http.StatusInternalServerError, "ثبت قبولی درس ممکن نشد")
			return
		}
		if firstPass {
			observability.Activity("lesson.passed", "user_id", u.ID, "lesson_id", id, "xp", lesson.XPReward)
			xpEarned = lesson.XPReward
			activeUser, err = s.rewardXP(r.Context(), u, xpEarned, "quiz", id)
			if err != nil {
				writeErr(w, http.StatusInternalServerError, "اعطای امتیاز ممکن نشد")
				return
			}
			if cert, created, cerr := s.issueCertificateIfEligible(r.Context(), activeUser); cerr == nil && created && cert != nil {
				observability.Activity("certificate.issued", "user_id", u.ID, "public_id", cert.PublicID)
				_ = s.notify.Notify(r.Context(), u.ID, "progress", "certificate_issued",
					"گواهینامه آماده است", "دوره را به پایان رساندید. گواهینامه دیجیتال شما صادر شد.", "/c/"+cert.PublicID, nil)
			}
			s.notifyQuizPassed(u.ID, lesson.Title, id, activeUser.StreakCurrent)
			_ = s.notifyUnlockedLessons(u.ID, id)
		}
	} else if pg.PassedQuiz {
		// Already cleared — practice attempts do not burn hearts.
		activeUser = u
	} else {
		// consume hearts for wrong answers
		activeUser, heartsLost, err = s.hearts.ConsumeHearts(r.Context(), u, wrong)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "به‌روزرسانی جان‌ها ممکن نشد")
			return
		}
		if activeUser.IsLocked && !u.IsLocked {
			wasLocked = true
			observability.Lockouts.Inc()
			observability.Activity("account.locked", "user_id", u.ID, "lesson_id", id, "reason", "hearts")
		}
		go func(wasLocked bool) {
			if wasLocked {
				_ = s.notify.Notify(context.Background(), u.ID, "progress", "account_locked",
					"حساب محدود شد", "جان‌های شما تمام شده است. دسترسی به حساب تا بررسی متصدی محدود می‌شود.", "/lockout", nil)
			} else if heartsLost > 0 {
				_ = s.notify.Notify(context.Background(), u.ID, "progress", "heart_lost",
					"یک جان از دست رفت", "یکی از جان‌های شما کم شد. ادامه دهید!", "/unwrap", nil)
			}
		}(wasLocked)
	}

	resultLabel := "fail"
	if passed {
		resultLabel = "pass"
	}
	observability.QuizSubmits.WithLabelValues(resultLabel).Inc()
	observability.Activity("quiz.submit",
		"user_id", u.ID,
		"lesson_id", id,
		"passed", passed,
		"correct", correct,
		"total", total,
		"hearts_lost", heartsLost,
		"hearts_left", activeUser.Hearts,
		"xp_earned", xpEarned,
	)

	writeJSON(w, http.StatusOK, map[string]any{
		"passed":       passed,
		"correctCount": correct,
		"total":        total,
		"heartsLost":   heartsLost,
		"heartsLeft":   activeUser.Hearts,
		"xpEarned":     xpEarned,
		"locked":       activeUser.IsLocked,
		"wasLocked":    wasLocked,
		"streak":       activeUser.StreakCurrent,
	})
}

// rewardXP applies XP atomically: user, xp_events ledger, weekly leaderboard (DB + Redis), streak.
func (s *Server) rewardXP(ctx context.Context, u *models.User, amount int, source string, refID int64) (*models.User, error) {
	tx, err := s.store.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if err := s.store.AddXPEvent(ctx, tx, u.ID, amount, source, refID); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	if err := s.store.UpdateLeaderboardRow(ctx, service.ISOWeek(time.Now()), u.ID, amount); err != nil {
		return nil, err
	}
	if err := s.store.AddChallengeProgress(ctx, u.ID, amount); err != nil {
		return nil, err
	}
	if s.redis != nil {
		key := "lb:" + service.ISOWeek(time.Now())
		s.redis.ZIncrBy(ctx, key, float64(amount), strconv.FormatInt(u.ID, 10))
		s.redis.ZIncrBy(ctx, key, 0, strconv.FormatInt(u.ID, 10)) // ensure membership
	}
	user, err := s.store.AddUserXP(ctx, u.ID, amount)
	if err != nil {
		return nil, err
	}
	updated, err := service.UpdateStreak(ctx, s.store, user)
	if err != nil {
		return nil, err
	}
	return updated, nil
}

func (s *Server) notifyQuizPassed(userID int64, lessonTitle string, lessonID int64, streak int) {
	body := "آفرین! درس «" + lessonTitle + "» را با موفقیت گذراندید."
	if streak > 0 && streak%7 == 0 {
		body = "آفرین! زنجیرهٔ فعالیت شما به " + strconv.Itoa(streak) + " روز رسید."
	}
	_ = s.notify.Notify(context.Background(), userID, "gamification", "quiz_passed",
		"آزمون را قبول شدید", body, "/cap?lesson="+strconv.FormatInt(lessonID, 10), nil)
}

// notifyUnlockedLessons notifies about lessons whose prerequisite just got passed.
func (s *Server) notifyUnlockedLessons(userID, lessonID int64) error {
	lessons, err := s.store.ListLessons(context.Background(), true)
	if err != nil {
		return err
	}
	for _, l := range lessons {
		if l.RequiresLessonID != nil && *l.RequiresLessonID == lessonID {
			_ = s.notify.Notify(context.Background(), userID, "progress", "lesson_unlocked",
				"درس جدید باز شد", "درس «"+l.Title+"» اکنون در دسترس است.", "/cap?lesson="+strconv.FormatInt(l.ID, 10), nil)
		}
	}
	return nil
}

// ---- quiz result endpoint ----

func (s *Server) handleQuizResult(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	id := routeID(r, "id")
	lesson, err := s.store.GetLesson(r.Context(), id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "درس پیدا نشد")
		return
	}
	if !s.allowLessonAccess(w, r, lesson) {
		return
	}
	at, err := s.store.LastAttempt(r.Context(), u.ID, id)
	if err != nil {
		if err == store.ErrNotFound {
			writeErr(w, http.StatusNotFound, "هنوز تلاشی ثبت نشده است")
			return
		}
		writeErr(w, http.StatusInternalServerError, "بارگذاری نتیجه ممکن نشد")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"correctCount": at.CorrectCount,
		"total":        at.Total,
		"scorePct":     at.ScorePct,
		"status":       at.Status,
		"passedAt":     at.PassedAt,
		"createdAt":    at.CreatedAt,
	})
}

// handleRequestReset does not provide a self-service unlock path.
func (s *Server) handleRequestReset(w http.ResponseWriter, r *http.Request) {
	writeErr(w, http.StatusForbidden, "بازنشانی مسیر فقط با اقدام متصدی ممکن است")
}

// handleRequestUnlock queues a staff review request (does not unlock the account).
func (s *Server) handleRequestUnlock(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	if u.Role != models.RoleStudent {
		writeErr(w, http.StatusBadRequest, "فقط دانشجو می‌تواند درخواست رفع قفل بدهد")
		return
	}
	if !u.IsLocked {
		writeErr(w, http.StatusConflict, "حساب شما قفل نیست")
		return
	}
	var req struct {
		Note string `json:"note"`
	}
	_ = bodyJSON(r, &req)
	req.Note = strings.TrimSpace(req.Note)
	if len(req.Note) > 500 {
		writeErr(w, http.StatusBadRequest, "یادداشت نباید بیش از ۵۰۰ نویسه باشد")
		return
	}
	if existing, err := s.store.LatestOpenUnlockRequest(r.Context(), u.ID, 12*time.Hour); err == nil && existing != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":      true,
			"request": existing,
			"message": "درخواست قبلی شما هنوز در صف بررسی است",
		})
		return
	}
	ur, err := s.store.CreateUnlockRequest(r.Context(), u.ID, req.Note)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "ثبت درخواست ممکن نشد")
		return
	}
	staff, _ := s.store.ListMentors(r.Context())
	body := u.Name + " درخواست رفع قفل حساب داده است."
	if req.Note != "" {
		body += " یادداشت: " + req.Note
	}
	go func() {
		for _, m := range staff {
			_ = s.notify.Notify(context.Background(), m.ID, "mentor", "unlock_request",
				"درخواست رفع قفل", body, "/admin", map[string]any{"userId": u.ID, "requestId": ur.ID})
		}
	}()
	observability.Activity("account.unlock_requested", "user_id", u.ID, "request_id", ur.ID)
	writeJSON(w, http.StatusCreated, map[string]any{
		"ok":      true,
		"request": ur,
		"message": "درخواست برای تیم ارسال شد. می‌توانید همزمان با منتور هم گفتگو کنید.",
	})
}
