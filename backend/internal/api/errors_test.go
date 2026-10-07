package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWriteErrIncludesCodeAndRequestID(t *testing.T) {
	rec := httptest.NewRecorder()
	rec.Header().Set("X-Request-ID", "abc123deadbeef")
	writeErr(rec, http.StatusBadRequest, "داده نامعتبر است")

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: %d", rec.Code)
	}
	var body apiError
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Error != "داده نامعتبر است" {
		t.Fatalf("error: %q", body.Error)
	}
	if body.Code != CodeBadRequest {
		t.Fatalf("code: %q", body.Code)
	}
	if body.RequestID != "abc123deadbeef" {
		t.Fatalf("requestId: %q", body.RequestID)
	}
}

func TestWriteErrCodeLocked(t *testing.T) {
	rec := httptest.NewRecorder()
	writeErrCode(rec, http.StatusLocked, CodeLocked, "حساب محدود شده است")
	var body apiError
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Code != CodeLocked {
		t.Fatalf("code: %q", body.Code)
	}
}

func TestWriteInternalErrHidesCause(t *testing.T) {
	rec := httptest.NewRecorder()
	writeInternalErr(rec, "test.op", errors.New("secret db detail"), "عملیات ممکن نشد")
	var body apiError
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Code != CodeInternal {
		t.Fatalf("code: %q", body.Code)
	}
	if body.Error != "عملیات ممکن نشد" {
		t.Fatalf("error: %q", body.Error)
	}
	if strings.Contains(rec.Body.String(), "secret") {
		t.Fatalf("leaked internal detail: %s", rec.Body.String())
	}
}
