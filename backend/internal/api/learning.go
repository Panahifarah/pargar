package api

import (
	"net/http"

	"pargar/backend/internal/observability"
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
	rows, err := s.store.ListStudentLearning(ctx, q)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "بارگذاری فهرست هنرجویان ممکن نشد")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"students": rows})
}

func (s *Server) handleUserLearning(w http.ResponseWriter, r *http.Request) {
	ctx, span := observability.StartSpan(r.Context(), "admin.learning.user")
	defer span.End()
	id := routeID(r, "id")
	detail, err := s.store.UserLearningDetail(ctx, id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "کاربر پیدا نشد")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"learning": detail})
}
