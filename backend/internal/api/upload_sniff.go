package api

import (
	"bytes"
	"fmt"
	"io"
	"mime/multipart"
	"path/filepath"
	"strings"
)

type sniffedUpload struct {
	Ext  string // including leading dot
	Mime string
	Kind string // image|video|audio|pdf|office|text
}

func readUploadHead(file multipart.File, n int) ([]byte, error) {
	head := make([]byte, n)
	got, err := io.ReadFull(file, head)
	if err != nil && err != io.ErrUnexpectedEOF && err != io.EOF {
		return nil, fmt.Errorf("خواندن فایل ممکن نشد")
	}
	if got == 0 {
		return nil, fmt.Errorf("فایل خالی است")
	}
	head = head[:got]
	if seeker, ok := file.(io.Seeker); ok {
		if _, err := seeker.Seek(0, io.SeekStart); err != nil {
			return nil, fmt.Errorf("خواندن فایل ممکن نشد")
		}
	} else {
		return nil, fmt.Errorf("خواندن فایل ممکن نشد")
	}
	return head, nil
}

func sniffImageKind(head []byte) (ext, mime string, ok bool) {
	if len(head) >= 3 && head[0] == 0xFF && head[1] == 0xD8 && head[2] == 0xFF {
		return ".jpg", "image/jpeg", true
	}
	if len(head) >= 8 && bytes.Equal(head[:8], []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}) {
		return ".png", "image/png", true
	}
	if len(head) >= 6 && (bytes.Equal(head[:6], []byte("GIF87a")) || bytes.Equal(head[:6], []byte("GIF89a"))) {
		return ".gif", "image/gif", true
	}
	if len(head) >= 12 && bytes.Equal(head[:4], []byte("RIFF")) && bytes.Equal(head[8:12], []byte("WEBP")) {
		return ".webp", "image/webp", true
	}
	return "", "", false
}

func sniffPDF(head []byte) bool {
	return len(head) >= 5 && bytes.Equal(head[:5], []byte("%PDF-"))
}

func sniffZIP(head []byte) bool {
	return len(head) >= 4 && head[0] == 0x50 && head[1] == 0x4B && (head[2] == 0x03 || head[2] == 0x05 || head[2] == 0x07) && (head[3] == 0x04 || head[3] == 0x06 || head[3] == 0x08)
}

func sniffOLE(head []byte) bool {
	return len(head) >= 8 && bytes.Equal(head[:8], []byte{0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1})
}

func sniffAudioKind(head []byte, ext string) (mime string, ok bool) {
	switch ext {
	case ".mp3":
		if len(head) >= 3 && (bytes.Equal(head[:3], []byte("ID3")) || (head[0] == 0xFF && (head[1]&0xE0) == 0xE0)) {
			return "audio/mpeg", true
		}
	case ".wav":
		if len(head) >= 12 && bytes.Equal(head[:4], []byte("RIFF")) && bytes.Equal(head[8:12], []byte("WAVE")) {
			return "audio/wav", true
		}
	case ".ogg", ".opus":
		if len(head) >= 4 && bytes.Equal(head[:4], []byte("OggS")) {
			return "audio/ogg", true
		}
	case ".m4a", ".aac":
		if len(head) >= 8 && bytes.Equal(head[4:8], []byte("ftyp")) {
			return "audio/mp4", true
		}
	}
	return "", false
}

// acceptAvatarImage requires JPEG/PNG/WebP by magic bytes (ignores client Content-Type).
func acceptAvatarImage(header *multipart.FileHeader, file multipart.File) (sniffedUpload, error) {
	if header == nil || file == nil {
		return sniffedUpload{}, fmt.Errorf("فایل ارسال نشده است")
	}
	head, err := readUploadHead(file, 16)
	if err != nil {
		return sniffedUpload{}, err
	}
	ext, mime, ok := sniffImageKind(head)
	if !ok || (ext != ".jpg" && ext != ".png" && ext != ".webp") {
		return sniffedUpload{}, fmt.Errorf("فقط JPEG، PNG یا WebP مجاز است")
	}
	nameExt := strings.ToLower(filepath.Ext(header.Filename))
	if nameExt != "" && nameExt != ext && !(nameExt == ".jpeg" && ext == ".jpg") {
		return sniffedUpload{}, fmt.Errorf("پسوند فایل با محتوای آن هم‌خوان نیست")
	}
	return sniffedUpload{Ext: ext, Mime: mime, Kind: "image"}, nil
}

