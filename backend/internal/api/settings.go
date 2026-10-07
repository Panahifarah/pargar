package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"pargar/backend/internal/observability"
)

func (s *Server) handleGetSponsors(w http.ResponseWriter, r *http.Request) {
	sponsors := s.loadSponsors(r.Context())
	writeJSON(w, http.StatusOK, map[string]any{"sponsors": sponsors})
}

func (s *Server) loadSponsors(ctx context.Context) []map[string]string {
	raw, err := s.store.GetSetting(ctx, "sponsors")
	if err != nil || strings.TrimSpace(raw) == "" {
		return []map[string]string{}
	}
	var list []map[string]string
	if err := json.Unmarshal([]byte(raw), &list); err != nil {
		return []map[string]string{}
	}
	out := make([]map[string]string, 0, len(list))
	for _, item := range list {
		name := strings.TrimSpace(item["name"])
		if name == "" {
			continue
		}
		out = append(out, map[string]string{
			"name":  name,
			"url":   strings.TrimSpace(item["url"]),
			"blurb": strings.TrimSpace(item["blurb"]),
			"logo":  strings.TrimSpace(item["logo"]),
		})
	}
	return out
}

func (s *Server) handleAdminGetSettings(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	keys := []string{
		"donation_enabled", "donation_note",
		"physical_cert_enabled", "physical_cert_price_irr", "physical_cert_window_days",
		"sponsors",
		"registration_enabled",
		"registration_require_whitelist",
	}
	out := map[string]string{}
	for _, k := range keys {
		if v, err := s.store.GetSetting(ctx, k); err == nil {
			out[k] = v
		} else {
			out[k] = ""
		}
	}
	if strings.TrimSpace(out["donation_note"]) == "" {
		out["donation_note"] = s.cfg.DonationNote
	}
	if strings.TrimSpace(out["donation_enabled"]) == "" {
		if s.cfg.DonationEnabled {
			out["donation_enabled"] = "true"
		} else {
			out["donation_enabled"] = "false"
		}
	}
	if strings.TrimSpace(out["physical_cert_enabled"]) == "" {
		if s.cfg.PhysicalCertEnabled {
			out["physical_cert_enabled"] = "true"
		} else {
			out["physical_cert_enabled"] = "false"
		}
	}
	if strings.TrimSpace(out["physical_cert_price_irr"]) == "" {
		out["physical_cert_price_irr"] = strconv.Itoa(s.cfg.PhysicalCertPriceIRR)
	}
	if strings.TrimSpace(out["physical_cert_window_days"]) == "" {
		out["physical_cert_window_days"] = strconv.Itoa(s.cfg.PhysicalCertWindowDays)
	}
	if strings.TrimSpace(out["registration_enabled"]) == "" {
		out["registration_enabled"] = "false"
	}
	if strings.TrimSpace(out["registration_require_whitelist"]) == "" {
		out["registration_require_whitelist"] = "true"
	}
	writeJSON(w, http.StatusOK, map[string]any{"settings": out})
}

func (s *Server) handleAdminPutSettings(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Settings map[string]string `json:"settings"`
	}
	if err := bodyJSON(r, &req); err != nil || req.Settings == nil {
		writeErr(w, http.StatusBadRequest, "دادهٔ ارسالی نامعتبر است")
		return
	}
	allowed := map[string]bool{
		"donation_enabled":               true,
		"donation_note":                  true,
		"physical_cert_enabled":          true,
		"physical_cert_price_irr":        true,
		"physical_cert_window_days":      true,
		"sponsors":                       true,
		"registration_enabled":           true,
		"registration_require_whitelist": true,
	}
	for k, v := range req.Settings {
		if !allowed[k] {
			continue
		}
		v = strings.TrimSpace(v)
		switch k {
		case "donation_enabled", "physical_cert_enabled", "registration_enabled", "registration_require_whitelist":
			if v == "1" || strings.EqualFold(v, "true") || v == "yes" {
				v = "true"
			} else {
				v = "false"
			}
		case "physical_cert_price_irr", "physical_cert_window_days":
			n, err := strconv.Atoi(v)
			if err != nil || n < 0 {
				writeErr(w, http.StatusBadRequest, "مقدار عددی نامعتبر است: "+k)
				return
			}
			if k == "physical_cert_window_days" && (n < 1 || n > 3650) {
				writeErr(w, http.StatusBadRequest, "مهلت گواهینامه باید بین ۱ تا ۳۶۵۰ روز باشد")
				return
			}
		case "sponsors":
			if v == "" {
				v = "[]"
			}
			var tmp []map[string]string
			if err := json.Unmarshal([]byte(v), &tmp); err != nil {
				writeErr(w, http.StatusBadRequest, "فرمت اسپانسرها نامعتبر است")
				return
			}
			if len(tmp) > 20 {
				writeErr(w, http.StatusBadRequest, "حداکثر ۲۰ اسپانسر مجاز است")
				return
			}
			for _, item := range tmp {
				name := strings.TrimSpace(item["name"])
				if name == "" {
					writeErr(w, http.StatusBadRequest, "نام اسپانسر الزامی است")
					return
				}
				if utf8.RuneCountInString(name) > 100 {
					writeErr(w, http.StatusBadRequest, "نام اسپانسر خیلی طولانی است")
					return
				}
				if utf8.RuneCountInString(strings.TrimSpace(item["blurb"])) > 300 {
					writeErr(w, http.StatusBadRequest, "توضیح اسپانسر خیلی طولانی است")
					return
				}
				if utf8.RuneCountInString(strings.TrimSpace(item["url"])) > 500 {
					writeErr(w, http.StatusBadRequest, "لینک اسپانسر خیلی طولانی است")
					return
				}
			}
		case "donation_note":
			if utf8.RuneCountInString(v) > 2000 {
				writeErr(w, http.StatusBadRequest, "یادداشت دونیت خیلی طولانی است")
				return
			}
		}
		if err := s.store.SetSetting(r.Context(), k, v); err != nil {
			writeErr(w, http.StatusInternalServerError, "ذخیره تنظیمات ممکن نشد")
			return
		}
	}
	observability.Activity("settings.updated", "actor_id", currentUser(r).ID)
	s.handleAdminGetSettings(w, r)
}
