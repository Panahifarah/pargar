package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"strconv"
	"strings"
	"time"

	"pargar/backend/internal/models"
	"pargar/backend/internal/observability"
	"pargar/backend/internal/store"
)

func newPublicID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func (s *Server) issueCertificateIfEligible(ctx context.Context, user *models.User) (*models.Certificate, bool, error) {
	ok, err := s.store.HasCompletedCurriculum(ctx, user.ID)
	if err != nil {
		return nil, false, err
	}
	if !ok {
		return nil, false, nil
	}
	if existing, err := s.store.GetCertificateByUser(ctx, user.ID); err == nil {
		if existing.RevokedAt == nil {
			return existing, false, nil
		}
	} else if err != store.ErrNotFound {
		return nil, false, err
	}
	publicID, err := newPublicID()
	if err != nil {
		return nil, false, err
	}
	cert, err := s.store.CreateCertificate(ctx, user.ID, publicID, user.Name)
	if err != nil {
		return nil, false, err
	}
	return cert, true, nil
}

func (s *Server) handleIssueCertificate(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	cert, created, err := s.issueCertificateIfEligible(r.Context(), u)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "صدور گواهینامه ممکن نشد")
		return
	}
	if cert == nil {
		writeErr(w, http.StatusConflict, "هنوز همه درس‌های فعال را پاس نکرده‌اید")
		return
	}
	if created {
		observability.Activity("certificate.issued", "user_id", u.ID, "public_id", cert.PublicID)
	}
	writeJSON(w, http.StatusOK, map[string]any{"certificate": cert, "created": created})
}

func (s *Server) handleMyCertificate(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	eligible, err := s.store.HasCompletedCurriculum(r.Context(), u.ID)
	if err != nil {
		writeInternalErr(w, "certificate.eligible", err, "بارگذاری وضعیت گواهینامه ممکن نشد")
		return
	}
	cert, err := s.store.GetCertificateByUser(r.Context(), u.ID)
	if err != nil && err != store.ErrNotFound {
		writeInternalErr(w, "certificate.mine", err, "بارگذاری گواهینامه ممکن نشد")
		return
	}
	if err == store.ErrNotFound || (cert != nil && cert.RevokedAt != nil) {
		cert = nil
	}
	order, _ := s.store.GetLatestPhysicalOrder(r.Context(), u.ID)
	writeJSON(w, http.StatusOK, map[string]any{
		"certificate":   cert,
		"eligible":      eligible,
		"physicalOrder": order,
		"physical":      s.physicalSettings(r.Context()),
	})
}

func setCertificateNoIndex(w http.ResponseWriter) {
	w.Header().Set("X-Robots-Tag", "noindex, nofollow, noarchive")
}

func (s *Server) handlePublicCertificate(w http.ResponseWriter, r *http.Request) {
	setCertificateNoIndex(w)
	publicID := r.PathValue("publicId")
	if publicID == "" {
		writeErr(w, http.StatusBadRequest, "شناسه نامعتبر است")
		return
	}
	cert, err := s.store.GetCertificateByPublicID(r.Context(), publicID)
	if err != nil || cert.RevokedAt != nil {
		writeErr(w, http.StatusNotFound, "گواهینامه پیدا نشد")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"certificate": map[string]any{
			"publicId": cert.PublicID,
			"fullName": cert.FullName,
			"issuedAt": cert.IssuedAt,
		},
		"course": "پرگار",
	})
}

func (s *Server) physicalSettings(ctx context.Context) map[string]any {
	enabled := s.cfg.PhysicalCertEnabled
	price := s.cfg.PhysicalCertPriceIRR
	days := s.cfg.PhysicalCertWindowDays
	if v, err := s.store.GetSetting(ctx, "physical_cert_enabled"); err == nil {
		enabled = v == "true" || v == "1"
	}
	if v, err := s.store.GetSetting(ctx, "physical_cert_price_irr"); err == nil {
		if n, e := strconv.Atoi(v); e == nil {
			price = n
		}
	}
	if v, err := s.store.GetSetting(ctx, "physical_cert_window_days"); err == nil {
		if n, e := strconv.Atoi(v); e == nil {
			days = n
		}
	}
	return map[string]any{
		"enabled":    enabled,
		"priceIrr":   price,
		"windowDays": days,
	}
}

