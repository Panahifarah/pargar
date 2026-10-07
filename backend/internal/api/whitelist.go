package api

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"pargar/backend/internal/observability"
	"pargar/backend/internal/store"
)

type importWhitelistRequest struct {
	Phones           []string `json:"phones"`
	Text             string   `json:"text"`
	ResolveConflicts bool     `json:"resolveConflicts"`
	Force            bool     `json:"force"`
}

func parseWhitelistPhones(req importWhitelistRequest) (valid []string, invalid int) {
	seen := make(map[string]struct{})
	add := func(raw string) {
		phone := normalizePhone(raw)
		if phone == "" {
			return
		}
		if !validPhone(phone) {
			invalid++
			return
		}
		if _, ok := seen[phone]; ok {
			return
		}
		seen[phone] = struct{}{}
		valid = append(valid, phone)
	}
	for _, p := range req.Phones {
		add(p)
	}
	if req.Text != "" {
		for _, line := range strings.FieldsFunc(req.Text, func(r rune) bool {
			return r == '\n' || r == '\r' || r == ',' || r == ';' || r == '\t'
		}) {
			add(strings.TrimSpace(line))
		}
	}
	return valid, invalid
}

func (s *Server) handleAdminImportWhitelist(w http.ResponseWriter, r *http.Request) {
	var req importWhitelistRequest
	if err := bodyJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "دادهٔ ارسالی نامعتبر است")
		return
	}
	phones, invalid := parseWhitelistPhones(req)
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
	result, err := s.store.ImportWhitelistPhones(r.Context(), phones, admin.ID, resolve)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "واردات فهرست شماره‌ها ممکن نشد")
		return
	}
	conflicts := result.BlacklistedConflicts
	if conflicts == nil {
		conflicts = []string{}
	}
	rejectedPhones := result.RejectedPhones
	if rejectedPhones == nil {
		rejectedPhones = []string{}
	}
	observability.Activity("admin.whitelist_import",
		"inserted", result.Inserted, "skipped", result.Skipped,
		"rejected", result.Rejected,
		"blacklisted_conflicts", len(conflicts), "removed_blacklist", result.RemovedBlacklist,
		"invalid", invalid, "resolve", resolve, "admin_id", admin.ID)
	writeJSON(w, http.StatusOK, map[string]any{
		"inserted":             result.Inserted,
		"skipped":              result.Skipped,
		"rejected":             result.Rejected,
		"rejectedPhones":       rejectedPhones,
		"invalid":              invalid,
		"total":                len(phones),
		"blacklistedConflicts": conflicts,
		"removedBlacklist":     result.RemovedBlacklist,
	})
}

func (s *Server) handleAdminListWhitelist(w http.ResponseWriter, r *http.Request) {
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if digits := normalizePhone(q); digits != "" {
		q = digits
	}
	p := parsePageParams(r)
	entries, total, err := s.store.ListWhitelistPhones(r.Context(), status, q, p.PageSize, p.Offset)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "بارگذاری فهرست شماره‌ها ممکن نشد")
		return
	}
	writePage(w, entries, total, p)
}

func (s *Server) handleAdminDeleteWhitelist(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id < 1 {
		writeErr(w, http.StatusBadRequest, "شناسه نامعتبر است")
		return
	}
	if err := s.store.DeleteAvailableWhitelistPhone(r.Context(), id); err != nil {
		if errors.Is(err, store.ErrWhitelistNotFound) {
			writeErr(w, http.StatusNotFound, "شماره در فهرست یافت نشد")
			return
		}
		if errors.Is(err, store.ErrWhitelistNotAvailable) {
			writeErr(w, http.StatusConflict, "فقط شماره‌های استفاده‌نشده قابل حذف هستند")
			return
		}
		writeErr(w, http.StatusInternalServerError, "حذف شماره ممکن نشد")
		return
	}
	observability.Activity("admin.whitelist_delete", "id", id, "admin_id", currentUser(r).ID)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
