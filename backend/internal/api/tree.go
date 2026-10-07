package api

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"pargar/backend/internal/models"
	"pargar/backend/internal/observability"
	"pargar/backend/internal/service"
	"pargar/backend/internal/store"
)

// handleTree returns the full curriculum with per-user progress, quiz state and lock resolution.
func (s *Server) handleTree(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	chapters, err := s.store.ListChapters(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "بارگذاری فصل‌ها ممکن نشد")
		return
	}
	lessons, err := s.store.ListLessons(r.Context(), u.Role.IsStaff())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "بارگذاری درس‌ها ممکن نشد")
		return
	}
	progress, err := s.store.ProgressMap(r.Context(), u.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "بارگذاری پیشرفت ممکن نشد")
		return
	}
	attempts := map[int64]*models.QuizAttempt{}
	for _, l := range lessons {
		at, err := s.store.LastAttempt(r.Context(), u.ID, l.ID)
		if err == nil && at != nil {
			attempts[l.ID] = at
		}
	}

	type lessonView struct {
		models.Lesson
		Progress   *models.LessonProgress `json:"progress"`
		QuizStatus string                 `json:"quizStatus"`
		Locked     bool                   `json:"locked"`
	}
	type chapterView struct {
		models.Chapter
		Lessons []lessonView `json:"lessons"`
	}

	complete := map[int64]bool{}
	for _, l := range lessons {
		if p, ok := progress[l.ID]; ok && p.PassedQuiz {
			complete[l.ID] = true
		}
	}

	out := make([]chapterView, 0, len(chapters))
	for _, ch := range chapters {
		cv := chapterView{Chapter: ch, Lessons: []lessonView{}}
		for _, l := range lessons {
			if l.ChapterID != ch.ID {
				continue
			}
			lv := lessonView{Lesson: l}
			if !u.Role.IsStaff() {
				lv.VideoKey = "" // never expose storage keys to students
			}
			if p, ok := progress[l.ID]; ok {
				lv.Progress = p
			}
			if at, ok := attempts[l.ID]; ok {
				lv.QuizStatus = at.Status
			}
			// root lesson (no prerequisite) is always unlocked; otherwise require prerequisite passed quiz
			if l.RequiresLessonID != nil && !complete[*l.RequiresLessonID] {
				lv.Locked = true
			}
			cv.Lessons = append(cv.Lessons, lv)
		}
		out = append(out, cv)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"chapters": out,
		"me": map[string]any{
			"xp":       u.XP,
			"streak":   u.StreakCurrent,
			"hearts":   u.Hearts,
			"isLocked": u.IsLocked,
			"role":     u.Role,
		},
	})
}

func (s *Server) handleLesson(w http.ResponseWriter, r *http.Request) {
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
	progress, _ := s.store.GetProgress(r.Context(), u.ID, id)
	attempt, _ := s.store.LastAttempt(r.Context(), u.ID, id)

	videoKey := strings.TrimSpace(lesson.VideoKey)
	usingSample := false
	if videoKey == "" {
		// Always give the player something to show when a lesson has no uploaded video yet.
		videoKey = "sample.mp4"
		usingSample = true
	}
	videoURL := s.signMediaURL(videoKey)
	writeJSON(w, http.StatusOK, map[string]any{
		"lesson":        lesson,
		"videoUrl":      videoURL,
		"videoIsSample": usingSample,
		"progress":      progress,
		"quizStatus":    attemptStatus(attempt),
	})
}

func attemptStatus(at *models.QuizAttempt) string {
	if at == nil {
		return ""
	}
	return at.Status
}

func (s *Server) handleResume(w http.ResponseWriter, r *http.Request) {
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
	pos, err := s.watch.ResumePosition(r.Context(), u.ID, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "بارگذاری موقعیت ادامهٔ درس ممکن نشد")
		return
	}
	lastSeq, _ := s.store.MaxHeartbeatSeq(r.Context(), u.ID, id)
	writeJSON(w, http.StatusOK, map[string]any{"position": pos, "lastSeq": lastSeq})
}