func (s *Server) handleRequestPhysicalCertificate(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	settings := s.physicalSettings(r.Context())
	if enabled, _ := settings["enabled"].(bool); !enabled {
		writeErr(w, http.StatusBadRequest, "درخواست نسخه فیزیکی فعلاً فعال نیست")
		return
	}
	cert, err := s.store.GetCertificateByUser(r.Context(), u.ID)
	if err != nil || cert.RevokedAt != nil {
		writeErr(w, http.StatusConflict, "ابتدا گواهینامه دیجیتال را دریافت کنید")
		return
	}
	days, _ := settings["windowDays"].(int)
	if days <= 0 {
		days = 30
	}
	windowEnds := cert.IssuedAt.Add(time.Duration(days) * 24 * time.Hour)
	if time.Now().After(windowEnds) {
		writeErr(w, http.StatusConflict, "مهلت درخواست نسخه فیزیکی به پایان رسیده است")
		return
	}
	if existing, err := s.store.GetLatestPhysicalOrder(r.Context(), u.ID); err == nil {
		if existing.Status != models.PhysicalCancelled {
			writeErr(w, http.StatusConflict, "سفارش فیزیکی فعال دارید")
			return
		}
	}
	var req struct {
		RecipientName string `json:"recipientName"`
		Phone         string `json:"phone"`
		Address       string `json:"address"`
		City          string `json:"city"`
		PostalCode    string `json:"postalCode"`
	}
	if err := bodyJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "دادهٔ ارسالی نامعتبر است")
		return
	}
	ship := models.CertificatePhysicalOrder{
		RecipientName: strings.TrimSpace(req.RecipientName),
		Phone:         normalizePhone(req.Phone),
		Address:       strings.TrimSpace(req.Address),
		City:          strings.TrimSpace(req.City),
		PostalCode:    strings.TrimSpace(req.PostalCode),
	}
	if ship.RecipientName == "" {
		ship.RecipientName = u.Name
	}
	if ship.Phone == "" {
		ship.Phone = normalizePhone(u.Phone)
	}
	if ship.Phone == "" || !validPhone(ship.Phone) {
		writeErr(w, http.StatusBadRequest, msgPhoneInvalid)
		return
	}
	if ship.Address == "" || ship.City == "" {
		writeErr(w, http.StatusBadRequest, "آدرس و شهر برای ارسال الزامی است")
		return
	}
	if len(ship.Address) > 500 || len(ship.City) > 80 || len(ship.RecipientName) > 120 {
		writeErr(w, http.StatusBadRequest, "اطلاعات ارسال بیش از حد طولانی است")
		return
	}
	order, err := s.store.CreatePhysicalOrder(r.Context(), cert.ID, u.ID, windowEnds, ship)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "ثبت درخواست ممکن نشد")
		return
	}
	staff, _ := s.store.ListMentors(r.Context())
	go func() {
		for _, m := range staff {
			if m.Role != models.RoleAdmin {
				continue
			}
			_ = s.notify.Notify(context.Background(), m.ID, "progress", "physical_order",
				"سفارش گواهینامه فیزیکی", u.Name+" درخواست نسخه فیزیکی ثبت کرد.", "/admin",
				map[string]any{"orderId": order.ID, "userId": u.ID})
		}
	}()
	observability.Activity("certificate.physical_requested", "user_id", u.ID, "order_id", order.ID)
	writeJSON(w, http.StatusCreated, map[string]any{
		"order":    order,
		"message":  "پس از واریز با ادمین هماهنگ کنید",
		"physical": settings,
	})
}

func (s *Server) handleAdminListPhysicalOrders(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
	p := parsePageParams(r)
	orders, total, err := s.store.ListPhysicalOrders(r.Context(), status, p.PageSize, p.Offset)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "بارگذاری سفارش‌ها ممکن نشد")
		return
	}
	if orders == nil {
		orders = []models.CertificatePhysicalOrder{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"orders":   orders,
		"total":    total,
		"page":     p.Page,
		"pageSize": p.PageSize,
		"physical": s.physicalSettings(r.Context()),
	})
}

func (s *Server) handleAdminUpdatePhysicalOrder(w http.ResponseWriter, r *http.Request) {
	id := routeID(r, "id")
	var req struct {
		Status       string `json:"status"`
		Note         string `json:"note"`
		TrackingCode string `json:"trackingCode"`
	}
	if err := bodyJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "دادهٔ ارسالی نامعتبر است")
		return
	}
	var st models.PhysicalOrderStatus
	switch req.Status {
	case "requested", "paid", "shipped", "cancelled":
		st = models.PhysicalOrderStatus(req.Status)
	default:
		writeErr(w, http.StatusBadRequest, "وضعیت نامعتبر است")
		return
	}
	order, err := s.store.UpdatePhysicalOrder(r.Context(), id, st, req.Note, strings.TrimSpace(req.TrackingCode))
	if err != nil {
		writeErr(w, http.StatusNotFound, "سفارش پیدا نشد")
		return
	}
	title, body, route := physicalStatusCopy(st, order.TrackingCode)
	go func() {
		_ = s.notify.Notify(context.Background(), order.UserID, "progress", "physical_order_"+string(st),
			title, body, route, map[string]any{"orderId": order.ID, "status": string(st)})
	}()
	observability.Activity("certificate.physical_updated", "order_id", id, "status", string(st), "actor_id", currentUser(r).ID)
	writeJSON(w, http.StatusOK, map[string]any{"order": order})
}

func physicalStatusCopy(st models.PhysicalOrderStatus, tracking string) (title, body, route string) {
	route = "/notifications"
	switch st {
	case models.PhysicalPaid:
		return "پرداخت گواهینامه تأیید شد", "وضعیت سفارش فیزیکی به «پرداخت‌شده» تغییر کرد.", route
	case models.PhysicalShipped:
		msg := "گواهینامه فیزیکی ارسال شد."
		if tracking != "" {
			msg += " کد پیگیری: " + tracking
		}
		return "گواهینامه ارسال شد", msg, route
	case models.PhysicalCancelled:
		return "سفارش فیزیکی لغو شد", "سفارش نسخه فیزیکی شما لغو شد. در صورت نیاز دوباره درخواست دهید.", route
	default:
		return "به‌روزرسانی سفارش فیزیکی", "وضعیت سفارش گواهینامه فیزیکی تغییر کرد.", route
	}
}
