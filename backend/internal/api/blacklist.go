package api

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"pargar/backend/internal/observability"
	"pargar/backend/internal/store"
)

type importBlacklistRequest struct {
	Phones           []string `json:"phones"`
	Text             string   `json:"text"`
	ResolveConflicts bool     `json:"resolveConflicts"`
	Force            bool     `json:"force"`
}

func (s *Server) handleAdminImportBlacklist(w http.ResponseWriter, r *http.Request) {
	var req importBlacklistRequest
	if err := bodyJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "دادهٔ ارسالی نامعتبر است")
		return
	}
	phones, invalid := parseWhitelistPhones(importWhitelistRequest{
		Phones: req.Phones,
		Text:   req.Text,
	})
	if len(phones) == 0 {
		writeErr(w, http.StatusBadRequest, "هیچ شمارهٔ معتبری ارسال نشده است")
		return
	}
	if len(phones) > 5000 {
		writeErr(w, http.StatusBadRequest, "حداکثر ۵۰۰۰ شماره در هر واردات مجاز است")
		return
	}
	admin := currentUser(r)
	resolve := req.ResolveConflicts || req.Force
	result, err := s.store.ImportBlacklistPhones(r.Context(), phones, admin.ID, resolve)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "واردات فهرست سیاه ممکن نشد")
		return
	}
	wlConflicts := result.WhitelistedConflicts
	if wlConflicts == nil {
		wlConflicts = []string{}
	}
	rejectedPhones := result.RejectedPhones
	if rejectedPhones == nil {
		rejectedPhones = []string{}
	}
	observability.Activity("admin.blacklist_import",
		"inserted", result.Inserted, "skipped", result.Skipped,
		"removed_whitelist", result.RemovedWhitelist, "rejected", result.Rejected,
		"whitelisted_conflicts", len(wlConflicts),
		"invalid", invalid, "resolve", resolve, "admin_id", admin.ID)
	writeJSON(w, http.StatusOK, map[string]any{
		"inserted":             result.Inserted,
		"skipped":              result.Skipped,
		"removedWhitelist":     result.RemovedWhitelist,
		"rejected":             result.Rejected,
		"rejectedPhones":       rejectedPhones,
		"whitelistedConflicts": wlConflicts,
		"invalid":              invalid,
		"total":                len(phones),
	})
}

func (s *Server) handleAdminListBlacklist(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if digits := normalizePhone(q); digits != "" {
		q = digits
	}
	p := parsePageParams(r)
	entries, total, err := s.store.ListBlacklistPhones(r.Context(), q, p.PageSize, p.Offset)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "بارگذاری فهرست سیاه ممکن نشد")
		return
	}
	writePage(w, entries, total, p)
}

func (s *Server) handleAdminDeleteBlacklist(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id < 1 {
		writeErr(w, http.StatusBadRequest, "شناسه نامعتبر است")
		return
	}
	if err := s.store.DeleteBlacklistPhone(r.Context(), id); err != nil {
		if errors.Is(err, store.ErrBlacklistNotFound) {
			writeErr(w, http.StatusNotFound, "شماره در فهرست سیاه یافت نشد")
			return
		}
		writeErr(w, http.StatusInternalServerError, "حذف شماره ممکن نشد")
		return
	}
	observability.Activity("admin.blacklist_delete", "id", id, "admin_id", currentUser(r).ID)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleAdminListBlacklistAttempts(w http.ResponseWriter, r *http.Request) {
	p := parsePageParams(r)
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		// Legacy alias; prefer q going forward.
		q = strings.TrimSpace(r.URL.Query().Get("phone"))
		if digits := normalizePhone(q); digits != "" {
			q = digits
		}
	}
	entries, total, err := s.store.ListBlacklistAttempts(r.Context(), q, p.PageSize, p.Offset)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "بارگذاری تاریخچه تلاش ممکن نشد")
		return
	}
	writePage(w, entries, total, p)
}

// rejectIfBlacklisted returns true if the response was already written.
// When blocked, an audit row is recorded (best-effort) before rejecting.
func (s *Server) rejectIfBlacklisted(
	w http.ResponseWriter,
	r *http.Request,
	phone string,
	path string,
	inviteID *int64,
	username string,
	email string,
) bool {
	blocked, err := s.store.IsPhoneBlacklisted(r.Context(), phone)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "بررسی فهرست سیاه ممکن نشد")
		return true
	}
	if !blocked {
		return false
	}
	ip := clientAddress(r)
	ua := strings.TrimSpace(r.UserAgent())
	if len(ua) > 500 {
		ua = ua[:500]
	}
	if _, recErr := s.store.RecordBlacklistAttempt(
		r.Context(), phone, path, inviteID, ip, ua, username, email,
	); recErr != nil {
		observability.Activity("auth.blacklist_attempt_log_failed",
			"phone", phone, "path", path, "error", recErr.Error())
	} else {
		observability.Activity("auth.blacklist_attempt",
			"phone", phone, "path", path, "remote", ip)
	}
	writeErr(w, http.StatusForbidden, "این شماره مجاز به ثبت‌نام نیست")
	return true
}
