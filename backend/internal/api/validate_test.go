package api

import (
	"strings"
	"testing"
)

func TestValidUsername(t *testing.T) {
	ok := []string{"abc", "user_1", "ahp.dev", "a-b-c", "z" + strings.Repeat("x", 31)}
	for _, u := range ok {
		if !validUsername(u) {
			t.Fatalf("expected valid: %q", u)
		}
	}
	bad := []string{
		"", "ab", "1abc", "_user", ".dot", "-dash",
		"کاربر", "user name", "user@x", "emoji😀",
		strings.Repeat("a", 33), "User",
	}
	for _, u := range bad {
		if validUsername(u) {
			t.Fatalf("expected invalid: %q", u)
		}
	}
	if !validUsername(strings.ToLower("UserName")) {
		t.Fatal("lowercased username should be valid")
	}
}

func TestNormalizeAndValidPhone(t *testing.T) {
	cases := []struct {
		in, want string
		ok       bool
	}{
		{"09121234567", "09121234567", true},
		{"۰۹۱۲۱۲۳۴۵۶۷", "09121234567", true},
		{"+989121234567", "09121234567", true},
		{"989121234567", "09121234567", true},
		{"9121234567", "09121234567", true},
		{"", "", true},
		{"12345", "12345", false},
		{"0912123456", "0912123456", false},
		{"091212345678", "091212345678", false},
		{"08121234567", "08121234567", false},
	}
	for _, c := range cases {
		got := normalizePhone(c.in)
		if got != c.want {
			t.Fatalf("normalize(%q)=%q want %q", c.in, got, c.want)
		}
		if validPhone(got) != c.ok {
			t.Fatalf("validPhone(%q)=%v want %v", got, validPhone(got), c.ok)
		}
	}
}

func TestValidEmail(t *testing.T) {
	if !validEmail("a@b.co") {
		t.Fatal("expected valid email")
	}
	if validEmail("not-an-email") || validEmail("a@b") || validEmail("a @b.co") {
		t.Fatal("expected invalid emails")
	}
}

func TestValidateStudentRegistrationFields(t *testing.T) {
	msg := validateStudentRegistrationFields(
		"هنرجو", "ok@test.dev", "gooduser", "09121110000",
		"password123", "password123", "رنگ مورد علاقه؟", "آبی",
	)
	if msg != "" {
		t.Fatalf("expected ok, got %q", msg)
	}
	msg = validateStudentRegistrationFields(
		"هنرجو", "ok@test.dev", "کاربر", "09121110000",
		"password123", "password123", "رنگ؟", "آبی",
	)
	if msg != msgUsernameInvalid {
		t.Fatalf("persian username: got %q", msg)
	}
	msg = validateStudentRegistrationFields(
		"هنرجو", "ok@test.dev", "gooduser", "09121110000",
		"password123", "different", "رنگ؟", "آبی",
	)
	if msg != msgPasswordMismatch {
		t.Fatalf("mismatch: got %q", msg)
	}
}
