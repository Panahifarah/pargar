package api

import (
	"bytes"
	"mime/multipart"
	"net/textproto"
	"testing"
)

type memFile struct {
	*bytes.Reader
}

func (m memFile) Close() error { return nil }

func TestSniffImageKind(t *testing.T) {
	png := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0}
	ext, mime, ok := sniffImageKind(png)
	if !ok || ext != ".png" || mime != "image/png" {
		t.Fatalf("png: %v %s %s", ok, ext, mime)
	}
	jpeg := []byte{0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0}
	ext, mime, ok = sniffImageKind(jpeg)
	if !ok || ext != ".jpg" {
		t.Fatalf("jpeg: %v %s", ok, ext)
	}
	if _, _, ok := sniffImageKind([]byte("not an image")); ok {
		t.Fatal("expected reject")
	}
}

func TestAcceptAvatarRejectsMismatch(t *testing.T) {
	png := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0, 0, 0, 0, 0}
	h := &multipart.FileHeader{
		Filename: "photo.jpg",
		Header:   textproto.MIMEHeader{"Content-Type": []string{"image/jpeg"}},
		Size:     int64(len(png)),
	}
	_, err := acceptAvatarImage(h, memFile{bytes.NewReader(png)})
	if err == nil {
		t.Fatal("expected extension/content mismatch error")
	}
}

func TestAcceptAvatarPNG(t *testing.T) {
	png := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0, 0, 0, 0, 0}
	h := &multipart.FileHeader{
		Filename: "photo.png",
		Size:     int64(len(png)),
	}
	got, err := acceptAvatarImage(h, memFile{bytes.NewReader(png)})
	if err != nil {
		t.Fatal(err)
	}
	if got.Ext != ".png" || got.Kind != "image" {
		t.Fatalf("%+v", got)
	}
}

func TestAcceptChatRejectsFakePDF(t *testing.T) {
	body := []byte("not a pdf file!!!!")
	h := &multipart.FileHeader{Filename: "x.pdf", Size: int64(len(body))}
	_, err := acceptChatUpload(h, memFile{bytes.NewReader(body)})
	if err == nil {
		t.Fatal("expected fake pdf reject")
	}
}

func TestAcceptChatPDF(t *testing.T) {
	body := []byte("%PDF-1.4\n%âãÏÓ\n")
	h := &multipart.FileHeader{Filename: "doc.pdf", Size: int64(len(body))}
	got, err := acceptChatUpload(h, memFile{bytes.NewReader(body)})
	if err != nil {
		t.Fatal(err)
	}
	if got.Kind != "pdf" {
		t.Fatalf("%+v", got)
	}
}

func TestAcceptChatVoiceWebA(t *testing.T) {
	// EBML header used by MediaRecorder audio/webm;codecs=opus
	body := []byte{0x1A, 0x45, 0xDF, 0xA3, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1F, 0x42, 0x86, 0x81, 0x01}
	h := &multipart.FileHeader{
		Filename: "voice-123.weba",
		Header:   textproto.MIMEHeader{"Content-Type": []string{"audio/webm"}},
		Size:     int64(len(body)),
	}
	got, err := acceptChatUpload(h, memFile{bytes.NewReader(body)})
	if err != nil {
		t.Fatal(err)
	}
	if got.Kind != "audio" || got.Mime != "audio/webm" {
		t.Fatalf("%+v", got)
	}
}

func TestAcceptChatVoiceWebMAsAudio(t *testing.T) {
	body := []byte{0x1A, 0x45, 0xDF, 0xA3, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1F, 0x42, 0x86, 0x81, 0x01}
	h := &multipart.FileHeader{
		Filename: "voice-456.webm",
		Header:   textproto.MIMEHeader{"Content-Type": []string{"audio/webm;codecs=opus"}},
		Size:     int64(len(body)),
	}
	got, err := acceptChatUpload(h, memFile{bytes.NewReader(body)})
	if err != nil {
		t.Fatal(err)
	}
	if got.Kind != "audio" {
		t.Fatalf("expected audio, got %+v", got)
	}
}

func TestAcceptChatRejectsOggLabeledWebM(t *testing.T) {
	// WebM bytes with a wrong .ogg extension must fail (the old client bug path).
	body := []byte{0x1A, 0x45, 0xDF, 0xA3, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1F, 0x42, 0x86, 0x81, 0x01}
	h := &multipart.FileHeader{
		Filename: "clip.ogg",
		Header:   textproto.MIMEHeader{"Content-Type": []string{"audio/ogg"}},
		Size:     int64(len(body)),
	}
	_, err := acceptChatUpload(h, memFile{bytes.NewReader(body)})
	if err == nil {
		t.Fatal("expected reject for webm bytes labeled as ogg")
	}
}
