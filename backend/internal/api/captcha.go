package api

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"net/http"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	captchaTTL             = 2 * time.Minute
	captchaKeyPrefix       = "pargar:captcha:"
	captchaRateLimit int64 = 60
	captchaCharset         = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	captchaMinLen          = 4
	captchaMaxLen          = 5
	captchaImgW            = 160
	captchaImgH            = 52
)

var (
	errCaptchaUnavailable = errors.New("captcha unavailable")
	errCaptchaRequired    = errors.New("captcha required")
	errCaptchaInvalid     = errors.New("captcha invalid")

	// 5×7 bitmap glyphs for A–Z and 0–9 (row-major, MSB = left).
	captchaGlyphs = map[byte][7]byte{
		'A': {0x0E, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11},
		'B': {0x1E, 0x11, 0x11, 0x1E, 0x11, 0x11, 0x1E},
		'C': {0x0E, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0E},
		'D': {0x1E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1E},
		'E': {0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x1F},
		'F': {0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x10},
		'G': {0x0E, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0E},
		'H': {0x11, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11},
		'J': {0x01, 0x01, 0x01, 0x01, 0x11, 0x11, 0x0E},
		'K': {0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11},
		'L': {0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1F},
		'M': {0x11, 0x1B, 0x15, 0x15, 0x11, 0x11, 0x11},
		'N': {0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11},
		'P': {0x1E, 0x11, 0x11, 0x1E, 0x10, 0x10, 0x10},
		'Q': {0x0E, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0D},
		'R': {0x1E, 0x11, 0x11, 0x1E, 0x14, 0x12, 0x11},
		'S': {0x0E, 0x11, 0x10, 0x0E, 0x01, 0x11, 0x0E},
		'T': {0x1F, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04},
		'U': {0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E},
		'V': {0x11, 0x11, 0x11, 0x11, 0x11, 0x0A, 0x04},
		'W': {0x11, 0x11, 0x11, 0x15, 0x15, 0x1B, 0x11},
		'X': {0x11, 0x11, 0x0A, 0x04, 0x0A, 0x11, 0x11},
		'Y': {0x11, 0x11, 0x0A, 0x04, 0x04, 0x04, 0x04},
		'Z': {0x1F, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1F},
		'2': {0x0E, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1F},
		'3': {0x0E, 0x11, 0x01, 0x06, 0x01, 0x11, 0x0E},
		'4': {0x02, 0x06, 0x0A, 0x12, 0x1F, 0x02, 0x02},
		'5': {0x1F, 0x10, 0x1E, 0x01, 0x01, 0x11, 0x0E},
		'6': {0x06, 0x08, 0x10, 0x1E, 0x11, 0x11, 0x0E},
		'7': {0x1F, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08},
		'8': {0x0E, 0x11, 0x11, 0x0E, 0x11, 0x11, 0x0E},
		'9': {0x0E, 0x11, 0x11, 0x0F, 0x01, 0x02, 0x0C},
	}
)

func captchaAnswerHash(answer string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(strings.ToUpper(answer))))
	return hex.EncodeToString(sum[:])
}

func randBounded(maxExclusive int) (int, error) {
	if maxExclusive <= 0 {
		return 0, fmt.Errorf("invalid bound")
	}
	var buf [8]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return 0, err
	}
	return int(binary.BigEndian.Uint64(buf[:]) % uint64(maxExclusive)), nil
}

func randomCaptchaText() (string, error) {
	n := captchaMinLen
	extra, err := randBounded(captchaMaxLen - captchaMinLen + 1)
	if err != nil {
		return "", err
	}
	n += extra
	out := make([]byte, n)
	for i := range out {
		idx, err := randBounded(len(captchaCharset))
		if err != nil {
			return "", err
		}
		out[i] = captchaCharset[idx]
	}
	return string(out), nil
}

