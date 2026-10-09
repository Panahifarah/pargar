package api

import (
	"errors"
	"net/http"

	"pargar/backend/internal/observability"
	"pargar/backend/internal/store"
)

func (s *Server) handleLearningOverview(w http.ResponseWriter, r *http.Request) {
	ctx, span := observability.StartSpan(r.Context(), "admin.learning.overview")
	defer span.End()
	o, err := s.store.LearningOverview(ctx)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "بارگذاری نمای یادگیری ممکن نشد")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"overview": o})
}

func (s *Server) handleLearningStudents(w http.ResponseWriter, r *http.Request) {
	ctx, span := observability.StartSpan(r.Context(), "admin.learning.students")
	defer span.End()
	q := r.URL.Query().Get("q")
	filter := r.URL.Query().Get("filter")
	switch filter {
	case "active", "locked":
	default:
		filter = ""
	}
	sort := r.URL.Query().Get("sort")
	switch sort {
	case "progress", "streak", "activity":
	default:
		sort = "xp"
	}
	p := parsePageParams(r)
	rows, total, err := s.store.ListStudentLearning(ctx, q, filter, sort, p.PageSize, p.Offset)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "بارگذاری فهرست هنرجویان ممکن نشد")
		return
	}
	writePage(w, rows, total, p)
}

func (s *Server) handleUserLearning(w http.ResponseWriter, r *http.Request) {
	ctx, span := observability.StartSpan(r.Context(), "admin.learning.user")
	defer span.End()
	id := routeID(r, "id")
	detail, err := s.store.UserLearningDetail(ctx, id)
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "کاربر پیدا نشد")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "بارگذاری جزئیات یادگیری ممکن نشد")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"learning": detail})
}