// acceptChatUpload validates extension allow-list plus content sniffing.
func acceptChatUpload(header *multipart.FileHeader, file multipart.File) (sniffedUpload, error) {
	if header == nil || file == nil {
		return sniffedUpload{}, fmt.Errorf("فایلی ارسال نشده است")
	}
	name := filepath.Base(strings.TrimSpace(header.Filename))
	ext := strings.ToLower(filepath.Ext(name))
	if !allowedExtension(ext) {
		return sniffedUpload{}, fmt.Errorf("این نوع فایل مجاز نیست")
	}
	head, err := readUploadHead(file, 16)
	if err != nil {
		return sniffedUpload{}, err
	}

	switch ext {
	case ".jpg", ".jpeg", ".png", ".gif", ".webp":
		got, mime, ok := sniffImageKind(head)
		if !ok {
			return sniffedUpload{}, fmt.Errorf("محتوای فایل تصویر معتبر نیست")
		}
		if ext == ".jpeg" {
			ext = ".jpg"
		}
		if got == ".jpg" && ext != ".jpg" || got != ".jpg" && got != ext {
			return sniffedUpload{}, fmt.Errorf("پسوند فایل با محتوای آن هم‌خوان نیست")
		}
		return sniffedUpload{Ext: got, Mime: mime, Kind: "image"}, nil
	case ".webm":
		// MediaRecorder voice notes use audio/webm but share the same EBML magic as video/webm.
		declared := strings.ToLower(header.Header.Get("Content-Type"))
		base := strings.ToLower(strings.TrimSuffix(name, filepath.Ext(name)))
		asAudio := strings.HasPrefix(declared, "audio/") || strings.HasPrefix(base, "voice-")
		kind, ok := sniffVideoKind(head)
		if !ok || kind != "webm" {
			return sniffedUpload{}, fmt.Errorf("محتوای فایل WebM معتبر نیست")
		}
		if asAudio {
			return sniffedUpload{Ext: ".webm", Mime: "audio/webm", Kind: "audio"}, nil
		}
		return sniffedUpload{Ext: ".webm", Mime: "video/webm", Kind: "video"}, nil
	case ".mp4", ".m4v":
		kind, ok := sniffVideoKind(head)
		if !ok || kind != "mp4" {
			return sniffedUpload{}, fmt.Errorf("محتوای فایل ویدیویی معتبر نیست")
		}
		return sniffedUpload{Ext: ext, Mime: "video/mp4", Kind: "video"}, nil
	case ".mov":
		// QuickTime often looks like ISO BMFF
		if kind, ok := sniffVideoKind(head); ok && kind == "mp4" {
			return sniffedUpload{Ext: ext, Mime: "video/quicktime", Kind: "video"}, nil
		}
		return sniffedUpload{}, fmt.Errorf("محتوای فایل ویدیویی معتبر نیست")
	case ".mp3", ".wav", ".m4a", ".aac", ".ogg", ".opus", ".weba":
		if ext == ".weba" {
			// WebM/Matroska container used for MediaRecorder voice notes.
			kind, ok := sniffVideoKind(head)
			if ok && kind == "webm" {
				return sniffedUpload{Ext: ".webm", Mime: "audio/webm", Kind: "audio"}, nil
			}
			// Short/fragmented first chunk may lack a full EBML header; trust voice-* + audio/*.
			declared := strings.ToLower(header.Header.Get("Content-Type"))
			base := strings.ToLower(strings.TrimSuffix(name, filepath.Ext(name)))
			if strings.HasPrefix(declared, "audio/") || strings.HasPrefix(base, "voice-") {
				return sniffedUpload{Ext: ".webm", Mime: "audio/webm", Kind: "audio"}, nil
			}
			return sniffedUpload{}, fmt.Errorf("محتوای فایل صوتی معتبر نیست")
		}
		mime, ok := sniffAudioKind(head, ext)
		if !ok {
			// Safari/Chrome sometimes emit ftyp later than 16 bytes for short m4a clips;
			// accept voice notes when Content-Type is audio/* and name is voice-*.
			declared := strings.ToLower(header.Header.Get("Content-Type"))
			base := strings.ToLower(strings.TrimSuffix(name, filepath.Ext(name)))
			if strings.HasPrefix(base, "voice-") && strings.HasPrefix(declared, "audio/") {
				fallback := map[string]string{
					".m4a": "audio/mp4", ".aac": "audio/aac",
					".ogg": "audio/ogg", ".opus": "audio/ogg",
					".mp3": "audio/mpeg", ".wav": "audio/wav",
				}
				if m, ok := fallback[ext]; ok {
					return sniffedUpload{Ext: ext, Mime: m, Kind: "audio"}, nil
				}
			}
			return sniffedUpload{}, fmt.Errorf("محتوای فایل صوتی معتبر نیست")
		}
		return sniffedUpload{Ext: ext, Mime: mime, Kind: "audio"}, nil
	case ".pdf":
		if !sniffPDF(head) {
			return sniffedUpload{}, fmt.Errorf("محتوای فایل PDF معتبر نیست")
		}
		return sniffedUpload{Ext: ext, Mime: "application/pdf", Kind: "pdf"}, nil
	case ".doc", ".xls", ".ppt":
		if !sniffOLE(head) {
			return sniffedUpload{}, fmt.Errorf("محتوای فایل Office معتبر نیست")
		}
		return sniffedUpload{Ext: ext, Mime: "application/msword", Kind: "office"}, nil
	case ".docx", ".xlsx", ".pptx":
		if !sniffZIP(head) {
			return sniffedUpload{}, fmt.Errorf("محتوای فایل Office معتبر نیست")
		}
		return sniffedUpload{Ext: ext, Mime: "application/zip", Kind: "office"}, nil
	case ".txt", ".md", ".csv", ".json":
		// Reject binary-looking heads (NUL in first bytes).
		if bytes.IndexByte(head, 0) >= 0 {
			return sniffedUpload{}, fmt.Errorf("محتوای فایل متنی معتبر نیست")
		}
		return sniffedUpload{Ext: ext, Mime: "text/plain", Kind: "text"}, nil
	default:
		return sniffedUpload{}, fmt.Errorf("این نوع فایل مجاز نیست")
	}
}