func renderCaptchaPNG(text string) ([]byte, error) {
	img := image.NewRGBA(image.Rect(0, 0, captchaImgW, captchaImgH))
	bg := color.RGBA{R: 248, G: 250, B: 252, A: 255}
	draw.Draw(img, img.Bounds(), &image.Uniform{C: bg}, image.Point{}, draw.Src)

	// Light speckled noise.
	for i := 0; i < 180; i++ {
		x, err := randBounded(captchaImgW)
		if err != nil {
			return nil, err
		}
		y, err := randBounded(captchaImgH)
		if err != nil {
			return nil, err
		}
		shade, err := randBounded(80)
		if err != nil {
			return nil, err
		}
		c := uint8(160 + shade)
		img.Set(x, y, color.RGBA{R: c, G: c, B: c, A: 255})
	}

	// A few interference lines.
	ink := color.RGBA{R: 30, G: 41, B: 59, A: 255}
	for i := 0; i < 3; i++ {
		x0, err := randBounded(captchaImgW)
		if err != nil {
			return nil, err
		}
		y0, err := randBounded(captchaImgH)
		if err != nil {
			return nil, err
		}
		x1, err := randBounded(captchaImgW)
		if err != nil {
			return nil, err
		}
		y1, err := randBounded(captchaImgH)
		if err != nil {
			return nil, err
		}
		drawLine(img, x0, y0, x1, y1, color.RGBA{R: 148, G: 163, B: 184, A: 180})
	}

	scale := 3
	glyphW := 5 * scale
	gap := 4
	totalW := len(text)*glyphW + (len(text)-1)*gap
	startX := (captchaImgW - totalW) / 2
	if startX < 4 {
		startX = 4
	}
	baseY := (captchaImgH - 7*scale) / 2

	for i := 0; i < len(text); i++ {
		ch := text[i]
		glyph, ok := captchaGlyphs[ch]
		if !ok {
			continue
		}
		jitter, err := randBounded(5)
		if err != nil {
			return nil, err
		}
		ox := startX + i*(glyphW+gap)
		oy := baseY + jitter - 2
		drawGlyph(img, ox, oy, glyph, scale, ink)
	}

	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func drawGlyph(img *image.RGBA, ox, oy int, glyph [7]byte, scale int, c color.RGBA) {
	for row := 0; row < 7; row++ {
		bits := glyph[row]
		for col := 0; col < 5; col++ {
			if bits&(1<<uint(4-col)) == 0 {
				continue
			}
			for dy := 0; dy < scale; dy++ {
				for dx := 0; dx < scale; dx++ {
					x := ox + col*scale + dx
					y := oy + row*scale + dy
					if x >= 0 && y >= 0 && x < img.Bounds().Dx() && y < img.Bounds().Dy() {
						img.Set(x, y, c)
					}
				}
			}
		}
	}
}

func drawLine(img *image.RGBA, x0, y0, x1, y1 int, c color.RGBA) {
	dx := x1 - x0
	if dx < 0 {
		dx = -dx
	}
	dy := y1 - y0
	if dy < 0 {
		dy = -dy
	}
	sx, sy := 1, 1
	if x0 > x1 {
		sx = -1
	}
	if y0 > y1 {
		sy = -1
	}
	err := dx - dy
	for {
		if x0 >= 0 && y0 >= 0 && x0 < img.Bounds().Dx() && y0 < img.Bounds().Dy() {
			img.Set(x0, y0, c)
		}
		if x0 == x1 && y0 == y1 {
			break
		}
		e2 := 2 * err
		if e2 > -dy {
			err -= dy
			x0 += sx
		}
		if e2 < dx {
			err += dx
			y0 += sy
		}
	}
}

func captchaImageBase64(text string) (string, error) {
	pngBytes, err := renderCaptchaPNG(text)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(pngBytes), nil
}

func (s *Server) handleCaptcha(w http.ResponseWriter, r *http.Request) {
	if s.redis == nil {
		if s.cfg.DevMode {
			img, err := captchaImageBase64("A2B3")
			if err != nil {
				writeErr(w, http.StatusInternalServerError, "صدور کد امنیتی ممکن نشد")
				return
			}
			resp := map[string]any{
				"challengeId": "dev",
				"imageBase64": img,
				"expiresIn":   int(captchaTTL.Seconds()),
			}
			if s.cfg.CaptchaExposeAnswer {
				resp["answer"] = "A2B3"
			}
			writeJSON(w, http.StatusOK, resp)
			return
		}
		writeErr(w, http.StatusServiceUnavailable, "سرویس کد امنیتی در دسترس نیست")
		return
	}

	text, err := randomCaptchaText()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "صدور کد امنیتی ممکن نشد")
		return
	}
	img, err := captchaImageBase64(text)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "صدور کد امنیتی ممکن نشد")
		return
	}

	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		writeErr(w, http.StatusInternalServerError, "صدور کد امنیتی ممکن نشد")
		return
	}
	id := hex.EncodeToString(raw)
	key := captchaKeyPrefix + id
	if err := s.redis.Set(r.Context(), key, captchaAnswerHash(text), captchaTTL).Err(); err != nil {
		writeErr(w, http.StatusServiceUnavailable, "سرویس کد امنیتی در دسترس نیست")
		return
	}

	resp := map[string]any{
		"challengeId": id,
		"imageBase64": img,
		"expiresIn":   int(captchaTTL.Seconds()),
	}
	// Never expose plaintext answers in production. Local tests may opt in via
	// CAPTCHA_EXPOSE_ANSWER=true combined with DEV_MODE=true.
	if s.cfg.DevMode && s.cfg.CaptchaExposeAnswer {
		resp["answer"] = text
	}
	writeJSON(w, http.StatusOK, resp)
}

// consumeCaptcha verifies and one-time-deletes a challenge. On any failure the
// challenge is consumed (or already gone) so the client must fetch a new one.
func (s *Server) consumeCaptcha(ctx context.Context, challengeID, answer string) error {
	challengeID = strings.TrimSpace(challengeID)
	answer = strings.TrimSpace(answer)
	if challengeID == "" || answer == "" {
		return errCaptchaRequired
	}

	if s.redis == nil {
		if s.cfg.DevMode && challengeID == "dev" && strings.EqualFold(answer, "A2B3") {
			return nil
		}
		return errCaptchaUnavailable
	}

	key := captchaKeyPrefix + challengeID
	stored, err := s.redis.GetDel(ctx, key).Result()
	if err == redis.Nil {
		return errCaptchaInvalid
	}
	if err != nil {
		return errCaptchaUnavailable
	}
	if stored != captchaAnswerHash(answer) {
		return errCaptchaInvalid
	}
	return nil
}

func captchaErrorMessage(err error) (int, string) {
	switch {
	case errors.Is(err, errCaptchaRequired):
		return http.StatusBadRequest, "کد امنیتی الزامی است"
	case errors.Is(err, errCaptchaInvalid):
		return http.StatusBadRequest, "پاسخ کد امنیتی نادرست یا منقضی است"
	case errors.Is(err, errCaptchaUnavailable):
		return http.StatusServiceUnavailable, "سرویس کد امنیتی در دسترس نیست"
	default:
		return http.StatusBadRequest, "پاسخ کد امنیتی نادرست یا منقضی است"
	}
}
