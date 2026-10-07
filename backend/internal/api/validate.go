package api

import (
	"net/mail"
	"strings"
	"unicode"
	"unicode/utf8"
)

const (
	minUsernameLen = 3
	maxUsernameLen = 32
	maxNameLen     = 100
	minPasswordLen = 8
	maxPasswordLen = 72 // bcrypt limit
	minSecQLen     = 3
	maxSecQLen     = 200
	minSecALen     = 2
	maxSecALen     = 100
	maxInviteLabel = 80
	maxEmailLen    = 200
)

// Persian validation messages — keep in sync with frontend/src/lib/validation.ts
const (
	msgNameRequired     = "نام الزامی است"
	msgNameTooLong      = "نام خیلی طولانی است"
	msgEmailInvalid     = "ایمیل نامعتبر است"
	msgUsernameInvalid  = "شناسه باید با حرف انگلیسی شروع شود و ۳ تا ۳۲ نویسهٔ لاتین، عدد، نقطه، خط یا زیرخط باشد"
	msgPasswordShort    = "گذرواژه باید دست‌کم ۸ نویسه داشته باشد"
	msgPasswordLong     = "گذرواژه بیش از حد طولانی است"
	msgPasswordMismatch = "گذرواژه و تکرار آن یکسان نیستند"
	msgPhoneRequired    = "شماره تلفن الزامی است"
	msgPhoneInvalid     = "شماره تلفن نامعتبر است (مثال: ۰۹۱۲۱۲۳۴۵۶۷)"
	msgSecQARequired    = "سوال و جواب امنیتی الزامی است"
	msgSecQShort        = "سوال امنیتی خیلی کوتاه است"
	msgSecQLong         = "سوال امنیتی خیلی طولانی است"
	msgSecAShort        = "جواب امنیتی خیلی کوتاه است"
	msgSecALong         = "جواب امنیتی خیلی طولانی است"
	msgInviteLabelLong  = "برچسب لینک عضویت خیلی طولانی است"
)

func validEmail(email string) bool {
	n := utf8.RuneCountInString(email)
	if n < 5 || n > maxEmailLen {
		return false
	}
	if strings.ContainsAny(email, " \t\r\n") {
		return false
	}
	addr, err := mail.ParseAddress(email)
	if err != nil {
		return false
	}
	// Reject display-name forms like "Name <a@b.c>".
	if addr.Address != email {
		return false
	}
	at := strings.LastIndex(email, "@")
	if at < 1 || at == len(email)-1 {
		return false
	}
	domain := email[at+1:]
	return strings.Contains(domain, ".")
}

// validUsername: ASCII letter first, then letters/digits/._- ; length 3–32.
// Expects already lowercased + trimmed input.
func validUsername(username string) bool {
	n := len(username)
	if n < minUsernameLen || n > maxUsernameLen {
		return false
	}
	first := username[0]
	if first < 'a' || first > 'z' {
		return false
	}
	for i := 1; i < n; i++ {
		c := username[i]
		switch {
		case c >= 'a' && c <= 'z', c >= '0' && c <= '9', c == '_' || c == '.' || c == '-':
			continue
		default:
			return false
		}
	}
	return true
}

// normalizePhone keeps digits (maps Persian/Arabic digits) and canonicalizes
// Iranian mobiles to 09XXXXXXXXX (from +98… / 98… / 9…).
func normalizePhone(raw string) string {
	var b strings.Builder
	for _, r := range strings.TrimSpace(raw) {
		switch {
		case r >= '۰' && r <= '۹':
			b.WriteByte(byte('0' + (r - '۰')))
		case r >= '٠' && r <= '٩':
			b.WriteByte(byte('0' + (r - '٠')))
		case r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == '+' && b.Len() == 0:
			// skip; country code handled below from digits
		}
	}
	s := b.String()
	switch {
	case len(s) == 12 && strings.HasPrefix(s, "989"):
		return "0" + s[2:]
	case len(s) == 10 && s[0] == '9':
		return "0" + s
	default:
		return s
	}
}

// validPhone accepts empty (optional admin fields) or Iranian mobile 09XXXXXXXXX.
func validPhone(phone string) bool {
	if phone == "" {
		return true
	}
	if len(phone) != 11 || !strings.HasPrefix(phone, "09") {
		return false
	}
	for _, r := range phone {
		if r < '0' || r > '9' {
			return false
		}
	}
	// Second digit after 0 must be 9 (already in prefix); third is operator 0–9.
	return true
}

func validatePersonName(name string) string {
	if name == "" {
		return msgNameRequired
	}
	if utf8.RuneCountInString(name) > maxNameLen {
		return msgNameTooLong
	}
	// Reject names that are only whitespace/control (trim already applied).
	for _, r := range name {
		if !unicode.IsSpace(r) && !unicode.IsControl(r) {
			return ""
		}
	}
	return msgNameRequired
}

func validateRegisterPassword(password, confirm string) string {
	if len(password) < minPasswordLen {
		return msgPasswordShort
	}
	if len(password) > maxPasswordLen {
		return msgPasswordLong
	}
	if password != confirm {
		return msgPasswordMismatch
	}
	return ""
}

func validatePasswordOnly(password string) string {
	if len(password) < minPasswordLen {
		return msgPasswordShort
	}
	if len(password) > maxPasswordLen {
		return msgPasswordLong
	}
	return ""
}

func validateSecurityQA(question, answer string) string {
	if question == "" || answer == "" {
		return msgSecQARequired
	}
	qn := utf8.RuneCountInString(question)
	an := utf8.RuneCountInString(answer)
	if qn < minSecQLen {
		return msgSecQShort
	}
	if qn > maxSecQLen {
		return msgSecQLong
	}
	if an < minSecALen {
		return msgSecAShort
	}
	if an > maxSecALen {
		return msgSecALong
	}
	return ""
}

func validateInviteLabel(label string) string {
	if utf8.RuneCountInString(label) > maxInviteLabel {
		return msgInviteLabelLong
	}
	return ""
}

// validateStudentRegistrationFields validates public/invite registration payloads.
// Phone is always required. Returns the first Persian error message, or "".
func validateStudentRegistrationFields(
	name, email, username, phone, password, passwordConfirm, secQ, secA string,
) string {
	if msg := validatePersonName(name); msg != "" {
		return msg
	}
	if !validEmail(email) {
		return msgEmailInvalid
	}
	if !validUsername(username) {
		return msgUsernameInvalid
	}
	if msg := validateRegisterPassword(password, passwordConfirm); msg != "" {
		return msg
	}
	if phone == "" {
		return msgPhoneRequired
	}
	if !validPhone(phone) {
		return msgPhoneInvalid
	}
	if msg := validateSecurityQA(secQ, secA); msg != "" {
		return msg
	}
	return ""
}
