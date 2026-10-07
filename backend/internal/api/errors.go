package api

import (
	"net/http"

	"pargar/backend/internal/observability"
)

// Stable machine-readable error codes for clients.
const (
	CodeBadRequest      = "bad_request"
	CodeUnauthorized    = "unauthorized"
	CodeForbidden       = "forbidden"
	CodeNotFound        = "not_found"
	CodeConflict        = "conflict"
	CodeLocked          = "account_locked"
	CodePayloadTooLarge = "payload_too_large"
	CodeRateLimited     = "rate_limited"
	CodeValidation      = "validation_error"
	CodeInternal        = "internal_error"
)

type apiError struct {
	Error     string `json:"error"`
	Code      string `json:"code,omitempty"`
	RequestID string `json:"requestId,omitempty"`
}

func requestIDFromWriter(w http.ResponseWriter) string {
	if w == nil {
		return ""
	}
	return w.Header().Get("X-Request-ID")
}

func defaultCodeForStatus(status int) string {
	switch status {
	case http.StatusBadRequest:
		return CodeBadRequest
	case http.StatusUnauthorized:
		return CodeUnauthorized
	case http.StatusForbidden:
		return CodeForbidden
	case http.StatusNotFound:
		return CodeNotFound
	case http.StatusConflict:
		return CodeConflict
	case http.StatusLocked:
		return CodeLocked
	case http.StatusRequestEntityTooLarge:
		return CodePayloadTooLarge
	case http.StatusTooManyRequests:
		return CodeRateLimited
	case http.StatusInternalServerError, http.StatusBadGateway, http.StatusServiceUnavailable:
		return CodeInternal
	default:
		if status >= 500 {
			return CodeInternal
		}
		if status >= 400 {
			return CodeBadRequest
		}
		return ""
	}
}

// writeErr responds with a Persian user message and a stable code derived from status.
func writeErr(w http.ResponseWriter, status int, msg string) {
	writeErrCode(w, status, defaultCodeForStatus(status), msg)
}

// writeErrCode responds with an explicit machine-readable code.
func writeErrCode(w http.ResponseWriter, status int, code, msg string) {
	if code == "" {
		code = defaultCodeForStatus(status)
	}
	if msg == "" {
		msg = "خطایی رخ داد؛ دوباره تلاش کنید"
	}
	writeJSON(w, status, apiError{
		Error:     msg,
		Code:      code,
		RequestID: requestIDFromWriter(w),
	})
}

// writeInternalErr logs the real error server-side and returns a safe 500 to the client.
func writeInternalErr(w http.ResponseWriter, op string, err error, userMsg string) {
	if userMsg == "" {
		userMsg = "مشکل موقتی سرور؛ کمی بعد دوباره تلاش کنید."
	}
	attrs := []any{"op", op, "request_id", requestIDFromWriter(w)}
	if err != nil {
		attrs = append(attrs, "error", err)
	}
	observability.L().Error("api.error", attrs...)
	writeErrCode(w, http.StatusInternalServerError, CodeInternal, userMsg)
}

// writeValidationErr is a 400 with validation_error code.
func writeValidationErr(w http.ResponseWriter, msg string) {
	writeErrCode(w, http.StatusBadRequest, CodeValidation, msg)
}
