package api

import (
	"bytes"
	"fmt"
	"io"
	"mime/multipart"
	"path/filepath"
	"strings"
)

const maxAdminVideoBytes = 200 << 20 // 200 MB

type acceptedVideo struct {
	Ext  string // ".mp4" or ".webm"
	Mime string
}

// acceptAdminVideo validates extension, declared content-type, and magic bytes.
// MP4 is preferred; only MP4 and WebM are allowed.
func acceptAdminVideo(header *multipart.FileHeader, file multipart.File) (acceptedVideo, error) {
	if header == nil || file == nil {
		return acceptedVideo{}, fmt.Errorf("فایل ارسال نشده است")
	}
	if header.Size > maxAdminVideoBytes {
		return acceptedVideo{}, fmt.Errorf("حجم ویدیو باید کمتر از ۲۰۰ مگابایت باشد")
	}

	name := strings.ToLower(filepath.Base(strings.TrimSpace(header.Filename)))
	ext := filepath.Ext(name)
	declared := strings.ToLower(strings.TrimSpace(header.Header.Get("Content-Type")))
	// Strip codec params: video/mp4; codecs="..."
	if i := strings.IndexByte(declared, ';'); i >= 0 {
		declared = strings.TrimSpace(declared[:i])
	}

	switch ext {
	case ".mp4", ".webm":
		// ok
	case "":
		switch declared {
		case "video/mp4":
			ext = ".mp4"
		case "video/webm":
			ext = ".webm"
		default:
			return acceptedVideo{}, fmt.Errorf("فقط فایل‌های MP4 یا WebM مجاز است (ترجیحاً MP4)")
		}
	default:
		return acceptedVideo{}, fmt.Errorf("فقط فایل‌های MP4 یا WebM مجاز است (ترجیحاً MP4)")
	}

	if declared != "" && declared != "application/octet-stream" && declared != "video/mp4" && declared != "video/webm" {
		return acceptedVideo{}, fmt.Errorf("نوع فایل پشتیبانی نمی‌شود؛ MP4 یا WebM بفرستید")
	}
	if declared == "video/mp4" && ext == ".webm" {
		return acceptedVideo{}, fmt.Errorf("پسوند و نوع فایل هم‌خوان نیست")
	}
	if declared == "video/webm" && ext == ".mp4" {
		return acceptedVideo{}, fmt.Errorf("پسوند و نوع فایل هم‌خوان نیست")
	}

	head := make([]byte, 16)
	n, err := io.ReadFull(file, head)
	if err != nil && err != io.ErrUnexpectedEOF && err != io.EOF {
		return acceptedVideo{}, fmt.Errorf("خواندن فایل ممکن نشد")
	}
	if n < 4 {
		return acceptedVideo{}, fmt.Errorf("فایل ویدیویی نامعتبر است")
	}
	head = head[:n]

	kind, ok := sniffVideoKind(head)
	if !ok {
		return acceptedVideo{}, fmt.Errorf("محتوای فایل MP4 یا WebM نیست")
	}
	if ext == ".mp4" && kind != "mp4" {
		return acceptedVideo{}, fmt.Errorf("محتوای فایل با پسوند MP4 هم‌خوان نیست")
	}
	if ext == ".webm" && kind != "webm" {
		return acceptedVideo{}, fmt.Errorf("محتوای فایل با پسوند WebM هم‌خوان نیست")
	}

	if seeker, ok := file.(io.Seeker); ok {
		if _, err := seeker.Seek(0, io.SeekStart); err != nil {
			return acceptedVideo{}, fmt.Errorf("خواندن فایل ممکن نشد")
		}
	} else {
		return acceptedVideo{}, fmt.Errorf("خواندن فایل ممکن نشد")
	}

	mime := "video/mp4"
	if kind == "webm" {
		mime = "video/webm"
	}
	return acceptedVideo{Ext: ext, Mime: mime}, nil
}

func sniffVideoKind(head []byte) (string, bool) {
	// WebM / Matroska EBML header
	if len(head) >= 4 && head[0] == 0x1A && head[1] == 0x45 && head[2] == 0xDF && head[3] == 0xA3 {
		return "webm", true
	}
	// ISO BMFF / MP4: ....ftyp
	if len(head) >= 8 && bytes.Equal(head[4:8], []byte("ftyp")) {
		return "mp4", true
	}
	return "", false
}
