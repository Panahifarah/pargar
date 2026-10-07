package api

import (
	"bytes"
	"mime/multipart"
	"net/textproto"
	"testing"
)

type seekBuf struct {
	*bytes.Reader
}

func (s seekBuf) Close() error { return nil }

func TestAcceptAdminVideoMP4(t *testing.T) {
	// Minimal ftyp box header
	payload := []byte{
		0x00, 0x00, 0x00, 0x18, 'f', 't', 'y', 'p',
		'i', 's', 'o', 'm', 0x00, 0x00, 0x02, 0x00,
		'i', 's', 'o', 'm', 'i', 's', 'o', '2',
	}
	h := &multipart.FileHeader{
		Filename: "lesson.mp4",
		Size:     int64(len(payload)),
		Header:   textproto.MIMEHeader{"Content-Type": []string{"video/mp4"}},
	}
	got, err := acceptAdminVideo(h, seekBuf{bytes.NewReader(payload)})
	if err != nil {
		t.Fatal(err)
	}
	if got.Ext != ".mp4" || got.Mime != "video/mp4" {
		t.Fatalf("got %+v", got)
	}
}

func TestAcceptAdminVideoWebM(t *testing.T) {
	payload := []byte{0x1A, 0x45, 0xDF, 0xA3, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08}
	h := &multipart.FileHeader{
		Filename: "clip.webm",
		Size:     int64(len(payload)),
		Header:   textproto.MIMEHeader{"Content-Type": []string{"video/webm"}},
	}
	got, err := acceptAdminVideo(h, seekBuf{bytes.NewReader(payload)})
	if err != nil {
		t.Fatal(err)
	}
	if got.Ext != ".webm" || got.Mime != "video/webm" {
		t.Fatalf("got %+v", got)
	}
}

func TestAcceptAdminVideoRejectsMOV(t *testing.T) {
	payload := []byte{0x00, 0x00, 0x00, 0x14, 'f', 't', 'y', 'p', 'q', 't', ' ', ' '}
	h := &multipart.FileHeader{
		Filename: "clip.mov",
		Size:     int64(len(payload)),
		Header:   textproto.MIMEHeader{"Content-Type": []string{"video/quicktime"}},
	}
	if _, err := acceptAdminVideo(h, seekBuf{bytes.NewReader(payload)}); err == nil {
		t.Fatal("expected rejection")
	}
}

func TestAcceptAdminVideoRejectsMismatch(t *testing.T) {
	payload := []byte{0x1A, 0x45, 0xDF, 0xA3, 0x01, 0x02, 0x03, 0x04}
	h := &multipart.FileHeader{
		Filename: "clip.mp4",
		Size:     int64(len(payload)),
		Header:   textproto.MIMEHeader{"Content-Type": []string{"video/mp4"}},
	}
	if _, err := acceptAdminVideo(h, seekBuf{bytes.NewReader(payload)}); err == nil {
		t.Fatal("expected content mismatch rejection")
	}
}
