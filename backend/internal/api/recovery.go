package api

import (
	"net/http"
)

// Public self-service password recovery is disabled for students.
// Staff set a new password from the admin profile. Public recovery stays off.

func (s *Server) handleRecoveryChallenge(w http.ResponseWriter, r *http.Request) {
	writeErr(w, http.StatusNotFound, "بازیابی رمز عمومی غیرفعال است")
}

func (s *Server) handleRecoveryReset(w http.ResponseWriter, r *http.Request) {
	writeErr(w, http.StatusNotFound, "بازیابی رمز عمومی غیرفعال است")
}