type heartbeatRequest struct {
	Position float64 `json:"position"`
	Delta    float64 `json:"delta"`
	Seq      int     `json:"seq"`
}

func (s *Server) handleHeartbeat(w http.ResponseWriter, r *http.Request) {
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
	previousProgress, _ := s.store.GetProgress(r.Context(), u.ID, id)
	wasQuizUnlocked := previousProgress != nil && previousProgress.QuizUnlocked
	var req heartbeatRequest
	if err := bodyJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "ضربان پخش نامعتبر است")
		return
	}
	ctx, span := observability.StartSpan(r.Context(), "watch.heartbeat")
	defer span.End()
	pg, err := s.watch.Heartbeat(ctx, u.ID, lesson, req.Position, req.Delta, req.Seq)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "ثبت پیشرفت پخش ممکن نشد")
		return
	}
	observability.Heartbeats.Inc()
	unlockedNow := !wasQuizUnlocked && pg.QuizUnlocked
	if unlockedNow {
		observability.Activity("lesson.quiz_unlocked",
			"user_id", u.ID,
			"lesson_id", id,
			"watched_pct", round2(pg.WatchedPct),
		)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"watchedSeconds":  round2(pg.WatchedSeconds),
		"watchedPct":      round2(pg.WatchedPct),
		"position":        req.Position,
		"quizUnlocked":    pg.QuizUnlocked,
		"quizUnlockedNow": unlockedNow,
	})
}

func (s *Server) handleComplete(w http.ResponseWriter, r *http.Request) {
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
	pg, err := s.store.GetProgress(r.Context(), u.ID, id)
	if err != nil {
		writeErr(w, http.StatusForbidden, service.ErrQuizNotUnlocked.Error())
		return
	}
	if pg.WatchedPct < float64(lesson.CompletionThresholdPct) || !pg.QuizUnlocked {
		writeErr(w, http.StatusForbidden, "حداقل زمان تماشا تکمیل نشده است")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":           true,
		"quizUnlocked": pg.QuizUnlocked,
		"watchedPct":   round2(pg.WatchedPct),
		"message":      "آزمون باز شد",
	})
}

func round2(v float64) float64 {
	return float64(int64(v*100+0.5)) / 100
}

func (s *Server) allowLessonAccess(w http.ResponseWriter, r *http.Request, lesson *models.Lesson) bool {
	u := currentUser(r)
	if u == nil {
		writeErr(w, http.StatusUnauthorized, "نشست معتبر نیست")
		return false
	}
	if u.IsLocked && !u.Role.IsStaff() {
		writeErrCode(w, http.StatusLocked, CodeLocked, service.ErrLocked.Error())
		return false
	}
	if !lesson.IsActive && !u.Role.IsStaff() {
		writeErrCode(w, http.StatusNotFound, CodeNotFound, "درس پیدا نشد")
		return false
	}
	err := s.lessonAccessError(r.Context(), u.ID, lesson)
	if err == nil {
		return true
	}
	if errors.Is(err, service.ErrLessonLocked) {
		writeErrCode(w, http.StatusForbidden, CodeForbidden, service.ErrLessonLocked.Error())
	} else {
		writeInternalErr(w, "lesson.access", err, "بررسی دسترسی به درس ممکن نشد")
	}
	return false
}

func (s *Server) lessonAccessError(ctx context.Context, userID int64, lesson *models.Lesson) error {
	if lesson.RequiresLessonID == nil {
		return nil
	}
	progress, err := s.store.GetProgress(ctx, userID, *lesson.RequiresLessonID)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return service.ErrLessonLocked
		}
		return err
	}
	if !progress.PassedQuiz {
		return service.ErrLessonLocked
	}
	return nil
}

func routeID(r *http.Request, key string) int64 {
	id, _ := strconv.ParseInt(r.PathValue(key), 10, 64)
	return id
}
